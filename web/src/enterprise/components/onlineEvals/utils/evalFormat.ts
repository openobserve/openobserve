import { toast } from "@/lib/feedback/Toast/useToast";

export function parseJson(value: string, label: string) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
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

export function defaultTestValue(variable: string) {
  if (variable === "input") return "The capital of France is Paris, located on the Seine river.";
  if (variable === "output") return "Paris is the capital of France.";
  if (variable === "context") return "France country profile: Paris is the capital city.";
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

export function statusClass(status: string) {
  return {
    "is-good": ["active", "default", "configured"].includes(status),
    "is-warn": ["draft", "paused", "degraded"].includes(status),
    "is-muted": ["archived", "inactive"].includes(status),
  };
}

export function showError(err: any, fallback: string) {
  toast({
    variant: "error",
    message: err?.response?.data?.message || err?.message || fallback,
  });
}
