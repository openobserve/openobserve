import { toast } from "@/lib/feedback/Toast/useToast";
import { gt, type TranslateFn } from "@/types/i18n";

export function parseJson(value: string, label: string) {
  try {
    return JSON.parse(value);
  } catch {
    // Module scope, no setup context — `gt` resolves against the active locale.
    throw new Error(gt("onlineEvals.validation.mustBeValidJson", { label }));
  }
}

export function parseOptionalJson(value: string, label: string) {
  if (!value.trim()) return null;
  return parseJson(value, label);
}

export function stringifyJson(value: any) {
  if (value === undefined || value === null || value === "") return "";
  return JSON.stringify(value, null, 2);
}

export function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function extractTemplateVariables(template: string) {
  const variables = new Set<string>();
  const matcher = /\{\{\s*([\w.]+)\s*\}\}/g;
  let match = matcher.exec(template);
  while (match) {
    variables.add(match[1]);
    match = matcher.exec(template);
  }
  return [...variables];
}

export function formatTemplateVariable(variable: string) {
  return `{{ ${variable} }}`;
}

export function defaultTestValue(variable: string, t: TranslateFn) {
  if (variable === "input") return t("onlineEvals.scorerTestSampleInput");
  if (variable === "output") return t("onlineEvals.scorerTestSampleOutput");
  if (variable === "context") return t("onlineEvals.scorerTestSampleContext");
  if (variable === "metadata") return "{}";
  if (variable === "trace.id") return "test_trace_123";
  if (variable === "span.id") return "test_span_456";
  return "";
}

export function defaultOutputSchema() {
  return {
    type: "object",
    properties: {
      score: { type: "number" },
      reasoning: { type: "string" },
    },
  };
}

export function formatDate(value: number) {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "12s ago" / "5m ago" / "3h ago" / "2d ago"; "—" for a future or invalid time. */
export function relativeTime(timestampMs: number, t: TranslateFn): string {
  const diff = Date.now() - timestampMs;
  if (diff < 0 || !Number.isFinite(diff)) return "—";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t("refreshButton.secondsAgo", { sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t("refreshButton.minutesAgo", { min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("refreshButton.hoursAgo", { h: hr });
  const day = Math.floor(hr / 24);
  return t("onlineEvals.quality.overview.relativeTime.daysAgo", { day });
}

export function statusClass(status: string) {
  return {
    "is-good": ["active", "default", "configured"].includes(status),
    "is-warn": ["draft", "paused"].includes(status),
    "is-muted": ["archived", "inactive"].includes(status),
  };
}

export function showError(err: any, fallback: string) {
  toast({
    variant: "error",
    message: err?.response?.data?.message || err?.message || fallback,
  });
}
