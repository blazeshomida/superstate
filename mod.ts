/**
 * Actor runtime for transition-based state management.
 *
 * Provides primitives for creating actors that process events sequentially
 * and produce snapshots.
 *
 * @module
 *
 * @example
 * ```ts
 * import { createActor, createTransition } from "jsr:@blazes/superstate";
 * import { assertEquals } from "jsr:@std/assert";
 *
 * const logic = createTransition(
 *   { count: 0 },
 *   (context: { count: number }, event: { type: "inc" }) => {
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
export * from "@/actor.ts";
export * from "@/types.ts";
