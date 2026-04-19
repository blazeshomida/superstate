import type {
  Actor,
  ActorLogic,
  ActorScope,
  AnyEvent,
  InspectionEvent,
  Snapshot,
} from "./types.ts";

class Mailbox<TEvent> {
  #queue: TEvent[] = [];
  #flushing = false;

  enqueue(event: TEvent, next: () => void): void {
    this.#queue.push(event);

    if (this.#flushing) return;

    this.#flushing = true;

    try {
      while (this.#queue.length > 0) {
        next();
      }
    } finally {
      this.#flushing = false;
    }
  }

  dequeue(): TEvent | undefined {
    return this.#queue.shift();
  }
}

/**
 * Create an actor from logic.
 *
 * Processes events sequentially and exposes the current snapshot.
 *
 * @typeParam TContext - The actor context type.
 * @typeParam TEvent - The event union type.
 * @typeParam TSnapshot - The snapshot type.
 *
 * @param logic - Actor logic created by {@link createTransition}.
 * @param options - Optional runtime configuration.
 *
 * @returns An actor with lifecycle, subscription, and event APIs.
 *
 * @example
 * ```ts
 * import { createActor, createTransition } from "jsr:@blazes/superstate";
 * import { assertEquals } from "jsr:@std/assert";
 *
 * const logic = createTransition(
 *   { count: 0 },
 *   (context, event: { type: "inc" }) => {
 *     return { count: context.count + 1 };
 *   },
 * );
 *
 * const actor = createActor(logic);
 *
 * actor.start();
 * actor.send({ type: "inc" });
 *
 * assertEquals(actor.getSnapshot().context.count, 1);
 * ```
 */
export function createActor<
  TContext,
  TEvent extends AnyEvent,
  TSnapshot extends Snapshot<TContext>,
>(
  logic: ActorLogic<TContext, TEvent, TSnapshot>,
  options?: {
    inspect?: (
      event: InspectionEvent<TContext, TEvent, TSnapshot>,
    ) => void;
  },
): Actor<TContext, TEvent, TSnapshot> {
  let snapshot = logic.getInitialSnapshot();

  const mailbox = new Mailbox<TEvent>();
  const listeners = new Set<(snapshot: TSnapshot) => void>();
  const deferred: Array<() => void> = [];

  function inspect(
    event: InspectionEvent<TContext, TEvent, TSnapshot>,
  ): void {
    try {
      options?.inspect?.(event);
    } catch {
      // inspection must never break runtime
    }
  }

  const scope: ActorScope<TEvent> = {
    self: {
      send(event) {
        actor.send(event);
      },
    },
    defer(task) {
      deferred.push(task);
    },
  };

  function setError(error: unknown): void {
    snapshot = {
      ...snapshot,
      status: "error",
      error,
    };
  }

  function notify(): void {
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        inspect({
          type: "@actor.listener.error",
          snapshot,
          error,
        });
      }
    }
  }

  function flush(): void {
    while (deferred.length > 0) {
      const task = deferred.shift();

      if (!task) continue;

      try {
        task();
      } catch (error) {
        setError(error);

        inspect({
          type: "@actor.error",
          error,
          snapshot,
        });

        notify();
        return;
      }
    }
  }

  function next(): void {
    const event = mailbox.dequeue();

    if (!event) return;
    if (snapshot.status !== "active") return;

    inspect({
      type: "@actor.event",
      event,
      snapshot,
    });

    try {
      snapshot = logic.transition(snapshot, event, scope);

      inspect({
        type: "@actor.transition",
        event,
        snapshot,
      });

      notify();
      flush();
    } catch (error) {
      setError(error);

      inspect({
        type: "@actor.error",
        event,
        error,
        snapshot,
      });

      notify();
    }
  }

  const actor: Actor<TContext, TEvent, TSnapshot> = {
    send(event) {
      if (snapshot.status !== "active") return;
      mailbox.enqueue(event, next);
    },

    getSnapshot() {
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);

      try {
        listener(snapshot);
      } catch (error) {
        listeners.delete(listener);
        throw error;
      }

      return {
        unsubscribe() {
          listeners.delete(listener);
        },
      };
    },

    start() {
      if (snapshot.status !== "idle") return;

      snapshot = {
        ...snapshot,
        status: "active",
      };

      inspect({
        type: "@actor.start",
        snapshot,
      });

      try {
        logic.start?.(scope);
        notify();
        flush();
      } catch (error) {
        setError(error);

        inspect({
          type: "@actor.error",
          error,
          snapshot,
        });

        notify();
      }
    },

    stop() {
      const isFinal = snapshot.status === "stopped" ||
        snapshot.status === "done" ||
        snapshot.status === "error";

      if (isFinal) return;

      snapshot = {
        ...snapshot,
        status: "stopped",
      };

      inspect({
        type: "@actor.stop",
        snapshot,
      });

      try {
        logic.stop?.(scope);
        notify();
        flush();
      } catch (error) {
        setError(error);

        inspect({
          type: "@actor.error",
          error,
          snapshot,
        });

        notify();
      }
    },
  };

  return actor;
}

/**
 * Create transition-based actor logic.
 *
 * Applies a pure function to update context in response to events.
 *
 * @typeParam TContext - The actor context type.
 * @typeParam TEvent - The event union type.
 *
 * @param initial - Initial context value.
 * @param transition - Function mapping `(context, event, scope)` to the next context.
 *
 * @returns Actor logic compatible with {@link createActor}.
 *
 * @example
 * ```ts
 * import { createActor, createTransition } from "jsr:@blazes/superstate";
 * import { assertEquals } from "jsr:@std/assert";
 *
 * const logic = createTransition(
 *   { count: 0 },
 *   (context, event: { type: "inc" }) => {
 *     return { count: context.count + 1 };
 *   },
 * );
 *
 * const actor = createActor(logic);
 *
 * actor.start();
 * actor.send({ type: "inc" });
 *
 * assertEquals(actor.getSnapshot().context.count, 1);
 * ```
 */
export function createTransition<
  TContext,
  TEvent extends AnyEvent,
>(
  initial: TContext,
  transition: (
    context: TContext,
    event: TEvent,
    scope: ActorScope<NoInfer<TEvent>>,
  ) => TContext,
): ActorLogic<TContext, TEvent> {
  return {
    getInitialSnapshot() {
      return {
        status: "idle",
        context: initial,
      };
    },

    transition(snapshot, event, scope) {
      return {
        ...snapshot,
        context: transition(snapshot.context, event, scope),
      };
    },
  };
}
