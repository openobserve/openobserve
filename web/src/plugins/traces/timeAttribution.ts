// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import {
  computeCriticalPath,
  computeCriticalPathForRoots,
  type CriticalPathNode,
  type CriticalPathSection,
} from "@/utils/traces/criticalPath";
import type { ComputedRef, InjectionKey } from "vue";
import type { I18nText, TranslateFn } from "@/types/i18n";
import { formatTimeWithSuffix } from "@/utils/formatters";
import { getOp, LLM_CALL_OPS } from "./threadView.utils";

type Span = Record<string, any>;

/** A step is slow when it lasts at least 1 s and at least half of the trace. */
export const SLOW_STEP_MIN_US = 1_000_000;
export const SLOW_STEP_MIN_SHARE = 0.5;

export type StepKind = "llm" | "tool";
export type PodState = "healthy" | "restarted" | "oomKilled";
export type CauseKind = StepKind | "db" | "http" | "other";

export interface TimeCause {
  spanId: string;
  kind: CauseKind;
  name: string;
  /** db_system of a database cause. */
  system: string;
  /** Where it ran: peer, address, database, else the service. */
  target: string;
  /** Critical-path time this span, or its repeated siblings together, held inside the step, µs. */
  timeUs: number;
  /** Spans behind that time: identical siblings (an N+1 loop, retries) count together. */
  count: number;
}

export interface StepAttribution {
  spanId: string;
  kind: StepKind;
  name: string;
  startUs: number;
  endUs: number;
  durationUs: number;
  failed: boolean;
  slow: boolean;
  /** Slow with no slow step inside it: the step the waterfall names. */
  headline: boolean;
  /** The descendant that held most of the step's critical path; null when the step itself did. */
  cause: TimeCause | null;
}

interface Node extends CriticalPathNode {
  span: Span;
  children: Node[];
}

/** k8s.pod.name as a span attribute, or as a resource attribute (stored with a `service_` prefix). */
export const spanPod = (span: Span): string =>
  String(span?.k8s_pod_name || span?.service_k8s_pod_name || "");

function stepKind(span: Span): StepKind | null {
  const op = getOp(span).toLowerCase();
  if (op === "execute_tool") return "tool";
  return LLM_CALL_OPS.has(op) ? "llm" : null;
}

function stepName(span: Span, kind: StepKind | null): string {
  return String((kind === "tool" && span.gen_ai_tool_name) || span.operation_name || "");
}

/** A missing or inverted end falls back to start + duration (µs), else a zero-length span. */
function endUsOf(span: Span, startUs: number): number {
  const endNs = Number(span.end_time);
  if (Number.isFinite(endNs) && endNs >= startUs * 1000) return Math.floor(endNs / 1000);
  const durationUs = Number(span.duration);
  return Number.isFinite(durationUs) && durationUs > 0 ? startUs + durationUs : startUs;
}

/** The trace's roots; a span whose parent is missing is a root too. */
function buildForest(spans: Span[]): Node[] {
  const byId = new Map<string, Node>();
  for (const span of spans) {
    const id = String(span?.span_id ?? "");
    const startNs = Number(span?.start_time);
    if (!id || !Number.isFinite(startNs) || byId.has(id)) continue;
    const startTimeUs = Math.floor(startNs / 1000);
    byId.set(id, {
      spanId: id,
      startTimeUs,
      endTimeUs: endUsOf(span, startTimeUs),
      parentId: String(span.reference_parent_span_id ?? "") || undefined,
      children: [],
      span,
    });
  }
  const roots: Node[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Root-first walk; a parent cycle is never reached from a root, so it cannot loop. */
function preOrder(roots: Node[]): Node[] {
  const out: Node[] = [];
  const stack = [...roots].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    out.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  return out;
}

/** Critical-path µs each span held, in walk order. */
function heldTime(sections: CriticalPathSection[]): Map<string, number> {
  const held = new Map<string, number>();
  for (const s of sections) {
    held.set(s.spanId, (held.get(s.spanId) ?? 0) + s.sectionEndUs - s.sectionStartUs);
  }
  return held;
}

function describeCause(span: Span): Omit<TimeCause, "spanId" | "timeUs" | "count"> {
  const kind = stepKind(span);
  const system = String(span.db_system_name ?? span.db_system ?? "");
  const target = String(
    span.peer_service ||
      span.server_address ||
      span.net_peer_name ||
      span.db_namespace ||
      span.db_name ||
      span.service_name ||
      "",
  );
  const isHttp = Boolean(
    span.http_request_method || span.http_method || span.url_full || span.http_url,
  );
  return {
    kind: kind ?? (system ? "db" : isHttp ? "http" : "other"),
    name: stepName(span, kind),
    system: kind ? "" : system,
    target,
  };
}

/** Every LLM or tool step of the trace, in start order, with where its time went. */
export function attributeSteps(spans: Span[]): StepAttribution[] {
  const nodes = preOrder(buildForest(spans));
  if (!nodes.length) return [];
  let traceStart = Infinity;
  let traceEnd = -Infinity;
  for (const n of nodes) {
    traceStart = Math.min(traceStart, n.startTimeUs);
    traceEnd = Math.max(traceEnd, n.endTimeUs);
  }
  const traceUs = traceEnd - traceStart;
  const isSlow = (n: Node) =>
    stepKind(n.span) !== null &&
    n.endTimeUs - n.startTimeUs >= SLOW_STEP_MIN_US &&
    n.endTimeUs - n.startTimeUs >= traceUs * SLOW_STEP_MIN_SHARE;

  const steps: StepAttribution[] = [];
  for (const step of nodes) {
    const kind = stepKind(step.span);
    if (!kind) continue;
    const below = preOrder(step.children);

    // Generic span names repeat across targets, so target and system are part of a cause's identity.
    const held = heldTime(computeCriticalPath(step));
    const groups = new Map<string, { node: Node; nodeUs: number; timeUs: number; count: number }>();
    for (const n of below) {
      const us = held.get(n.spanId);
      if (!us) continue;
      const c = describeCause(n.span);
      const key = [n.parentId, c.kind, c.name, c.system, c.target].join("\u0000");
      const group = groups.get(key);
      if (!group) groups.set(key, { node: n, nodeUs: us, timeUs: us, count: 1 });
      else {
        group.timeUs += us;
        group.count += 1;
        if (us > group.nodeUs) Object.assign(group, { node: n, nodeUs: us });
      }
    }
    let best: { node: Node; timeUs: number; count: number } | null = null;
    let bestUs = held.get(step.spanId) ?? 0;
    for (const group of groups.values()) {
      if (group.timeUs > bestUs) {
        best = group;
        bestUs = group.timeUs;
      }
    }
    const slow = isSlow(step);

    steps.push({
      spanId: step.spanId,
      kind,
      name: stepName(step.span, kind),
      startUs: step.startTimeUs,
      endUs: step.endTimeUs,
      durationUs: step.endTimeUs - step.startTimeUs,
      failed: step.span.span_status === "ERROR",
      slow,
      headline: slow && !below.some(isSlow),
      cause: best
        ? {
            spanId: best.node.spanId,
            timeUs: best.timeUs,
            count: best.count,
            ...describeCause(best.node.span),
          }
        : null,
    });
  }
  // A lone successful model call says nothing the span bar does not.
  const only = steps.length === 1 ? steps[0] : null;
  if (only && only.kind === "llm" && !only.cause && !only.failed) {
    only.slow = false;
    only.headline = false;
  }
  return steps.sort((a, b) => a.startUs - b.startUs);
}

/** The slow steps named above the waterfall, longest first. */
export function headlineSteps(steps: StepAttribution[]): StepAttribution[] {
  return steps.filter((s) => s.headline).sort((a, b) => b.durationUs - a.durationUs);
}

/** Headline sentences, identical ones (parallel copies of one step) said once, keyed by span. */
export function mergedHeadlines(
  steps: StepAttribution[],
  t: TranslateFn,
): { key: string; text: I18nText }[] {
  const groups = new Map<string, { key: string; sentence: I18nText; count: number }>();
  for (const step of steps) {
    const sentence = attributionSentence(step, t);
    const group = groups.get(sentence);
    if (group) group.count += 1;
    else groups.set(sentence, { key: step.spanId, sentence, count: 1 });
  }
  return [...groups.values()].map(({ key, sentence, count }) => ({
    key,
    text: count > 1 ? t("requestTimeline.sameSteps", { count, sentence }) : sentence,
  }));
}

/** The span and every span under it. */
export function subtreeOf(spans: Span[], spanId: string): Span[] {
  const root = preOrder(buildForest(spans)).find((n) => n.spanId === spanId);
  return root ? preOrder([root]).map((n) => n.span) : [];
}

export interface CriticalService {
  service: string;
  /** The service's span that held most critical-path time. */
  span: Span;
  timeUs: number;
}

/** Services on the trace's critical path, most critical time first. */
export function criticalPathServices(spans: Span[]): CriticalService[] {
  const roots = buildForest(spans);
  const byId = new Map(preOrder(roots).map((n) => [n.spanId, n]));
  const services = new Map<string, CriticalService & { spanUs: number }>();
  for (const [id, us] of heldTime(computeCriticalPathForRoots(roots))) {
    const span = byId.get(id)!.span;
    const service = String(span.service_name ?? "");
    if (!service) continue;
    const entry = services.get(service);
    if (!entry) services.set(service, { service, span, timeUs: us, spanUs: us });
    else {
      entry.timeUs += us;
      if (us > entry.spanUs) Object.assign(entry, { span, spanUs: us });
    }
  }
  return [...services.values()]
    .sort((a, b) => b.timeUs - a.timeUs)
    .map(({ service, span, timeUs }) => ({ service, span, timeUs }));
}

/** One or two sentences: how long the step took, then what held that time. */
export function attributionSentence(step: StepAttribution, t: TranslateFn): I18nText {
  const fmt = formatTimeWithSuffix;
  const lead = t(step.failed ? "requestTimeline.failedAfter" : "requestTimeline.took", {
    step: step.name,
    duration: fmt(step.durationUs),
  });
  const cause = step.cause;
  let rest: I18nText;
  if (!cause) {
    rest = t(step.kind === "llm" ? "requestTimeline.selfModel" : "requestTimeline.selfWork");
  } else {
    const params = {
      time: fmt(cause.timeUs),
      name: cause.name,
      system: cause.system,
      count: cause.count,
    };
    const group = cause.count > 1;
    if (!cause.target) {
      rest = t(group ? "requestTimeline.causeBareGroup" : "requestTimeline.causeBare", params);
    } else if (cause.kind === "db" && cause.system) {
      rest = t(group ? "requestTimeline.causeDbGroup" : "requestTimeline.causeDb", {
        ...params,
        target: cause.target,
      });
    } else {
      rest = t(group ? "requestTimeline.causeGroup" : "requestTimeline.cause", {
        ...params,
        target: cause.target,
      });
    }
  }
  return `${lead} ${rest}` as I18nText;
}

/** Returns the sample before the rise, since on a coarse grid the rising sample can land after the trace. */
export function firstRestartUs(
  series: { values?: [number | string, string][] }[],
  fromUs: number,
  toUs: number,
): number | null {
  let first: number | null = null;
  for (const { values = [] } of series) {
    for (let i = 1; i < values.length; i++) {
      const atUs = Number(values[i][0]) * 1_000_000;
      if (atUs < fromUs || atUs > toUs || !(Number(values[i][1]) > Number(values[i - 1][1]))) {
        continue;
      }
      const sinceUs = Math.max(fromUs, Number(values[i - 1][0]) * 1_000_000);
      if (first === null || sinceUs < first) first = sinceUs;
    }
  }
  return first;
}

/** What TraceDetails hands the Thread view so a step can show what is behind it. */
export interface RequestTimelineContext {
  steps: ComputedRef<Map<string, StepAttribution>>;
  spans: ComputedRef<Span[]>;
  streamName: ComputedRef<string>;
  openLogsAt: (spanId: string, timestampUs: number) => void;
  openInWaterfall: (spanId: string) => void;
}

export const REQUEST_TIMELINE_KEY: InjectionKey<RequestTimelineContext> = Symbol("requestTimeline");

/** A step the Thread view explains: one that failed or ran slow. */
export const stepToExplain = (
  context: RequestTimelineContext | null,
  spanId: string,
): StepAttribution | null => {
  const step = context?.steps.value.get(spanId);
  return step && (step.failed || step.slow) ? step : null;
};
