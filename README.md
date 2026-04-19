# @blazes/superstate

Minimal actor runtime for TypeScript with mailbox semantics, deferred effects,
and inspection.

## Requirements

- Deno 1.42+

## Installation

```sh
deno add jsr:@blazes/superstate
```

```sh
pnpm add jsr:@blazes/superstate
```

## Overview

- Processes events sequentially (mailbox)
- Produces immutable snapshots
- Supports deferred effects after transitions
- Exposes inspection hooks for runtime events

## Create and Run an Actor

1. Define event types.
2. Create transition logic.
3. Create the actor.
4. Subscribe to snapshots.
5. Start the actor.
6. Send events.

```ts
import { createActor, createTransition } from "jsr:@blazes/superstate";
import { assertEquals } from "jsr:@std/assert";

type CounterEvent =
  | { type: "inc"; by?: number }
  | { type: "reset" };

const logic = createTransition(
  { count: 0 },
  (context, event: CounterEvent) => {
    switch (event.type) {
      case "inc":
        return { count: context.count + (event.by ?? 1) };
      case "reset":
        return { count: 0 };
    }
  },
);

const actor = createActor(logic);

actor.start();

actor.send({ type: "inc" });
actor.send({ type: "inc", by: 2 });

assertEquals(actor.getSnapshot().context.count, 3);
```

## API

### createTransition

`createTransition(initialContext, (context, event, scope) => nextContext)`

- Updates context in response to events
- Returns logic compatible with `createActor`

### createActor

`createActor(logic, options?)`

- Runs logic and manages lifecycle

| Field   | Type     | Description             |
| ------- | -------- | ----------------------- |
| inspect | function | Receives runtime events |

## Snapshot

A snapshot is the current actor state.

```
{
  status: "active",
  context: { count: 3 }
}
```

## Runtime Behavior

- Events are processed in order
- No reentrancy during transitions
- Deferred tasks run after transitions
- Transition errors set status to `"error"`
- Listener errors are isolated
- Subscription delivers current snapshot immediately

## Deferred Effects

```ts
import { createActor, createTransition } from "jsr:@blazes/superstate";
import { assertEquals } from "jsr:@std/assert";

const logic = createTransition(
  { count: 0 },
  (context, event: { type: "inc" }, scope) => {
    const next = { count: context.count + 1 };

    if (event.type === "inc" && next.count === 1) {
      scope.defer(() => {
        scope.self.send({ type: "inc" });
      });
    }

    return next;
  },
);

const actor = createActor(logic);

actor.start();
actor.send({ type: "inc" });

assertEquals(actor.getSnapshot().context.count, 2);
```

## Mailbox

Events are processed in order. Nested sends are queued and run after the current
transition completes.

```ts
import { createActor, createTransition } from "jsr:@blazes/superstate";
import { assertEquals } from "jsr:@std/assert";

const seen: number[] = [];

const logic = createTransition(
  { count: 0 },
  (context, event: { type: "inc" }, scope) => {
    const next = { count: context.count + 1 };
    seen.push(next.count);

    if (next.count === 1) {
      scope.self.send({ type: "inc" });
      scope.self.send({ type: "inc" });
    }

    return next;
  },
);

const actor = createActor(logic);

actor.start();
actor.send({ type: "inc" });

assertEquals(seen, [1, 2, 3]);
```

## Inspection

```ts
import { createActor, createTransition } from "jsr:@blazes/superstate";
import { assertEquals } from "jsr:@std/assert";

const events: string[] = [];

const actor = createActor(
  createTransition(
    { count: 0 },
    (context, event: { type: "inc" }) => {
      return { count: context.count + 1 };
    },
  ),
  {
    inspect(event) {
      events.push(event.type);
    },
  },
);

actor.start();
actor.send({ type: "inc" });

assertEquals(events, [
  "@actor.start",
  "@actor.event",
  "@actor.transition",
]);
```

Events:

- `@actor.start`
- `@actor.stop`
- `@actor.event`
- `@actor.transition`
- `@actor.error`
- `@actor.listener.error`

## Scope (v0.1.0)

Included:

- `createActor`
- `createTransition`
- mailbox processing
- deferred effects
- inspection

Not included:

- async actors
- child actors
- machine DSL

## Run Tests

```sh
deno test
```

```sh
pnpm dlx deno test
```

## Notes

- `send()` is ignored when status is not `"active"`
- Errors during `subscribe()` initial call are thrown
- Errors during notification are reported via `inspect`

## License

MIT
