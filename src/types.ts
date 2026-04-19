type Empty = Record<never, never>;
export type Prettify<T> = { [K in keyof T]: T[K] } & Empty;

/**
 * Base event type.
 *
 * All events must include a `type` field.
 */
export interface AnyEvent {
  type: string;
}

/**
 * Reference to an actor.
 *
 * Allows sending events to the actor.
 */
export interface ActorRef<TEvent extends AnyEvent> {
  send(event: TEvent): void;
}

/**
 * Actor lifecycle status.
 */
export type ActorStatus =
  | "idle"
  | "active"
  | "done"
  | "error"
  | "stopped";

/**
 * Current state of an actor.
 *
 * Includes status, context, and optional output or error.
 */
export interface Snapshot<TContext, TOutput = never> {
  status: ActorStatus;
  context: TContext;
  output?: TOutput;
  error?: unknown;
}

/**
 * Subscription handle returned by {@link Actor.subscribe}.
 */
export interface Subscription {
  unsubscribe(): void;
}

/**
 * Running actor instance.
 *
 * Provides lifecycle control, event sending, and state subscription.
 */
export interface Actor<
  TContext,
  TEvent extends AnyEvent,
  TSnapshot extends Snapshot<TContext> = Snapshot<TContext>,
> extends ActorRef<TEvent> {
  getSnapshot(): TSnapshot;

  subscribe(listener: (snapshot: TSnapshot) => void): Subscription;

  start(): void;

  stop(): void;
}

/**
 * Execution scope provided to transitions.
 *
 * Allows scheduling deferred work and sending events.
 */
export interface ActorScope<TEvent extends AnyEvent> {
  self: ActorRef<TEvent>;
  defer(task: () => void): void;
}

/**
 * Actor behavior definition.
 *
 * Defines how snapshots are created and updated.
 */
export interface ActorLogic<
  TContext,
  TEvent extends AnyEvent,
  TSnapshot extends Snapshot<TContext> = Snapshot<TContext>,
> {
  getInitialSnapshot(): TSnapshot;

  transition(
    snapshot: TSnapshot,
    event: TEvent,
    scope: ActorScope<TEvent>,
  ): TSnapshot;

  start?(scope: ActorScope<TEvent>): void;

  stop?(scope: ActorScope<TEvent>): void;
}

/**
 * Runtime event emitted through the actor inspection hook.
 */
export type InspectionEvent<
  TContext,
  TEvent extends AnyEvent,
  TSnapshot extends Snapshot<TContext> = Snapshot<TContext>,
> =
  | {
    type: "@actor.start";
    snapshot: TSnapshot;
  }
  | {
    type: "@actor.stop";
    snapshot: TSnapshot;
  }
  | {
    type: "@actor.event";
    event: TEvent;
    snapshot: TSnapshot;
  }
  | {
    type: "@actor.transition";
    event: TEvent;
    snapshot: TSnapshot;
  }
  | {
    type: "@actor.error";
    snapshot: TSnapshot;
    error: unknown;
    event?: TEvent;
  }
  | {
    type: "@actor.listener.error";
    snapshot: TSnapshot;
    error: unknown;
  };

export type ContextOf<TLogic> = TLogic extends
  ActorLogic<infer TContext, infer _TEvent, infer _TSnapshot> ? TContext
  : never;

export type EventOf<TLogic> = TLogic extends
  ActorLogic<infer _TContext, infer TEvent, infer _TSnapshot> ? TEvent
  : never;

export type SnapshotOf<TLogic> = TLogic extends
  ActorLogic<infer _TContext, infer _TEvent, infer TSnapshot> ? TSnapshot
  : never;
