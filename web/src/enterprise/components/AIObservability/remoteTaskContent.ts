// Copyright 2026 OpenObserve Inc.

// Presentation rules shared by the Remote Task list, form, and detail pages, so
// a task reads the same wherever it appears.

import { raw, type I18nText } from "@/types/i18n";
import type { RemoteTask } from "@/services/remote-tasks.service";

/** What the registry state means to someone deciding whether they can use it. */
export type RemoteTaskState = "published" | "draft" | "failed" | "retired";

/**
 * `verificationStatus` alone is not the question a reader has — "can an
 * Experiment pin this?" is. Retired wins over everything, because a deleted head
 * stops being referenceable whatever its last test said.
 */
export function remoteTaskState(task: RemoteTask): RemoteTaskState {
  if (!task.isActive) return "retired";
  if (task.verificationStatus === "failed") return "failed";
  if (task.isDraft) return "draft";
  return task.isReferenceable ? "published" : "draft";
}

/** `v4` for a published row; a draft carries no version to show. */
export function remoteTaskVersionLabel(task: RemoteTask): I18nText | null {
  return task.isDraft ? null : raw(`v${task.version}`);
}

/** Retired heads are immutable; active heads can always create an edit draft. */
export function canEditRemoteTask(task: RemoteTask): boolean {
  return task.isActive;
}

/** The whole placeholder vocabulary a body template may name. Anything else is
 *  rejected at save time, so the form offers exactly these and no more. */
export const TEMPLATE_PLACEHOLDERS = [
  "input",
  "metadata",
  "context",
  "context.experiment_id",
  "context.experiment_name",
  "context.dataset",
  "context.snapshot_version",
  "context.row_id",
  "context.trial_index",
] as const;

/** Header names the platform sets itself; a custom header may not spell one. */
export const RESERVED_HEADERS = [
  "authorization",
  "content-type",
  "traceparent",
  "tracestate",
  "x-o2-idempotency-key",
  "x-o2-signature",
] as const;

/** The body sent when no template is configured. Mirrors DEFAULT_REQUEST_TEMPLATE. */
export const DEFAULT_REQUEST_TEMPLATE =
  '{"input": {{input}}, "metadata": {{metadata}}, "context": {{context}}}';

export const DEFAULT_RESPONSE_SCHEMA = "$.output";

export const TIMEOUT_SECONDS_MIN = 1;
export const TIMEOUT_SECONDS_MAX = 600;
export const ATTEMPTS_MIN = 1;
export const ATTEMPTS_MAX = 3;
export const CONCURRENCY_MIN = 1;
export const CONCURRENCY_MAX = 32;

/** The shape of the signature header, so the form can say what a receiver sees. */
export const SIGNATURE_HEADER_SHAPE = "x-o2-signature: t=<unix>,kid=<key id>,v1=<hmac>";

/**
 * A fresh HMAC signing key, 256 bits of CSPRNG output in base64url.
 *
 * Generated in the browser rather than by the server, because the operator has
 * to paste it into their own service BEFORE the test connection runs — and that
 * test connection is itself signed. A key they only receive afterwards would
 * guarantee the first test fails. Same length and alphabet the server would
 * have produced.
 */
export function generateSigningKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `{{ name }}` — built here so a template never hand-concatenates braces. */
export function placeholderToken(name: string): string {
  return `{{${name}}}`;
}

/** Pretty-print for the raw request/response boxes; non-JSON passes through. */
export function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

/**
 * A hand-entered sample is JSON when it parses as JSON, and a plain string
 * otherwise — so `{"q": 1}` reaches the endpoint as an object while `hello`
 * reaches it as a string, which is what someone typing either one expects.
 */
export function parseSampleInput(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

/** Metadata must be an object or absent; anything else is dropped rather than
 *  sent as a value the template would interpolate wrongly. */
export function parseSampleMetadata(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
