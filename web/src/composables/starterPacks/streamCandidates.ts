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

import { matchField, type BindingSources } from "./packBinding";
import { strictRenames } from "./strictRenames";
import type {
  PackCandidate,
  PackIdentityRule,
  PackQuestion,
  PackRepair,
  PackStreamRole,
} from "./types";

export const MAX_STREAM_COPIES = 5;

const DAY_MS = 24 * 60 * 60 * 1000;
// Below this a stream is no candidate at all; every match here still has to be confirmed.
const MIN_FIELD_SHARE = 0.7;
const CLOSE_SHARE = 0.1;

export interface StreamFacts {
  name: string;
  /** Microseconds, as the stream list reports. */
  lastIngested: number;
  columns: Set<string>;
}

export interface MetricWant {
  name: string;
  fields: string[];
  /** Everything the queries asking for this metric already read. */
  used: Set<string>;
}

/** Top values by identity field, read only for streams that passed on fields. */
export type IdentityValues = Record<string, string[]>;

export type IdentityVerdict = "agrees" | "mixed" | "none";

export const isFresh = (lastIngested: number, nowMs: number) =>
  lastIngested > 0 && nowMs - lastIngested / 1000 <= DAY_MS;

export const fieldMatches = (
  fields: string[],
  columns: Set<string>,
  sources: BindingSources,
): number => fields.filter((field) => matchField(field, columns, sources)).length;

/** `kube_deployment_` for a deployment metric, so a node metric can never stand in for it. */
export const metricEntity = (name: string) => `${name.toLowerCase().split("_", 2).join("_")}_`;

const toCandidate = (
  stream: StreamFacts,
  fields: string[],
  sources: BindingSources,
  samples: string[] = [],
): PackCandidate => ({
  stream: stream.name,
  matched: fieldMatches(fields, stream.columns, sources),
  total: fields.length,
  samples,
});

const share = ({ matched, total }: PackCandidate) => (total ? matched / total : 0);

const closeToBest = (candidates: PackCandidate[]) => {
  const passing = candidates.filter((row) => share(row) >= MIN_FIELD_SHARE);
  const best = Math.max(0, ...passing.map(share));
  return passing
    .filter((row) => best - share(row) <= CLOSE_SHARE)
    .sort((left, right) => share(right) - share(left));
};

/** Names a metric question may offer; only a strict rename can skip the question. */
export const metricCandidates = (
  want: MetricWant,
  streams: StreamFacts[],
  sources: BindingSources,
  nowMs: number,
): PackCandidate[] => {
  const entity = metricEntity(want.name);
  const allowed = streams.filter(
    ({ name, lastIngested }) =>
      isFresh(lastIngested, nowMs) && !want.used.has(name) && name.toLowerCase().startsWith(entity),
  );
  return closeToBest(allowed.map((stream) => toCandidate(stream, want.fields, sources)));
};

/** A strict rename answers itself; anything else becomes one question, or nothing to offer. */
export const repairMetric = (
  want: MetricWant,
  streams: StreamFacts[],
  sources: BindingSources,
  nowMs: number,
): { repair?: PackRepair; question?: PackQuestion } => {
  const fresh = streams.filter(({ lastIngested }) => isFresh(lastIngested, nowMs));
  const [repair] = strictRenames([want.name], new Set(fresh.map(({ name }) => name)), want.used);
  const similar = metricCandidates(want, streams, sources, nowMs);
  const renamed = fresh.find(({ name }) => name === repair?.to);
  // A strict rename can leave the entity prefix, so it is offered even if no prefix match is.
  const candidates =
    renamed && !similar.some(({ stream }) => stream === renamed.name)
      ? [toCandidate(renamed, want.fields, sources), ...similar]
      : similar;
  const question: PackQuestion = {
    want: want.name,
    streamType: "metrics",
    kind: "confirm",
    candidates,
    answer: repair,
  };
  return { repair, question: candidates.length || repair ? question : undefined };
};

const ruleMatches = ({ pattern }: PackIdentityRule, value: string) =>
  new RegExp(pattern, "i").test(value);

/** Whether a stream's identity values all, partly or never say it carries this source. */
export const identityVerdict = (role: PackStreamRole, values: IdentityValues): IdentityVerdict => {
  let mixed = false;
  for (const rule of role.identity) {
    const seen = values[rule.field] ?? [];
    const hits = seen.filter((value) => ruleMatches(rule, value)).length;
    if (hits && hits === seen.length) return "agrees";
    mixed ||= hits > 0;
  }
  return mixed ? "mixed" : "none";
};

const isSharedStream = (stream: string, verdict: IdentityVerdict) =>
  verdict === "mixed" || stream === "default";

// The field whose values split the stream best is the one a person can recognise.
const bestFilterField = (role: PackStreamRole, values: IdentityValues) => {
  const fields = role.identity.map(({ field }) => field);
  const ranked = [...fields].sort(
    (left, right) => (values[right]?.length ?? 0) - (values[left]?.length ?? 0),
  );
  return ranked[0];
};

/** Decides one log role; only one identity-agreed stream with no close rival skips the question. */
export const repairRole = (
  role: PackStreamRole,
  streams: StreamFacts[],
  values: Record<string, IdentityValues>,
  sources: BindingSources,
  nowMs: number,
): PackQuestion => {
  const base = { want: role.stream, streamType: "logs", titleKey: role.titleKey };
  const fresh = streams.filter(({ lastIngested }) => isFresh(lastIngested, nowMs));
  const sampled = (stream: StreamFacts) =>
    toCandidate(stream, role.fields, sources, Object.values(values[stream.name] ?? {}).flat());
  const close = closeToBest(fresh.map(sampled));
  if (!close.length) {
    return { ...base, kind: "none", candidates: fresh.map(sampled) };
  }
  const verdicts = new Map(
    close.map(({ stream }) => [stream, identityVerdict(role, values[stream] ?? {})]),
  );
  const isShared = ({ stream }: PackCandidate) => isSharedStream(stream, verdicts.get(stream)!);
  const plain = close.filter((row) => !isShared(row));
  // A shared stream without its filter would read every other source too.
  if (!plain.length) {
    const filters = Object.fromEntries(
      close.map(({ stream }) => {
        const found = values[stream] ?? {};
        const field = bestFilterField(role, found);
        return [stream, { field, values: found[field] ?? [] }];
      }),
    );
    return { ...base, kind: "shared", candidates: close, filters };
  }
  const agreed = plain.filter(({ stream }) => verdicts.get(stream) === "agrees");
  const answer =
    close.length === 1 && agreed.length === 1
      ? { from: role.stream, to: agreed[0].stream }
      : undefined;
  return { ...base, kind: "confirm", candidates: plain, answer };
};
