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

import { ref } from "vue";
import { useStore } from "vuex";

import {
  labelMatchers,
  needsDataText,
  type LabelMatcher,
} from "@/components/alertLibrary/libraryReview";
import metricsService from "@/services/metrics";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";

const DAY_MICROS = 24 * 60 * 60 * 1_000_000;

/** Whether a rule's label matchers find data: `unknown` when the check itself failed. */
export type LabelVerdict =
  { state: "ok" } | { state: "missing"; missing: LabelMatcher[] } | { state: "unknown" };

// Session-wide on purpose: a card keeps its verdict after the review that checked it closes.
const verdicts = ref<Map<string, LabelVerdict>>(new Map());
const labelsInFlight = new Map<string, Promise<Set<string>>>();
const valuesInFlight = new Map<string, Promise<Set<string>>>();

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const namesOf = (response: any): Set<string> => {
  const data = response?.data?.data;
  return new Set(Array.isArray(data) ? data.map(String) : []);
};

// A failed request is dropped from the map so the next check asks again.
const shared = (
  cache: Map<string, Promise<Set<string>>>,
  key: string,
  load: () => Promise<unknown>,
): Promise<Set<string>> => {
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = load().then(namesOf);
  cache.set(key, pending);
  pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key);
  });
  return pending;
};

/** Forgets every verdict and pending request; for tests and an org switch. */
export const clearLabelChecks = (): void => {
  verdicts.value = new Map();
  labelsInFlight.clear();
  valuesInFlight.clear();
};

/** Checks a PromQL rule's `label="value"` matchers through /labels and label values, not /series, which ignores them. */
export function useLibraryLabelCheck() {
  const store = useStore();
  const org = (): string => store.state.selectedOrganization?.identifier ?? "";
  const keyOf = (entry: AlertLibraryEntry): string => `${org()}|${entry.id}@${entry.content_hash}`;

  const isMissing = async (matcher: LabelMatcher, window: { start: number; end: number }) => {
    const base = { org_identifier: org(), start_time: window.start, end_time: window.end };
    const metricKey = `${org()}|${matcher.metric}`;
    const labels = await shared(labelsInFlight, metricKey, () =>
      metricsService.labels({ ...base, match: matcher.metric }),
    );
    if (!labels.has(matcher.label)) return true;
    const values = await shared(valuesInFlight, `${metricKey}|${matcher.label}`, () =>
      metricsService.labelValues({ ...base, label: matcher.label, match: matcher.metric }),
    );
    return !values.has(matcher.value);
  };

  const run = async (file: AlertLibraryFile): Promise<LabelVerdict> => {
    const query = asRecord(file?.query_condition);
    if (query.type !== "promql" || typeof query.promql !== "string") return { state: "ok" };
    const matchers = labelMatchers(query.promql);
    if (matchers.length === 0) return { state: "ok" };
    const end = Date.now() * 1000;
    const window = { start: end - DAY_MICROS, end };
    try {
      const flags = await Promise.all(matchers.map((matcher) => isMissing(matcher, window)));
      const missing = matchers.filter((_, index) => flags[index]);
      return missing.length > 0 ? { state: "missing", missing } : { state: "ok" };
    } catch {
      return { state: "unknown" };
    }
  };

  /** The rule's verdict, from the session cache when this file was already checked. */
  const check = async (entry: AlertLibraryEntry, file: AlertLibraryFile): Promise<LabelVerdict> => {
    const key = keyOf(entry);
    const cached = verdicts.value.get(key);
    if (cached) return cached;
    const verdict = await run(file);
    if (verdict.state !== "unknown") {
      const next = new Map(verdicts.value);
      next.set(key, verdict);
      verdicts.value = next;
    }
    return verdict;
  };

  /** "job hadoop-namenode" once a check found it missing; "" while unchecked or passing. */
  const needsData = (entry: AlertLibraryEntry): string => {
    const verdict = verdicts.value.get(keyOf(entry));
    return verdict?.state === "missing" ? needsDataText(verdict.missing) : "";
  };

  return { check, needsData };
}
