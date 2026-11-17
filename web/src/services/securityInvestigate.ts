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

import http from "./http";
import type { EntityKind, StreamPlan } from "@/utils/security/streamPlan";
import type { HuntQuery, HuntSort } from "@/utils/security/huntLink";
import type { SeverityTone } from "@/utils/security/severity";

export type EntitySignal = "failures" | "fail_then_success" | "open_case" | "spread" | "external";

/** A SIEM case naming an entity. */
export interface NodeCase {
  id: string;
  title: string;
  severity: string;
  open: boolean;
}

/** One entity merged across streams; users fold `ACME\dave` and `dave@acme.io` into `dave`. */
export interface EntityRow {
  value: string;
  /** Raw spellings as stored, busiest first. */
  aliases: string[];
  events: number;
  failures: number;
  /** Events from streams that can report failures, the failure rate's denominator. */
  failureEvents: number;
  /** Microseconds. */
  firstSeen: number;
  lastSeen: number;
  streams: string[];
  peers: number;
  failureKnown: boolean;
}

export interface ScoredEntity extends EntityRow {
  signals: EntitySignal[];
  tone: SeverityTone;
}

export interface EntityKindResult {
  rows: ScoredEntity[];
  capped: boolean;
  /** Peer count at which an entity of this kind counts as spread out. */
  spreadAt: number;
}

export interface StreamRunStatus {
  stream: string;
  failed: boolean;
  partial: boolean;
  startTime: number;
  endTime: number;
  /** Estimated rows over the full window, set when the run was cut to its last hour. */
  limitedRows?: number;
}

export interface EntitiesResponse extends Record<EntityKind, EntityKindResult> {
  streams: StreamRunStatus[];
}

export interface EntitiesRequest {
  startTime: number;
  endTime: number;
  plans: StreamPlan[];
  /** Large streams to read over the whole window instead of its last hour. */
  fullWindow?: string[];
}

export interface RiskNode {
  id: string;
  kind: EntityKind;
  value: string;
  aliases: string[];
  events: number;
  failures: number;
  cases: NodeCase[];
  detectionScore: number;
  failureScore: number;
  neighbourScore: number;
  score: number;
  tone: SeverityTone;
}

export interface RiskEdge {
  id: string;
  source: string;
  target: string;
  events: number;
  failures: number;
  streams: string[];
  caseIds: string[];
  type: "event" | "case";
}

export interface RiskGraph {
  nodes: RiskNode[];
  edges: RiskEdge[];
  total: number;
}

export interface EntityGraphResponse extends RiskGraph {
  failedStreams: string[];
}

export interface EntityDetailRequest extends EntitiesRequest {
  kind: EntityKind;
  values: string[];
  interval: string;
}

export interface EntityDetailResponse {
  /** `key` is the histogram key as the engine returned it. */
  timeline: { key: unknown; ok: number; failed: number }[];
  related: Partial<Record<EntityKind, { value: string; n: number; fail: number }[]>>;
  failedStreams: string[];
  /** Cases naming the entity under any spelling, open ones first. */
  cases?: NodeCase[];
}

export type UebaSignalKind =
  | "volume"
  | "new_ip"
  | "failure_jump"
  | "new_hours"
  | "first_seen"
  | "peer_volume"
  | "peer_failures"
  | "fail_then_success"
  | "open_case";

export interface UebaSignal {
  kind: UebaSignalKind;
  weight: number;
  evidence: Record<string, string | number>;
}

export interface UserProfile {
  user: string;
  aliases: string[];
  events: number;
  failures: number;
  failureEvents: number;
  ips: Record<string, { events: number; failures: number; external: boolean }>;
  /** Events per UTC hour of day, keyed by hour. */
  hours: Record<string, number>;
  streams: string[];
  firstSeen: number | null;
}

export interface UserRisk {
  user: string;
  score: number;
  tone: SeverityTone;
  signals: UebaSignal[];
  current: UserProfile;
  baseline: UserProfile | null;
  expected: number;
  baselineSpanUs: number;
  volumeJudged: boolean;
  hoursEligible: boolean;
  withheld: UebaSignalKind[];
  baselineState: "ready" | "building";
}

export interface UebaRequest {
  currentStart: number;
  currentEnd: number;
  baselineStart: number;
  plans: StreamPlan[];
  fullWindow?: string[];
}

export interface UebaReport {
  risks: UserRisk[];
  limitedUsers: string[];
  withheld: UebaSignalKind[];
  currentPartial: boolean;
  excludedStreams: string[];
  noHistoryStreams: string[];
  limitedStreams: { stream: string; rows: number }[];
}

export interface HuntRow {
  /** Milliseconds, for display. */
  time: number;
  /** The stored `_timestamp`, µs. */
  ts: number;
  source: string;
  user: string;
  ip: string;
  host: string;
  action: string;
  outcome: string;
  message: string;
  _key: string;
}

export interface EventSearchRequest {
  startTime: number;
  endTime: number;
  plans: StreamPlan[];
  query: HuntQuery;
  sort: HuntSort;
  from: number;
  size: number;
  /** Also count matches per source. */
  count: boolean;
}

export interface EventSearchResponse {
  rows: HuntRow[];
  total: number | null;
  perSource: { stream: string; n: number }[];
  uncounted: string[];
  searchable: boolean;
}

/** Plans without the stats the server does not read twice. */
const wire = (plans: StreamPlan[]) =>
  plans.map((p) => ({
    stream: p.stream,
    columns: p.columns,
    failure: p.failure,
    actionColumn: p.actionColumn ?? null,
    messageColumn: p.messageColumn ?? null,
    volume: p.volume ?? null,
  }));

const securityInvestigate = {
  entities: (org: string, req: EntitiesRequest, signal?: AbortSignal) =>
    http().post<EntitiesResponse>(
      `/api/${org}/security/entities`,
      { ...req, plans: wire(req.plans) },
      { signal },
    ),
  graph: (org: string, req: EntitiesRequest, signal?: AbortSignal) =>
    http().post<EntityGraphResponse>(
      `/api/${org}/security/entities/graph`,
      { ...req, plans: wire(req.plans) },
      { signal },
    ),
  detail: (org: string, req: EntityDetailRequest, signal?: AbortSignal) =>
    http().post<EntityDetailResponse>(
      `/api/${org}/security/entities/detail`,
      { ...req, plans: wire(req.plans) },
      { signal },
    ),
  ueba: (org: string, req: UebaRequest, signal?: AbortSignal) =>
    http().post<UebaReport>(
      `/api/${org}/security/ueba`,
      { ...req, plans: wire(req.plans) },
      { signal },
    ),
  searchEvents: (org: string, req: EventSearchRequest, signal?: AbortSignal) =>
    http().post<EventSearchResponse>(
      `/api/${org}/security/events/search`,
      { ...req, plans: wire(req.plans) },
      { signal },
    ),
};

export default securityInvestigate;
