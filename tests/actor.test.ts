import { assert, assertEquals } from "@std/assert";

import { createActor, createTransition } from "../mod.ts";

type CounterContext = {
  count: number;
};

type CounterEvent =
  | { type: "inc"; by?: number }
  | { type: "reset" };

function createCounterLogic() {
  return createTransition(
    { count: 0 },
    (context: CounterContext, event: CounterEvent) => {
      switch (event.type) {
        case "inc":
          return { count: context.count + (event.by ?? 1) };
        case "reset":
          return { count: 0 };
      }
    },
  );
}

function createCounterActor() {
  return createActor(createCounterLogic());
}

// #region lifecycle

Deno.test("actor lifecycle", async (t) => {
  await t.step("starts idle", () => {
    const actor = createCounterActor();
    assertEquals(actor.getSnapshot().status, "idle");
  });

  await t.step("start() changes status to active", () => {
    const actor = createCounterActor();
    actor.start();
    assertEquals(actor.getSnapshot().status, "active");
  });

  await t.step("stop() changes status to stopped", () => {
    const actor = createCounterActor();
    actor.start();
    actor.stop();
    assertEquals(actor.getSnapshot().status, "stopped");
  });

  await t.step("send() before start() does nothing", () => {
    const actor = createCounterActor();
    actor.send({ type: "inc" });
    assertEquals(actor.getSnapshot().context.count, 0);
  });

  await t.step("send() after stop() does nothing", () => {
    const actor = createCounterActor();
    actor.start();
    actor.stop();
    actor.send({ type: "inc" });
    assertEquals(actor.getSnapshot().context.count, 0);
  });
});

// #endregion

// #region subscriptions

Deno.test("actor subscriptions", async (t) => {
  await t.step("subscribe() immediately receives current snapshot", () => {
    const actor = createCounterActor();
    const statuses: string[] = [];

    actor.subscribe((snapshot) => {
      statuses.push(snapshot.status);
    });

    assertEquals(statuses, ["idle"]);
  });

  await t.step("subscribers receive updates", () => {
    const actor = createCounterActor();
    const values: number[] = [];

    actor.subscribe((snapshot) => {
      values.push(snapshot.context.count);
    });

    actor.start();
    actor.send({ type: "inc" });
    actor.send({ type: "inc" });

    assertEquals(values, [0, 0, 1, 2]);
  });

  await t.step("unsubscribe() stops future notifications", () => {
    const actor = createCounterActor();
    const values: number[] = [];

    const subscription = actor.subscribe((snapshot) => {
      values.push(snapshot.context.count);
    });

    actor.start();
    subscription.unsubscribe();
    actor.send({ type: "inc" });

    assertEquals(values, [0, 0]);
  });

  await t.step(
    "subscribe() removes listener if initial notification throws",
    () => {
      const actor = createCounterActor();

      let thrown: unknown;

      try {
        actor.subscribe(() => {
          throw new Error("initial listener crash");
        });
      } catch (error) {
        thrown = error;
      }

      assert(thrown instanceof Error);
      assertEquals(thrown.message, "initial listener crash");

      actor.start();
      actor.send({ type: "inc" });

      assertEquals(actor.getSnapshot().context.count, 1);
    },
  );
});

// #endregion

// #region transitions

Deno.test("actor transitions", async (t) => {
  await t.step("send() updates context", () => {
    const actor = createCounterActor();

    actor.start();
    actor.send({ type: "inc", by: 2 });

    assertEquals(actor.getSnapshot().context.count, 2);
  });

  await t.step("reset() restores initial context", () => {
    const actor = createCounterActor();

    actor.start();
    actor.send({ type: "inc", by: 3 });
    actor.send({ type: "reset" });

    assertEquals(actor.getSnapshot().context.count, 0);
  });
});

// #endregion

// #region mailbox

Deno.test("actor mailbox", async (t) => {
  await t.step("self.send() queues instead of reentering", () => {
    const logic = createTransition(
      { count: 0 },
      (context: CounterContext, event: CounterEvent, scope) => {
        if (event.type === "inc") {
          const next = { count: context.count + 1 };

          if (next.count < 3) {
            scope.self.send({ type: "inc" });
          }

          return next;
        }

        return context;
      },
    );

    const actor = createActor(logic);

    actor.start();
    actor.send({ type: "inc" });

    assertEquals(actor.getSnapshot().context.count, 3);
  });

  await t.step("nested sends process in order", () => {
    const seen: number[] = [];

    const logic = createTransition(
      { count: 0 },
      (context: CounterContext, event: CounterEvent, scope) => {
        if (event.type === "inc") {
          const next = { count: context.count + 1 };
          seen.push(next.count);

          if (next.count === 1) {
            scope.self.send({ type: "inc" });
            scope.self.send({ type: "inc" });
          }

          return next;
        }

        return context;
      },
    );

    const actor = createActor(logic);

    actor.start();
    actor.send({ type: "inc" });

    assertEquals(seen, [1, 2, 3]);
  });
});

// #endregion

// #region deferred

Deno.test("deferred tasks", async (t) => {
  await t.step("deferred tasks run after transition", () => {
    const order: string[] = [];

    const logic = createTransition(
      { count: 0 },
      (context: CounterContext, event: CounterEvent, scope) => {
        if (event.type === "inc") {
          order.push("transition");

          scope.defer(() => {
            order.push("deferred");
          });

          return { count: context.count + 1 };
        }

        return context;
      },
    );

    const actor = createActor(logic);

    actor.start();
    actor.send({ type: "inc" });

    assertEquals(order, ["transition", "deferred"]);
  });

  await t.step("deferred tasks can enqueue more events safely", () => {
    const logic = createTransition(
      { count: 0 },
      (context: CounterContext, event: CounterEvent, scope) => {
        if (event.type === "inc") {
          const next = { count: context.count + 1 };

          if (next.count === 1) {
            scope.defer(() => {
              scope.self.send({ type: "inc" });
            });
          }

          return next;
        }

        return context;
      },
    );

    const actor = createActor(logic);

    actor.start();
    actor.send({ type: "inc" });

    assertEquals(actor.getSnapshot().context.count, 2);
  });
});

// #endregion

// #region errors

Deno.test("actor errors", async (t) => {
  await t.step("transition error sets snapshot to error", () => {
    const logic = createTransition(
      { count: 0 },
      (_context: CounterContext, _event: CounterEvent) => {
        throw new Error("💥");
      },
    );

    const actor = createActor(logic);

    actor.start();
    actor.send({ type: "inc" });

    const snapshot = actor.getSnapshot();

    assertEquals(snapshot.status, "error");
    assert(snapshot.error instanceof Error);
    assertEquals(snapshot.error.message, "💥");
  });

  await t.step("deferred error sets snapshot to error", () => {
    const logic = createTransition(
      { count: 0 },
      (context: CounterContext, event: CounterEvent, scope) => {
        if (event.type === "inc") {
          scope.defer(() => {
            throw new Error("deferred 💥");
          });

          return { count: context.count + 1 };
        }

        return context;
      },
    );

    const actor = createActor(logic);

    actor.start();
    actor.send({ type: "inc" });

    const snapshot = actor.getSnapshot();

    assertEquals(snapshot.status, "error");
    assert(snapshot.error instanceof Error);
    assertEquals(snapshot.error.message, "deferred 💥");
  });

  await t.step("listener errors do not break actor processing", () => {
    const actor = createCounterActor();
    let first = true;

    actor.subscribe(() => {
      if (first) {
        first = false;
        return;
      }

      throw new Error("listener crash");
    });

    actor.start();
    actor.send({ type: "inc" });

    assertEquals(actor.getSnapshot().context.count, 1);
  });
});

// #endregion

// #region inspection

Deno.test("actor inspection", async (t) => {
  await t.step("inspect receives lifecycle and transition events", () => {
    const seen: string[] = [];

    const actor = createActor(createCounterLogic(), {
      inspect(event) {
        seen.push(event.type);
      },
    });

    actor.start();
    actor.send({ type: "inc" });

    assertEquals(seen, [
      "@actor.start",
      "@actor.event",
      "@actor.transition",
    ]);
  });

  await t.step("inspect receives error events", () => {
    const seen: string[] = [];

    const logic = createTransition(
      { count: 0 },
      (_context: CounterContext, _event: CounterEvent) => {
        throw new Error("💥");
      },
    );

    const actor = createActor(logic, {
      inspect(event) {
        seen.push(event.type);
      },
    });

    actor.start();
    actor.send({ type: "inc" });

    assertEquals(seen, [
      "@actor.start",
      "@actor.event",
      "@actor.error",
    ]);
  });

  await t.step("inspect receives listener error events", () => {
    const seen: string[] = [];
    let first = true;

    const actor = createActor(createCounterLogic(), {
      inspect(event) {
        seen.push(event.type);
      },
    });

    actor.subscribe(() => {
      if (first) {
        first = false;
        return;
      }

      throw new Error("listener crash");
    });

    actor.start();
    actor.send({ type: "inc" });

    assertEquals(seen, [
      "@actor.start",
      "@actor.listener.error",
      "@actor.event",
      "@actor.transition",
      "@actor.listener.error",
    ]);
  });
});

// #endregion
