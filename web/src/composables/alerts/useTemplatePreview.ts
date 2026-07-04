// Copyright 2026 OpenObserve Inc.
//
// Client-side, DISPLAY-ONLY preview of alert notification templates.
// This intentionally does NOT reproduce the server renderer
// (src/service/alerts/alert.rs). Anything context-sensitive — {rows},
// {rows:N}, {var:N}, {...rows} spread — is rendered as an opaque chip and
// never faked, because a confident-but-wrong preview is worse than none.

export type SegmentClass = "text" | "live" | "sample" | "opaque";

export interface PreviewSegment {
  kind: SegmentClass;
  text: string;
}

export interface PreviewContext {
  live: Record<string, string>;
  sample: Record<string, string>;
}

// Tokens the client must never substitute (server expands these at runtime).
const OPAQUE_PATTERNS: RegExp[] = [
  /^rows$/,
  /^rows:\d+$/,
  /^var:\d+$/,
  /^\.\.\..+$/, // spread: {...rows}, {...rows:3}, etc.
];

function isOpaqueToken(name: string): boolean {
  return OPAQUE_PATTERNS.some((re) => re.test(name));
}

const TOKEN_RE = /\{([^{}]+)\}/g;

export function renderTemplate(
  body: string,
  ctx: PreviewContext,
): PreviewSegment[] {
  const segments: PreviewSegment[] = [];
  if (!body) return segments;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;

  while ((match = TOKEN_RE.exec(body)) !== null) {
    const [full, rawName] = match;
    const name = rawName.trim();

    if (match.index > lastIndex) {
      segments.push({ kind: "text", text: body.slice(lastIndex, match.index) });
    }
    lastIndex = match.index + full.length;

    if (isOpaqueToken(name)) {
      segments.push({ kind: "opaque", text: full });
    } else if (Object.prototype.hasOwnProperty.call(ctx.live, name)) {
      segments.push({ kind: "live", text: ctx.live[name] });
    } else if (Object.prototype.hasOwnProperty.call(ctx.sample, name)) {
      segments.push({ kind: "sample", text: ctx.sample[name] });
    } else {
      segments.push({ kind: "opaque", text: full });
    }
  }

  if (lastIndex < body.length) {
    segments.push({ kind: "text", text: body.slice(lastIndex) });
  }

  return segments;
}

export interface AlertFormFacts {
  alert_name?: string;
  stream_name?: string;
  stream_type?: string;
  alert_operator?: string;
  alert_threshold?: string | number;
  alert_period?: string | number;
}

/** Extra live values known from the form beyond the fixed AlertFormFacts:
 *  the user's own context variables ({key} -> value) and the selected
 *  stream's field names. These render as "live" (your data). Stream fields
 *  whose runtime value we don't know are passed with an empty string and
 *  surface as a labeled placeholder rather than a fabricated value. */
export interface ExtraLiveValues {
  /** context_attributes: { key -> value } the user typed */
  contextVariables?: Record<string, string>;
  /** selected stream field names; value unknown at edit time */
  streamFields?: string[];
}

const MOCK_SAMPLE: Record<string, string> = {
  org_name: "acme-corp",
  alert_count: "42",
  alert_start_time: "2026-06-28T10:25:00Z",
  alert_end_time: "2026-06-28T10:30:00Z",
  alert_url: "https://app.openobserve.ai/alerts/example",
  alert_trigger_time: "2026-06-28T10:30:00Z",
  alert_trigger_time_millis: "1782303000000",
  alert_trigger_time_seconds: "1782303000",
  alert_trigger_time_str: "Jun 28, 2026 10:30:00",
};

export function buildPreviewContext(
  facts: AlertFormFacts,
  extra: ExtraLiveValues = {},
): PreviewContext {
  const live: Record<string, string> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (value !== undefined && value !== null && value !== "") {
      live[key] = String(value);
    }
  }

  // The user's own context variables are real values they typed → live.
  // (Added before facts-derived sample so a context var named like a fact
  // still surfaces the user's typed value.)
  if (extra.contextVariables) {
    for (const [key, value] of Object.entries(extra.contextVariables)) {
      if (key && value !== undefined && value !== null && value !== "") {
        live[key] = String(value);
      }
    }
  }

  // sample provides stream_type only if the form didn't supply it
  const sample: Record<string, string> = { ...MOCK_SAMPLE };
  if (!("stream_type" in live)) sample.stream_type = "logs";

  // Stream fields: we know the NAME but not the runtime value at edit time.
  // Faking a value would mislead, so they are intentionally NOT added to
  // live/sample — they fall through to opaque ("filled at notification
  // time") in renderTemplate. streamFields is accepted so callers can be
  // explicit about intent and so this stays the single place that policy
  // lives; no substitution is performed.
  void extra.streamFields;

  return { live, sample };
}
