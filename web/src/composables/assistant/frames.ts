// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { z } from "zod";

const MAX_CONTEXT_USED = 20;
const MAX_CONTEXT_USED_SCAN = 200;
const MAX_CONTEXT_KEY_LENGTH = 64;

// Loose objects: o2-ai adds fields without a UI release, and an extra field must never turn a frame into `unknown`.
const statusFrameSchema = z.looseObject({
  type: z.literal("status"),
  message: z.string().optional(),
});

const titleFrameSchema = z.looseObject({
  type: z.literal("title"),
  title: z.string(),
});

const toolCallFrameSchema = z.looseObject({
  type: z.literal("tool_call"),
  tool: z.string(),
  message: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  call_id: z.string().optional(),
});

const typedQuerySchema = z.looseObject({
  language: z.string(),
  text: z.string(),
  stream: z.string().optional(),
  stream_type: z.string().optional(),
  from: z.number().optional(),
  to: z.number().optional(),
});

const toolResultFrameSchema = z.looseObject({
  type: z.literal("tool_result"),
  tool: z.string(),
  success: z.boolean().optional(),
  message: z.string().optional(),
  call_id: z.string().optional(),
  // o2-ai sends `{count, took}` for SearchSQL and similar tools, a sentence for others (WP-23).
  summary: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  call_args: z.record(z.string(), z.unknown()).optional(),
  response: z.unknown().optional(),
  error_type: z.string().optional(),
  query: typedQuerySchema.optional(),
});

const messageDeltaFrameSchema = z.looseObject({
  type: z.literal("message_delta"),
  content: z.string(),
});

const messageFrameSchema = z.looseObject({
  type: z.literal("message"),
  content: z.string(),
});

const usageCountersSchema = z.looseObject({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
  cached_tokens: z.number().optional(),
  llm_calls: z.number().optional(),
  cost: z.number().nullable().optional(),
});

const usageFrameSchema = z.looseObject({
  type: z.literal("usage"),
  usage: usageCountersSchema,
});

const approvalTargetSchema = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  name: z.string(),
  link: z.string().optional(),
});

const confirmationRequiredFrameSchema = z.looseObject({
  type: z.literal("confirmation_required"),
  tool: z.string(),
  message: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  call_id: z.string().optional(),
  id: z.string().optional(),
  kind: z.string().optional(),
  operation: z.string().optional(),
  destructive: z.boolean().optional(),
  targets: z.array(approvalTargetSchema).optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  impact: z.array(z.string()).optional(),
  expires_at: z.number().optional(),
  editable: z.boolean().optional(),
  grantable: z.boolean().optional(),
});

const navigationActionFrameSchema = z.looseObject({
  type: z.literal("navigation_action"),
  resource_type: z.string(),
  action: z.string(),
  label: z.string().optional(),
  target: z.record(z.string(), z.unknown()),
});

const errorFrameSchema = z.looseObject({
  type: z.literal("error"),
  message: z.string().optional(),
  error: z.string().optional(),
  error_type: z.string().optional(),
  error_code: z.string().nullable().optional(),
  code: z.union([z.string(), z.number()]).optional(),
  category: z.string().optional(),
  recoverable: z.boolean().optional(),
  retryable: z.boolean().optional(),
  retry_after: z.number().optional(),
  action: z.string().optional(),
  suggestion: z.string().optional(),
  status_code: z.number().optional(),
  session_id: z.string().optional(),
  turn_id: z.string().optional(),
});

const completeFrameSchema = z.looseObject({
  type: z.literal("complete"),
  history: z.array(z.unknown()).optional(),
  compacted: z.boolean().optional(),
  usage: usageCountersSchema.optional(),
  trace_id: z.string().optional(),
  persisted: z.boolean().optional(),
  /** B-02: the turn ended with no content of its own (o2-ai's empty-turn notice). */
  empty: z.boolean().optional(),
  // Cut before any entry is read; `contextUsedKeys` skips a bad entry, never the frame.
  context_used: z
    .unknown()
    .optional()
    .transform((value) =>
      Array.isArray(value) ? (value.slice(0, MAX_CONTEXT_USED_SCAN) as unknown[]) : undefined,
    ),
});

const cancelledFrameSchema = z.looseObject({
  type: z.literal("cancelled"),
  turn_id: z.string().optional(),
  /** Who stopped the turn; absent before B-02. */
  by: z.string().optional(),
});

const turnStartedFrameSchema = z.looseObject({
  type: z.literal("turn_started"),
  turn_id: z.string(),
  agent_type: z.string().optional(),
  trace_id: z.string().optional(),
});

const stepFrameSchema = z.looseObject({
  type: z.literal("step"),
  id: z.string().optional(),
  call_id: z.string().optional(),
  kind: z.string(),
  label: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
  /** `running` · `done` · `failed` · `interrupted`; a string so a new state never drops the frame. */
  state: z.string().optional(),
});

const retryingFrameSchema = z.looseObject({
  type: z.literal("retrying"),
  attempt: z.number(),
  reason: z.string().optional(),
  /** Seconds until the next attempt, when the provider said. */
  retry_after: z.number().optional(),
});

const compactingFrameSchema = z.looseObject({ type: z.literal("compacting") });

const permissionDeniedFrameSchema = z.looseObject({
  type: z.literal("permission_denied"),
  tool: z.string(),
  policy: z.string(),
  detail: z.string().optional(),
});

const confirmationResolvedFrameSchema = z.looseObject({
  type: z.literal("confirmation_resolved"),
  id: z.string(),
  approved: z.boolean(),
  by: z.string().optional(),
  at: z.number().optional(),
  scope: z.string().optional(),
  items: z.array(z.string()).optional(),
  expired: z.boolean().optional(),
  withdrawn: z.boolean().optional(),
});

const queryFrameSchema = z.looseObject({
  type: z.literal("query"),
  language: z.string(),
  text: z.string(),
  validated: z.boolean().optional(),
  time_range: z.looseObject({ from: z.number(), to: z.number() }).optional(),
});

const resourceChangedFrameSchema = z.looseObject({
  type: z.literal("resource_changed"),
  resource_type: z.string(),
  id: z.string().optional(),
  op: z.enum(["create", "update", "delete"]),
});

const findingsEvidenceSchema = z.looseObject({
  text: z.string(),
  call_id: z.string().optional(),
  kind: z.enum(["verified", "inferred"]),
});

const findingsFrameSchema = z.looseObject({
  type: z.literal("findings"),
  likely_cause: z.string(),
  confidence: z.enum(["high", "medium", "low", "inconclusive"]),
  evidence: z.array(findingsEvidenceSchema),
  ruled_out: z.array(z.string()),
  unknowns: z.array(z.string()),
  next_steps: z.array(z.string()),
});

const syncFrameSchema = z.looseObject({ type: z.literal("sync") });

const syncStateFrameSchema = z.looseObject({ type: z.literal("sync_state") });

const DROPPED_FRAME_TYPES: ReadonlySet<string> = new Set(["sync", "sync_state"]);

/** Every frame type of `00` §5.2: today's wire, B-02, B-04, B-07 and EB-A2. */
export const assistantFrameSchema = z.discriminatedUnion("type", [
  statusFrameSchema,
  titleFrameSchema,
  toolCallFrameSchema,
  toolResultFrameSchema,
  messageDeltaFrameSchema,
  messageFrameSchema,
  usageFrameSchema,
  confirmationRequiredFrameSchema,
  navigationActionFrameSchema,
  errorFrameSchema,
  completeFrameSchema,
  cancelledFrameSchema,
  turnStartedFrameSchema,
  stepFrameSchema,
  retryingFrameSchema,
  compactingFrameSchema,
  permissionDeniedFrameSchema,
  confirmationResolvedFrameSchema,
  queryFrameSchema,
  resourceChangedFrameSchema,
  findingsFrameSchema,
  syncFrameSchema,
  syncStateFrameSchema,
]);

export type AssistantFrame = z.infer<typeof assistantFrameSchema>;

export type AssistantFrameType = AssistantFrame["type"];

export type FrameOf<T extends AssistantFrameType> = Extract<AssistantFrame, { type: T }>;

export type StatusFrame = FrameOf<"status">;
export type TitleFrame = FrameOf<"title">;
export type ToolCallFrame = FrameOf<"tool_call">;
export type ToolResultFrame = FrameOf<"tool_result">;
export type MessageDeltaFrame = FrameOf<"message_delta">;
export type MessageFrame = FrameOf<"message">;
export type UsageFrame = FrameOf<"usage">;
export type ConfirmationRequiredFrame = FrameOf<"confirmation_required">;
export type NavigationActionFrame = FrameOf<"navigation_action">;
export type ErrorFrame = FrameOf<"error">;
export type CompleteFrame = FrameOf<"complete">;
export type CancelledFrame = FrameOf<"cancelled">;
export type TurnStartedFrame = FrameOf<"turn_started">;
export type StepFrame = FrameOf<"step">;
export type RetryingFrame = FrameOf<"retrying">;
export type CompactingFrame = FrameOf<"compacting">;
export type PermissionDeniedFrame = FrameOf<"permission_denied">;
export type ConfirmationResolvedFrame = FrameOf<"confirmation_resolved">;
export type QueryFrame = FrameOf<"query">;
export type ResourceChangedFrame = FrameOf<"resource_changed">;
export type FindingsFrame = FrameOf<"findings">;

/** A line that is not JSON, not an object, or not a known frame; the parser counts it and moves on. */
export interface UnknownFrame {
  type: "unknown";
  raw: string;
}

export type ParsedFrame = AssistantFrame | UnknownFrame;

/** Never throws: a bad line becomes `unknown` so one frame cannot halt the stream (`00` §5.2). */
export function parseFrame(json: string): ParsedFrame {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { type: "unknown", raw: json };
  }
  const parsed = assistantFrameSchema.safeParse(value);
  return parsed.success ? parsed.data : { type: "unknown", raw: json };
}

export function isFrame<T extends AssistantFrameType>(
  frame: ParsedFrame,
  type: T,
): frame is FrameOf<T> {
  return frame.type === type;
}

export function isUnknownFrame(frame: ParsedFrame): frame is UnknownFrame {
  return frame.type === "unknown";
}

/** `sync`/`sync_state` are OpenObserve's persistence feed; o2-ai owns their schema and the UI drops them. */
export function isDroppableFrame(frame: ParsedFrame): frame is FrameOf<"sync" | "sync_state"> {
  return DROPPED_FRAME_TYPES.has(frame.type);
}

/** The keys a `complete.context_used` list marks as used, bounded; `undefined` when the field is absent. */
export function contextUsedKeys(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const keys: string[] = [];
  for (const entry of value.slice(0, MAX_CONTEXT_USED_SCAN)) {
    const key = usedKeyOf(entry)?.slice(0, MAX_CONTEXT_KEY_LENGTH);
    if (key && !keys.includes(key)) keys.push(key);
    if (keys.length >= MAX_CONTEXT_USED) break;
  }
  return keys;
}

function usedKeyOf(entry: unknown): string | null {
  if (typeof entry === "string") return entry || null;
  if (!entry || typeof entry !== "object") return null;
  const { key, used } = entry as { key?: unknown; used?: unknown };
  return typeof key === "string" && key && used === true ? key : null;
}
