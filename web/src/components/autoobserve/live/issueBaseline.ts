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

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type { VolumeClass, VolumeSeries, VolumeStatus } from "@/services/autoobserveVolume";
import type { AoSparkBand, AoSparkPoint, AoSparkSpan } from "./aoSparkline";
import { ISSUE_STEP_MS, type IssueStream, type IssueWindow } from "./issueSeries";

/** What the engine's usual level says about one stream, or why there is none to draw. */
export type IssueBaselineState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "failed" }
  | { kind: "denied" }
  | { kind: VolumeStatus; series: VolumeSeries };

export interface IssueBaseline {
  expected: AoSparkPoint[];
  band: AoSparkBand[];
  outside: AoSparkSpan[];
}

// Why a stream has no usual level to draw; a drawn one explains itself through the legend.
const NOTE_KEY: Partial<Record<IssueBaselineState["kind"], I18nKey>> = {
  unavailable: "autoobserve.issueLive.usual.unavailable",
  failed: "autoobserve.issueLive.usual.failed",
  denied: "autoobserve.issueLive.usual.denied",
  presence_only: "autoobserve.issueLive.usual.presenceOnly",
  warmup: "autoobserve.issueLive.usual.warmup",
  irregular: "autoobserve.issueLive.usual.irregular",
  no_data: "autoobserve.issueLive.usual.noData",
};

// Buckets the watch judged out of their usual range; spread and quiet are judged as fine.
const OUTSIDE: VolumeClass[] = ["low", "high", "missing", "busy_missing"];

export const volumeId = (s: IssueStream) => `${s.type}/${s.name}`;

const mergeSpans = (spans: AoSparkSpan[]) =>
  spans.reduce<AoSparkSpan[]>((out, s) => {
    const last = out[out.length - 1];
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
    return out;
  }, []);

/** The route's buckets on the chart's 15-minute grid; an hourly bucket spreads over its quarters. */
export const toIssueBaseline = (series: VolumeSeries, w: IssueWindow): IssueBaseline => {
  const widthMs = Math.max(1, series.width_secs) * 1000;
  const parts = Math.max(1, Math.round(widthMs / ISSUE_STEP_MS));
  const scale = 1 / parts;
  const expected: AoSparkPoint[] = [];
  const band: AoSparkBand[] = [];
  const outside: AoSparkSpan[] = [];
  for (const b of [...series.buckets].sort((a, c) => a.t - c.t)) {
    const startMs = Math.floor(b.t / 1000);
    if (startMs + widthMs <= w.startMs || startMs >= w.endMs) continue;
    if (b.class && OUTSIDE.includes(b.class))
      outside.push({
        from: Math.max(startMs, w.startMs),
        to: Math.min(startMs + widthMs, w.endMs),
      });
    for (let k = 0; k < parts; k++) {
      const t = startMs + k * (widthMs / parts);
      if (t < w.startMs || t >= w.endMs) continue;
      const v = b.expected == null ? null : b.expected * scale;
      expected.push({ t, v });
      if (b.lower != null && b.upper != null)
        band.push({ t, lower: b.lower * scale, upper: b.upper * scale });
    }
  }
  return {
    expected: expected.some((p) => p.v !== null) ? expected : [],
    band,
    outside: mergeSpans(outside),
  };
};

/** Mean usual rows per chart bucket over [fromMs, toMs); null when the watch judged none of it. */
export const usualBetween = (b: IssueBaseline, fromMs: number, toMs: number): number | null => {
  const values = b.expected.flatMap((p) =>
    p.v !== null && p.t >= fromMs && p.t < toMs ? [p.v] : [],
  );
  return values.length ? values.reduce((a, c) => a + c, 0) / values.length : null;
};

/** The route's answer per asked stream: its series, or denied when the caller may not read it. */
export const baselineStates = (
  streams: IssueStream[],
  answer: { series: VolumeSeries[]; denied: string[] },
): Map<string, IssueBaselineState> => {
  const denied = new Set(answer.denied);
  const out = new Map<string, IssueBaselineState>();
  for (const s of streams) {
    const id = volumeId(s);
    const series = answer.series.find((x) => x.stream_type === s.type && x.stream_name === s.name);
    out.set(
      id,
      denied.has(id)
        ? { kind: "denied" }
        : series
          ? { kind: series.status, series }
          : { kind: "unavailable" },
    );
  }
  return out;
};

/** One line on the usual level: why there is none, or that the drawn one is approximate. */
export const issueBaselineNote = (
  t: TranslateFn,
  state: IssueBaselineState,
  stream: string,
): { text: I18nText; tone: "neutral" | "error" } | null => {
  if (state.kind === "volume")
    return state.series.exact
      ? null
      : { text: t("autoobserve.issueLive.usual.approximate"), tone: "neutral" };
  const key = NOTE_KEY[state.kind];
  if (!key) return null;
  const tone = state.kind === "failed" || state.kind === "denied" ? "error" : "neutral";
  return { text: t(key, { stream: raw(stream) }), tone };
};
