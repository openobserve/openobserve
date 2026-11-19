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

import type { z } from "zod";
import { extractStreamText } from "@/components/O2AIChat.reducer";
import type { NavigationAction } from "@/ts/interfaces/chat";

/** What a host drafts. */
export type AiDraftKind = "alert" | "panel" | "dashboard" | "report";

export interface AiDraftIssue {
  /** Dotted path into the proposed arguments, for the model only. */
  path?: string;
  message: string;
}

/** One chat-stream event, read only for what drafting needs. */
export type AiDraftEvent =
  | { kind: "status"; text: string }
  | { kind: "text"; text: string }
  | { kind: "final"; text: string | null }
  | { kind: "confirm"; tool: string; args: Record<string, unknown> }
  | { kind: "toolResult"; tool: string; success: boolean; message: string; data: any }
  | { kind: "navigation"; action: NavigationAction }
  | { kind: "error"; text: string; errorType?: string }
  | { kind: "ignored" };

const IGNORED = new Set(["title", "logs", "usage", "sync", "sync_state", "cancelled"]);

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** The one reader of chat-stream events for drafting; every other shape is ignored. */
export function readDraftEvent(data: any): AiDraftEvent {
  const type = data?.type;
  if (type === "status" || type === "tool_call") {
    return typeof data.message === "string" && data.message.trim()
      ? { kind: "status", text: data.message.trim() }
      : { kind: "ignored" };
  }
  // The proposed resource is the tool's `request_body`; `org_id` beside it is the agent's own routing.
  if (type === "confirmation_required") {
    return {
      kind: "confirm",
      tool: String(data.tool ?? ""),
      args: asRecord(asRecord(data.args).request_body),
    };
  }
  if (type === "navigation_action" && data.action) {
    const { resource_type, action, label, target } = data;
    return { kind: "navigation", action: { resource_type, action, label, target } };
  }
  if (type === "tool_result") {
    return {
      kind: "toolResult",
      tool: String(data.tool ?? ""),
      success: data.success !== false,
      message: typeof data.message === "string" ? data.message : "",
      data,
    };
  }
  if (type === "error") {
    return {
      kind: "error",
      text: String(data.error ?? data.message ?? ""),
      errorType: data.error_type,
    };
  }
  if (type === "complete") {
    const history = Array.isArray(data.history) ? data.history : [];
    const last = history[history.length - 1];
    return {
      kind: "final",
      text: last?.role === "assistant" && typeof last.content === "string" ? last.content : null,
    };
  }
  if (IGNORED.has(type)) return { kind: "ignored" };
  const text = extractStreamText(data);
  return typeof text === "string" ? { kind: "text", text } : { kind: "ignored" };
}

/** Schema issues as path + message, the shape the follow-up turn and the pane both read. */
export function schemaIssues(error: z.ZodError): AiDraftIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length ? issue.path.join(".") : undefined,
    message: issue.message,
  }));
}

/** The one follow-up turn sent when a proposed call fails its checks; it goes to the model, never to the screen. */
export function followUpMessage(tool: string, issues: AiDraftIssue[]): string {
  const lines = issues.map((issue) =>
    issue.path ? `- ${issue.path}: ${issue.message}` : `- ${issue.message}`,
  );
  return [
    `I declined the ${tool} call because it did not pass validation:`,
    ...lines,
    `Fix these and propose ${tool} again.`,
  ].join("\n");
}
