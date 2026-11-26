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

import { ref, type Ref } from "vue";

import { toast } from "@/lib/feedback/Toast/useToast";
import { trackAssistant } from "@/services/assistantAnalytics";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { gt, raw, type I18nKey, type TranslateFn } from "@/types/i18n";
import { downloadFile } from "@/utils/dom";
import { formatOrgRange, orgTimeZone } from "@/utils/formatters";

import type { EntryOrigin, Sid } from "./assistantStore.types";
import { stepsOf, windowsOf } from "./evidence";
import { isHelperChat, rowHints } from "./historyContext";
import { turnsFromMessages } from "./historyImport";
import { minuteLabel, prepareTurns, projectRecord, type StoredTurn } from "./record";
import { getAssistantRuntime } from "./runtime";

export const CHAT_SCHEMA = "o2-assistant-chat/1";
export const CHATS_SCHEMA = "o2-assistant-chats/1";
/** Chat reads a "Download all" keeps in flight at once. */
export const EXPORT_CONCURRENCY = 4;

const DONE_KEYS: Partial<Record<string, I18nKey>> = {
  delete: "assistant.export.doneOf.delete",
  update: "assistant.export.doneOf.update",
  create: "assistant.export.doneOf.create",
};

// One per page, so every trigger of the same download shows it building.
const building = /* @__PURE__ */ ref<ReadonlySet<string>>(new Set());

/** What one exported chat is made of. */
export interface ExportSource {
  title: string;
  created: number;
  origin: EntryOrigin;
  turns: StoredTurn[];
  /** The saved transcript, for a browser chat a legacy tab wrote without turns. */
  messages: ChatMessage[];
}

export interface ExportContext {
  org: string;
  timezone: string;
  now: number;
  product: string;
  t: TranslateFn;
}

export interface ChatExport {
  exportChat(sid: Sid, format: "markdown" | "json"): Promise<void>;
  /** `browser`: only the chats this browser holds that the server never had. */
  exportAll(format: "json", options?: { scope?: "all" | "browser" }): Promise<void>;
  /** Downloads being built, by chat id or `"all"`, so their triggers show `loading`. */
  busy: Readonly<Ref<ReadonlySet<string>>>;
}

/** Downloads and copies, always from the export projection so a file reads like the screen. */
export function useChatExport(): ChatExport {
  const context = (): ExportContext => {
    const org = getAssistantRuntime().context.value?.getOrg();
    return {
      org: org?.name ?? org?.identifier ?? "",
      timezone: orgTimeZone(),
      now: Date.now(),
      product: String(gt("assistant.name")),
      t: gt,
    };
  };
  const fail = () => {
    toast({ variant: "error", message: gt("assistant.history.downloadFailed") });
  };
  const done = () => getAssistantRuntime().history.announceText(gt("assistant.history.downloaded"));
  return {
    busy: building,
    async exportChat(sid, format) {
      if (building.value.has(sid)) return;
      const source = await whileBuilding(sid, () =>
        getAssistantRuntime()
          .history.recordOf(sid)
          .catch(() => null),
      );
      if (!source) {
        fail();
        return;
      }
      const ctx = context();
      const name = `${fileStem(source.title, ctx)}.${format === "json" ? "json" : "md"}`;
      const body =
        format === "json"
          ? JSON.stringify(chatJson(source, ctx), null, 2)
          : chatMarkdown(source, ctx);
      const ok = downloadFile(name, body, format === "json" ? "application/json" : "text/markdown");
      if (!ok) {
        fail();
        return;
      }
      done();
      trackAssistant("ai_thread_action", { action: "download", format });
    },
    async exportAll(format, options = {}) {
      if (building.value.has("all")) return;
      const history = getAssistantRuntime().history;
      const ctx = context();
      const sids =
        options.scope === "browser"
          ? history
              .localRecords()
              .filter((record) => !record.serverBacked && !isHelperChat(rowHints(record)))
              .flatMap((record) => (record.sessionId ? [record.sessionId] : []))
          : history.rows.value.map((row) => row.sid);
      const sources = await whileBuilding("all", () =>
        mapLimited(sids, EXPORT_CONCURRENCY, (sid) => history.recordOf(sid).catch(() => null)),
      );
      const chats = sources.filter((s): s is ExportSource => !!s).map((s) => chatJson(s, ctx));
      const name = `o2-assistant-chats-${stamp(ctx)}.${format}`;
      const ok = downloadFile(
        name,
        JSON.stringify(
          { schema: CHATS_SCHEMA, exported_at: ctx.now, org: ctx.org, chats },
          null,
          2,
        ),
        "application/json",
      );
      if (!ok) {
        fail();
        return;
      }
      done();
      trackAssistant("ai_thread_action", { action: "download", format, count: chats.length });
    },
  };
}

/** `schema: "o2-assistant-chat/1"`; the turns as the export audience sees them, images inlined. */
export function chatJson(source: ExportSource, ctx: ExportContext) {
  const turns = source.turns.length ? source.turns : turnsFromMessages(source.messages);
  return {
    schema: CHAT_SCHEMA,
    exported_at: ctx.now,
    org: ctx.org,
    title: source.title,
    created: source.created,
    origin: source.origin,
    turns: prepareTurns(turns, "export", {
      timezone: ctx.timezone,
      scrubModels: true,
      t: ctx.t,
    }),
  };
}

/** A readable transcript: heading, the export line, then each turn as **You** and the assistant. */
export function chatMarkdown(source: ExportSource, ctx: ExportContext): string {
  const messages = source.turns.length
    ? projectRecord(source.turns, "export", { timezone: ctx.timezone, scrubModels: true, t: ctx.t })
    : source.messages;
  const zone = zoneName(ctx.now, ctx.timezone);
  const header = [
    `# ${oneLine(source.title)}`,
    String(
      ctx.t("assistant.export.exportedLine", {
        time: raw(minuteLabel(ctx.now, ctx.timezone)),
        zone: raw(zone),
        org: raw(ctx.org),
      }),
    ),
  ];
  return `${[...header, markdownOf(messages, ctx)].join("\n\n").trim()}\n`;
}

/** File names carry the title's slug and the minute, so two downloads never collide in one listing. */
export function fileStem(title: string, ctx: Pick<ExportContext, "now" | "timezone">): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `o2-assistant-${slug || "chat"}-${stamp(ctx)}`;
}

function markdownOf(messages: ChatMessage[], ctx: ExportContext): string {
  let turnAt = ctx.now;
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turnAt = message.sentAt ?? turnAt;
      parts.push(`**${ctx.t("assistant.export.you")}**`, userText(message, ctx));
    } else parts.push(`**${ctx.product}**`, answerText(message, turnAt, ctx));
  }
  return parts.filter(Boolean).join("\n\n");
}

function userText(message: ChatMessage, ctx: ExportContext): string {
  const lines = [String(message.content)];
  for (const image of message.images ?? [])
    lines.push(String(ctx.t("assistant.export.image", { name: raw(image.filename) })));
  for (const block of message.contentBlocks ?? [])
    if (block.attachment)
      lines.push(
        String(ctx.t("assistant.export.attachment", { name: raw(block.attachment.name) })),
      );
    else if (block.compactedAt !== undefined && block.message) lines.push(`_${block.message}_`);
  return lines.filter(Boolean).join("\n\n");
}

function answerText(message: ChatMessage, turnAt: number, ctx: ExportContext): string {
  const blocks = message.contentBlocks ?? [];
  const steps = blocks.filter((block) => block.type === "tool_call");
  const lines: string[] = [];
  if (steps.length)
    lines.push(
      String(
        ctx.t(
          "assistant.export.steps",
          { n: steps.length, names: raw([...new Set(steps.map((s) => s.tool))].join(", ")) },
          steps.length,
        ),
      ),
    );
  let wrote = false;
  for (const block of blocks) {
    const line = blockLine(block, blocks, turnAt, ctx);
    if (line) lines.push(line);
    if (block.type === "text" && block.text) wrote = true;
  }
  if (!wrote && String(message.content).trim())
    lines.splice(steps.length ? 1 : 0, 0, String(message.content));
  const evaluated = evaluatedLine(message, ctx);
  if (evaluated) lines.push(evaluated);
  return lines.join("\n\n");
}

// The footer's evaluated window, as the screen shows it under the answer.
function evaluatedLine(message: ChatMessage, ctx: ExportContext): string | null {
  const windows = windowsOf(stepsOf(message, ctx.org));
  const first = windows[0];
  if (!first) return null;
  const range = raw(formatOrgRange(first.from, first.to, { timeZone: ctx.timezone }));
  const others = windows.length - 1;
  return String(
    others > 0
      ? ctx.t("assistant.footer.evaluatedMore", { range, count: others }, others)
      : ctx.t("assistant.footer.evaluated", { range }),
  );
}

// "Deleted 4 of 5": the result step after the decision says how many of the card's items it changed.
function outcomeCount(block: ContentBlock, blocks: ContentBlock[], ctx: ExportContext): string {
  const card = blocks.find((b) => b.approval?.id === block.resolved?.id)?.approval;
  const key = card ? DONE_KEYS[card.kind] : undefined;
  const total = card?.total ?? card?.targets?.length ?? 0;
  if (!card || !key || total === 0) return "";
  const after = blocks.slice(blocks.indexOf(block) + 1);
  const step = after.find(
    (b) => b.type === "tool_call" && b.summary && typeof b.summary === "object",
  );
  const summary = (step?.summary ?? {}) as Record<string, unknown>;
  const done = [summary.deleted, summary.updated, summary.created, summary.count].find(
    (value): value is number => typeof value === "number",
  );
  return done === undefined ? "" : ` · ${String(ctx.t(key, { done, total }))}`;
}

// A bounded number of reads at a time, results in input order.
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await run(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function whileBuilding<R>(key: string, run: () => Promise<R>): Promise<R> {
  building.value = new Set([...building.value, key]);
  try {
    return await run();
  } finally {
    const next = new Set(building.value);
    next.delete(key);
    building.value = next;
  }
}

function blockLine(
  block: ContentBlock,
  blocks: ContentBlock[],
  turnAt: number,
  ctx: ExportContext,
): string | null {
  const time = (at: number) => raw(minuteLabel(at, ctx.timezone));
  if (block.type === "text") return block.text ?? null;
  if (block.type === "approval_result" && block.resolved)
    return (
      String(
        ctx.t(block.resolved.approved ? "assistant.export.approved" : "assistant.export.denied", {
          time: time(block.resolved.at ?? turnAt),
        }),
      ) + (block.resolved.approved ? outcomeCount(block, blocks, ctx) : "")
    );
  if (block.type === "approval" && block.approval?.noDecision)
    return String(ctx.t("assistant.approval.noDecision"));
  if (block.type === "status" && block.turnStatus === "stopped")
    return String(ctx.t("assistant.export.stopped", { time: time(turnAt) }));
  if (block.type === "error" && !blocks.some((b) => b.type === "text"))
    return String(ctx.t("assistant.export.ended"));
  if (block.type === "navigation" && block.navigationAction?.label)
    return `→ ${block.navigationAction.label}`;
  return null;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stamp(ctx: Pick<ExportContext, "now" | "timezone">): string {
  const parts = (timeZone?: string) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        ...(timeZone && { timeZone }),
      })
        .formatToParts(ctx.now)
        .map((part) => [part.type, part.value]),
    );
  let p: Record<string, string>;
  try {
    p = parts(ctx.timezone || undefined);
  } catch {
    p = parts();
  }
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
}

function zoneName(at: number, timeZone: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
        .formatToParts(at)
        .find((part) => part.type === "timeZoneName")?.value ?? timeZone
    );
  } catch {
    return timeZone;
  }
}
