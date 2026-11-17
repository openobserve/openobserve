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

import type { I18nKey, I18nText } from "@/types/i18n";
import type { AutoObserveCellState } from "@/services/autoobserve";
import type { UnfoldCard } from "./unfold.types";

export type HypothesisVerdict = "confirmed" | "ruled_out" | "open";
export type Severity = "p1" | "p2" | "p3" | "p4";
export type CellState = "watched" | "learning" | "gap" | "na";
export type Signal =
  "requests" | "errors" | "latency" | "saturation" | "logPatterns" | "dependencies";
// The engine's own coverage checks; a service is a gap when none of them is covered.
export type LiveCheck = "errors" | "latency" | "absence";

export interface Evidence {
  kind: "log" | "trace" | "metric";
  title: I18nText;
  detail: I18nText;
  count?: I18nText;
  card?: string;
}

export interface Analysis {
  verdict: I18nText;
  impact: I18nText[];
  duration?: I18nText;
  hypotheses: { name: I18nText; verdict: HypothesisVerdict; reason: I18nText }[];
  comparison?: {
    metric: I18nText;
    rows: {
      label: I18nText;
      value: number;
      shown: I18nText;
      kind: "affected" | "healthy" | "limit";
    }[];
  };
}

export interface TimelineEntry {
  at: string;
  title: I18nText;
  detail: I18nText;
  variant: "primary" | "success" | "destructive" | "info" | "muted";
}

export type { UnfoldCard, UnfoldKind, UnfoldOutcome, UnfoldTone } from "./unfold.types";

// The fields the live issue model fills for the analysis and Unfold views.
export interface Issue {
  id: string;
  severity: Severity;
  services: string[];
  nextStep: I18nText;
  evidence: Evidence[];
  analysis: Analysis;
  unfold: UnfoldCard[];
}

export interface CoverageCell {
  state: CellState;
  alsoWatchedBy?: { detector: string; library: string; ledgerId: string }[];
  detector?: string;
  method?: "anomaly" | "threshold";
  library?: string;
  predicate?: string;
  stream?: string;
  progress?: [number, number];
  reason?: I18nText;
  engine?: EngineCellInfo;
}

// What the AutoObserve engine saw for one cell; only the live preview sets it.
export interface EngineCellInfo {
  state: I18nText;
  stateKey: AutoObserveCellState;
  detectorKind?: I18nText;
  monitors: EngineMonitor[];
}

export interface EngineMonitor {
  id: string;
  name: string;
  kind: I18nText;
  state: I18nText;
  stateKey: string;
  kindKey: string;
  predicate: string;
}

export interface CoverageExtra {
  key: string;
  label: I18nText;
  cell: CoverageCell;
}

export interface CoverageRow {
  service: string;
  stream: string;
  where?: I18nText;
  extra?: CoverageExtra[];
  blockedBy?: "noLink" | "stopped";
  addedThisWeek?: boolean;
  lastScanned: I18nText;
  scannedMinutes: number | null;
  cells: Record<Signal, CoverageCell>;
  // Live preview only: the engine's own service rollup, which replaces the per-signal one.
  status?: { state: "watched" | "partial" | "learning" | "gap"; label: I18nText };
  checks?: Record<LiveCheck, CoverageCell>;
  detectors?: number;
  // Live preview only: the engine row's identity, which the drawer's charts scope their queries by.
  identity?: LiveIdentity;
}

export interface LiveIdentity {
  serviceId: string;
  serviceName: string;
  cluster: string | null;
  namespace: string | null;
  streams: { type: string; name: string; learning_until?: number | null }[];
}

export const SIGNALS: Signal[] = [
  "requests",
  "errors",
  "latency",
  "saturation",
  "logPatterns",
  "dependencies",
];

export const LIVE_CHECKS: LiveCheck[] = ["errors", "latency", "absence"];

// A live row carries the distinct monitors over its three checks, the same set the header counts.
export const detectorsOf = (row: CoverageRow): number =>
  row.detectors ?? SIGNALS.filter((signal) => row.cells[signal].detector).length;

export const SIGNAL_LABEL: Record<Signal, I18nKey> = {
  requests: "autoobserve.signals.requests",
  errors: "autoobserve.signals.errors",
  latency: "autoobserve.signals.latency",
  saturation: "autoobserve.signals.saturation",
  logPatterns: "autoobserve.signals.logPatterns",
  dependencies: "autoobserve.signals.dependencies",
};
