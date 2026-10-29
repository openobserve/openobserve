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

import { reactive } from "vue";

import { uiIntlLocale } from "@/utils/formatters";

import type {
  AssistantSession,
  ComposerState,
  RequestBuilder,
  SendRequest,
  Sid,
  WireAttachment,
} from "../assistantStore.types";
import { contextUsedKeys, type CompleteFrame } from "../frames";
import { neutralizeBlockSyntax } from "../record";
import type { WireMessage } from "../useAssistantClient";
import {
  MAX_ATTACHED_BYTES,
  MAX_ATTACHED_ROWS,
  ROW_KINDS,
  WHITELIST_FIELDS,
  browserTimezone,
  byteSize,
  isPresent,
  fieldRowOf,
  serializedNameOf,
  timeWindowOf,
  truncateChip,
  wireDataOf,
  wireTimeRange,
  type TimeWindow,
} from "./contextChips";
import type { ContextChip, PageContext } from "./types";

/** RFC 4648 base32 alphabet, lower case: no character a JSON body or a log line needs to escape. */
export const NONCE_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export const NONCE_LENGTH = 8;

// Below this many bytes left, a block is dropped rather than cut to a useless stub.
const MIN_BLOCK_BYTES = 256;

const MAX_INCIDENT_ID = 128;

const UTF8 = /* @__PURE__ */ new TextEncoder();

/** The window each session's running turn was sent with, so the time chip can show it until the turn ends (CT-01 AC 13). */
export const sentWindows: Map<Sid, TimeWindow> = /* @__PURE__ */ reactive(
  new Map<Sid, TimeWindow>(),
);

/** The composer fields the wire reads; a snapshot or the live composer both fit. */
export type WireComposer = Pick<ComposerState, "chips" | "timeOverride" | "removedPageKeys">;

export interface SerializedBlocks {
  text: string;
  rows: number;
  bytes: number;
  omitted: number;
}

/** The engine's request builder (`00` §6.3): what the tray shows is what goes on the wire. */
export const serialize: RequestBuilder = (session, snapshot, client, turn) => {
  const now = turn?.now ?? Date.now();
  const page = turn?.pageContext ?? null;
  const composer: WireComposer = {
    chips: snapshot.chips,
    timeOverride: snapshot.timeOverride,
    removedPageKeys: snapshot.removedPageKeys ?? session.composer.removedPageKeys,
  };
  const window = timeWindowOf(page, composer.timeOverride, now);
  sentWindows.set(session.sid, window);
  const attached = composer.chips.filter((chip) => serializedNameOf(chip) !== undefined);
  const typed = turn?.attachments ?? false;
  const blocks = typed ? null : serializeBlocks(attached, makeNonce());
  const typedText = neutralizeBlockSyntax(snapshot.text.trim());
  const text = [typedText, blocks?.text ?? ""].filter(Boolean).join("\n\n");
  const context = wireContextOf(page, composer, { org: session.org, window, now });
  // Without an explicit chat mode the server runs the autonomous analysis agent on any `incident_id`.
  const incidentId =
    turn?.rcaChatMode && (turn.mode ?? "chat") === "chat" ? incidentIdOf(page, composer) : null;
  if (incidentId) context.incident_id = incidentId;
  const request: SendRequest = {
    org: session.org,
    sid: session.sid,
    turnId: session.turnMeta.turnId ?? turn?.turnId ?? "",
    message: { text, ...(snapshot.images.length > 0 && { images: [...snapshot.images] }) },
    context: {
      ...context,
      client,
      user_timezone: browserTimezone(),
      locale: uiIntlLocale(),
    },
    ...(turn?.mode && { mode: turn.mode }),
    ...(incidentId && { mode: "chat" as const }),
    ...(turn?.ephemeral && { ephemeral: true }),
    ...(typed && attached.length > 0 && { attachments: attached.map(toAttachment) }),
    ...(turn?.replyToApproval && { replyToApproval: turn.replyToApproval }),
  };
  if (turn?.persisted) {
    const seq = session.record.cachedLastSeq;
    return typeof seq === "number" ? { ...request, knownSeq: seq } : request;
  }
  // Without server persistence the server keeps no history, so the transcript still goes, text only (P-20).
  return { ...request, transcript: transcriptOf(session.messages, turn?.userIndex) } as SendRequest;
};

/** The whitelist fields of `context` after removals and the time override; never `agent_type` (constraint 41). */
export function wireContextOf(
  page: PageContext | null,
  composer: WireComposer,
  opts: { org: string; window?: TimeWindow; now?: number },
): Record<string, unknown> {
  const now = opts.now ?? Date.now();
  const removed = new Set(
    composer.removedPageKeys.flatMap((key) => fieldRowOf(key)?.fields ?? [key]),
  );
  const out: Record<string, unknown> = {};
  for (const field of WHITELIST_FIELDS) {
    const value = page?.[field];
    if (!removed.has(field) && isPresent(value)) out[field] = value;
  }
  delete out.organization_identifier;
  out.org_id = opts.org || page?.org_id || page?.organization_identifier || "";
  out.currentPage = page?.routeName || page?.currentPage || "";
  out.timeRange = wireTimeRange(opts.window ?? timeWindowOf(page, composer.timeOverride, now));
  out.request_timestamp = Math.round(now * 1000);
  delete out.user_timezone;
  applyMentions(out, composer.chips);
  if (!Array.isArray(out.selectedStreams)) delete out.streamType;
  if (!out.org_id) delete out.org_id;
  if (!out.currentPage) delete out.currentPage;
  return out;
}

/** One nonce-delimited, JSON-bodied block per chip; 20 rows / 32 KB per message with a marker for what was cut. */
export function serializeBlocks(chips: readonly ContextChip[], nonce: string): SerializedBlocks {
  const parts: string[] = [];
  let rows = 0;
  let bytes = 0;
  let omitted = 0;
  for (const chip of chips) {
    const name = serializedNameOf(chip);
    if (!name) continue;
    const rowsLeft = MAX_ATTACHED_ROWS - rows;
    const left = MAX_ATTACHED_BYTES - bytes;
    const wire = rowsCapped(chip, wireDataOf(chip), rowsLeft);
    if (wire === undefined || left < MIN_BLOCK_BYTES) {
      omitted += 1;
      continue;
    }
    const fitted = truncateChip({ ...chip, data: wire.data, sizeBytes: byteSize(wire.data) }, left);
    const body = JSON.stringify(fitted.data ?? null);
    const size = UTF8.encode(body).length;
    // A value that cannot be cut under the cap is left out rather than sent over it.
    if (size > left) {
      omitted += 1;
      continue;
    }
    const cut = wire.cut || !!fitted.truncated?.length;
    parts.push(block(cut ? `${name} (truncated)` : name, body, nonce));
    rows += ROW_KINDS.has(chip.kind) ? (Array.isArray(fitted.data) ? fitted.data.length : 1) : 0;
    bytes += size;
  }
  if (omitted > 0) parts.push(block("Omitted", JSON.stringify({ attachments: omitted }), nonce));
  return { text: parts.join("\n\n"), rows, bytes, omitted };
}

/** Eight base32 characters from the platform CSPRNG. */
export function makeNonce(random: (bytes: Uint8Array) => Uint8Array = cryptoRandom): string {
  const bytes = random(new Uint8Array(NONCE_LENGTH));
  return Array.from(bytes, (byte) => NONCE_ALPHABET[byte % NONCE_ALPHABET.length]).join("");
}

/** B-09's `context_used` echo for `turnMeta.contextUsed` (CT-12); `null` when the server sent none. */
export function contextUsedOf(frame: CompleteFrame): string[] | null {
  return contextUsedKeys((frame as { context_used?: unknown }).context_used) ?? null;
}

/** A browser-only chat's earlier messages, text only, up to this turn's user message. */
export function transcriptOf(
  messages: AssistantSession["messages"],
  upTo: number | undefined,
): WireMessage[] {
  const prior = typeof upTo === "number" && upTo >= 0 ? messages.slice(0, upTo) : messages;
  return prior
    .map((message) => ({ role: message.role, content: String(message.content ?? "") }))
    .filter((message) => message.content.trim() !== "");
}

// Mentions add the ids the tray shows (CT-05 AC 12); a page value of the same kind is replaced.
function applyMentions(out: Record<string, unknown>, chips: readonly ContextChip[]): void {
  for (const chip of chips) {
    const ref = chip.ref;
    // Only the user's own mentions add ids; a starter's page copy never puts a removed field back (S4).
    if (!ref?.id || chip.sent !== "whitelist" || chip.provenance !== "mention") continue;
    if (chip.kind === "stream") {
      const type = ref.streamType ?? "logs";
      // One stream type per request: a mention of another type replaces the streams rather than mislabel them.
      const sameType = !out.streamType || out.streamType === type;
      const current =
        sameType && Array.isArray(out.selectedStreams) ? (out.selectedStreams as string[]) : [];
      out.selectedStreams = [...new Set([...current, ref.id])];
      out.streamType = type;
    } else if (chip.kind === "panel" && ref.type === "dashboard") {
      out.dashboardId = ref.id;
      delete out.panelId;
    } else if (chip.kind === "panel") {
      out.panelId = ref.id;
      const dashboard = (chip.data as { dashboardId?: unknown } | undefined)?.dashboardId;
      if (typeof dashboard === "string") out.dashboardId = dashboard;
    } else if (chip.kind === "alert") out.alertId = ref.id;
    else if (chip.kind === "pipeline_node") out.pipelineId = ref.id;
  }
}

// The rows a row chip may still send this message; `undefined` when none fit.
function rowsCapped(
  chip: ContextChip,
  data: unknown,
  rowsLeft: number,
): { data: unknown; cut: boolean } | undefined {
  if (!ROW_KINDS.has(chip.kind)) return { data, cut: false };
  if (rowsLeft <= 0) return undefined;
  if (!Array.isArray(data) || data.length <= rowsLeft) return { data, cut: false };
  return { data: data.slice(0, rowsLeft), cut: true };
}

function block(name: string, body: string, nonce: string): string {
  return `--- ${name} [${nonce}] ---\n${body}\n--- end [${nonce}] ---`;
}

function incidentIdOf(page: PageContext | null, composer: WireComposer): string | null {
  const value = page?.incident_id;
  if (typeof value !== "string" || !value || value.length > MAX_INCIDENT_ID) return null;
  const removed = composer.removedPageKeys.some((key) =>
    (fieldRowOf(key)?.fields ?? [key]).includes("incident_id"),
  );
  return removed ? null : value;
}

function toAttachment(chip: ContextChip): WireAttachment {
  return { kind: chip.kind, ...(chip.ref && { ref: chip.ref }), data: wireDataOf(chip) };
}

function cryptoRandom(bytes: Uint8Array): Uint8Array {
  return crypto.getRandomValues(bytes);
}
