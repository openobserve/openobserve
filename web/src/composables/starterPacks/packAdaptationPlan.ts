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

import type { StreamsByType } from "@/types/alertLibrary";

import { bindStream, type BindingSources } from "./packBinding";
import type { MatchItem } from "./packMatch";
import { locateStream } from "./packMatch";
import {
  fieldMatches,
  isFresh,
  metricEntity,
  repairMetric,
  repairRole,
  type IdentityValues,
  type MetricWant,
  type StreamFacts,
} from "./streamCandidates";
import type {
  PackBinding,
  PackChoices,
  PackIdentityRule,
  PackQuestion,
  PackRepair,
  StarterPack,
} from "./types";

const STREAM_READS_AT_ONCE = 8;
const LOG_STREAM_CAP = 50;

export interface PlanReaders {
  columns: (type: string, name: string) => Promise<Set<string>>;
  values: (stream: string, fields: string[]) => Promise<IdentityValues>;
}

export interface PlanInput {
  pack: StarterPack;
  streams: StreamsByType;
  alerts: MatchItem[];
  panels: MatchItem[];
  sources: BindingSources;
  choices?: PackChoices;
  nowMs: number;
  readers: PlanReaders;
}

export interface AdaptationPlan {
  repairs: PackRepair[];
  bindings: PackBinding[];
  questions: PackQuestion[];
  columns: Record<string, string[]>;
}

const EMPTY_CHOICES: PackChoices = { streams: {}, fields: {} };

const readEach = async <T>(names: string[], read: (name: string) => Promise<T>) => {
  const found = new Map<string, T>();
  for (let start = 0; start < names.length; start += STREAM_READS_AT_ONCE) {
    const batch = names.slice(start, start + STREAM_READS_AT_ONCE);
    const rows = await Promise.all(batch.map(read));
    batch.forEach((name, index) => found.set(name, rows[index]));
  }
  return found;
};

const metricWants = (items: MatchItem[], streams: StreamsByType): MetricWant[] => {
  const wants = new Map<string, MetricWant>();
  for (const item of items) {
    for (const name of item.streams) {
      if (locateStream(name, item.streamType ?? "metrics", { streams, repairs: [] })) continue;
      if (locateStream(name, undefined, { streams, repairs: [] })) continue;
      const want = wants.get(name) ?? { name, fields: [], used: new Set<string>() };
      want.fields = [...new Set([...want.fields, ...item.fields])];
      for (const used of item.streams) want.used.add(used);
      wants.set(name, want);
    }
  }
  return [...wants.values()];
};

const streamFacts = async (
  type: string,
  names: Map<string, number>,
  wanted: (name: string) => boolean,
  readers: PlanReaders,
): Promise<StreamFacts[]> => {
  const chosen = [...names.keys()].filter(wanted);
  const columns = await readEach(chosen, (name) => readers.columns(type, name));
  return chosen.map((name) => ({
    name,
    lastIngested: names.get(name) ?? 0,
    columns: columns.get(name)!,
  }));
};

const metricQuestions = async ({ streams, alerts, panels, sources, nowMs, readers }: PlanInput) => {
  const known = streams.metrics ?? new Map<string, number>();
  const alertWants = metricWants(alerts, streams);
  const asked = new Set(alertWants.map(({ name }) => name));
  // An alert is scored on its own fields; merged panel fields would sink a good candidate.
  const panelWants = metricWants(panels, streams).filter(({ name }) => !asked.has(name));
  const wants = [...alertWants, ...panelWants];
  const entities = new Set(wants.map(({ name }) => metricEntity(name)));
  const facts = await streamFacts(
    "metrics",
    known,
    (name) => entities.has(metricEntity(name)),
    readers,
  );
  const names = [...known].map(([name, lastIngested]) => ({
    name,
    lastIngested,
    columns: facts.find((row) => row.name === name)?.columns ?? new Set<string>(),
  }));
  return wants.flatMap((want) => {
    const { question, repair } = repairMetric(want, names, sources, nowMs);
    if (!question) return [];
    // Panels are dropped by the fit check, so only an alert's metric is worth a question.
    return repair || asked.has(want.name) ? [question] : [];
  });
};

const identityFields = (rules: PackIdentityRule[], columns: Set<string>) =>
  rules.map(({ field }) => field).filter((field) => columns.has(field));

const roleQuestions = async ({ pack, streams, sources, nowMs, readers }: PlanInput) => {
  const known = streams.logs ?? new Map<string, number>();
  const roles = (pack.roles ?? []).filter(
    ({ stream }) => !locateStream(stream, "logs", { streams, repairs: [] }),
  );
  if (!roles.length) return [];
  const recent = [...known]
    .filter(([, lastIngested]) => isFresh(lastIngested, nowMs))
    .sort((left, right) => right[1] - left[1])
    .slice(0, LOG_STREAM_CAP);
  const facts = await streamFacts("logs", new Map(recent), () => true, readers);
  const questions: PackQuestion[] = [];
  for (const role of roles) {
    const passing = facts.filter(
      ({ columns }) => fieldMatches(role.fields, columns, sources) / role.fields.length >= 0.7,
    );
    const values = await readEach(
      passing.map(({ name }) => name),
      (name) => {
        const row = passing.find((stream) => stream.name === name)!;
        const fields = identityFields(role.identity, row.columns);
        return fields.length ? readers.values(name, fields) : Promise.resolve({});
      },
    );
    questions.push(repairRole(role, facts, Object.fromEntries(values), sources, nowMs));
  }
  return questions;
};

const applyChoices = (questions: PackQuestion[], choices: PackChoices): PackQuestion[] =>
  questions.map((question) => {
    const choice = choices.streams[question.want];
    return choice ? { ...question, answer: { ...choice, from: question.want } } : question;
  });

const repairedNames = (name: string, repairs: PackRepair[]): string[] => {
  const repair = repairs.find(({ from }) => from === name);
  return repair ? [repair.to, ...(repair.also ?? [])] : [name];
};

const bindItems = async (
  items: MatchItem[],
  repairs: PackRepair[],
  { streams, sources, choices, readers }: PlanInput,
) => {
  const fields = new Map<string, { type: string; fields: Set<string> }>();
  for (const item of items) {
    for (const wanted of item.streams.flatMap((name) => repairedNames(name, repairs))) {
      const found = locateStream(wanted, item.streamType, { streams, repairs: [] });
      if (!found) continue;
      const row = fields.get(found.name) ?? { type: found.type, fields: new Set<string>() };
      for (const field of item.fields) row.fields.add(field);
      fields.set(found.name, row);
    }
  }
  const names = [...fields.keys()];
  const columns = await readEach(names, (name) => readers.columns(fields.get(name)!.type, name));
  const bindings = names.flatMap((name) =>
    bindStream(name, fields.get(name)!.fields, columns.get(name)!, sources, choices?.fields),
  );
  const listed = names.map((name) => [name, [...columns.get(name)!].sort()] as const);
  return { bindings, columns: Object.fromEntries(listed) };
};

/** Decides every stream and field name a pack needs, leaving what must be asked as questions. */
export const planAdaptation = async (input: PlanInput): Promise<AdaptationPlan> => {
  const [metrics, roles] = await Promise.all([metricQuestions(input), roleQuestions(input)]);
  const questions = applyChoices([...metrics, ...roles], input.choices ?? EMPTY_CHOICES);
  const repairs = questions.flatMap(({ answer }) => answer ?? []);
  const { bindings, columns } = await bindItems([...input.alerts, ...input.panels], repairs, input);
  return { repairs, bindings, questions, columns };
};
