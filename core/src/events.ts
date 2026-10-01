import { z } from 'zod';

/**
 * The guild's view of what an agent did, normalized from Claude Code hook payloads.
 *
 * Deliberately small: only what the game needs. Prompt text, tool inputs and file
 * contents never enter this shape, so nothing sensitive can reach the UI or a fixture
 * by way of an event.
 */

const base = {
  /** Seconds since the start of the stream. Replay and demo mode order by this. */
  t: z.number().nonnegative(),
  session: z.string().min(1),
};

export const TodoStatus = z.enum(['pending', 'in_progress', 'completed']);
export type TodoStatus = z.infer<typeof TodoStatus>;

export const Todo = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  status: TodoStatus,
});
export type Todo = z.infer<typeof Todo>;

export const GuildEvent = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('session_start'), name: z.string().min(1).max(40) }),
  z.object({ ...base, type: z.literal('session_end') }),
  z.object({ ...base, type: z.literal('tool'), tool: z.string().min(1) }),
  z.object({ ...base, type: z.literal('todos'), todos: z.array(Todo).max(50) }),
  z.object({
    ...base,
    type: z.literal('subagent_start'),
    parent: z.string().min(1),
    name: z.string().min(1).max(40),
  }),
  z.object({ ...base, type: z.literal('subagent_stop') }),
  /** Claude Code is waiting on the user: a permission prompt or an idle notification. */
  z.object({ ...base, type: z.literal('needs_input') }),
  /** The agent finished its turn. */
  z.object({ ...base, type: z.literal('stop') }),
  /**
   * Tokens one model reply used, read from the transcript's usage numbers. Counts only:
   * nothing about what the tokens said.
   */
  z.object({
    ...base,
    type: z.literal('usage'),
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative(),
    cacheWrite: z.number().int().nonnegative(),
  }),
  /**
   * Git state of the folder a session runs in, polled by the server: counts only, never
   * file names or commit messages. `unpushed` is commits on no remote branch.
   */
  z.object({
    ...base,
    type: z.literal('git'),
    unpushed: z.number().int().nonnegative(),
    dirty: z.number().int().nonnegative(),
    remote: z.boolean(),
  }),
  /** Which model the session runs on and which git branch it is on, when they change. */
  z.object({
    ...base,
    type: z.literal('meta'),
    model: z.string().min(1).max(60).optional(),
    branch: z.string().min(1).max(100).optional(),
  }),
]);
export type GuildEvent = z.infer<typeof GuildEvent>;

export const EventStream = z.array(GuildEvent);
