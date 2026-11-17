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
import type { AutoObserveFindingKind } from "@/services/autoobserve";

// Mirrors `src/core/src/alerts/incidents.rs:45-47`.
export const FINDING_KIND_DIMENSION = "autoobserve_finding";
export const FINDING_STREAM_TYPE_DIMENSION = "stream_type";
export const FINDING_STREAM_NAME_DIMENSION = "stream_name";

// Mirrors `AlertKind::AutoObserve` (`src/config/src/meta/alerts/incidents.rs:483`).
export const AUTOOBSERVE_TRIGGER_KIND = "autoobserve";

type GroupValues = Record<string, string> | null | undefined;

interface TriggerLike {
  alert_kind?: string;
  alert_fired_at: number;
}

export interface DimensionDisplay {
  /** Null when the caller keeps its own label for the key. */
  label: I18nText | null;
  value: I18nText;
}

export interface FindingFacts {
  what: I18nText;
  streamType: string;
  streamName: string;
  /** The earliest finding trigger's `alert_fired_at` (microseconds), null when there is none. */
  startedAt: number | null;
}

// Display order of a finding's labels: what happened, then the stream, its name before its type.
const FINDING_DIMENSIONS = [
  FINDING_KIND_DIMENSION,
  FINDING_STREAM_NAME_DIMENSION,
  FINDING_STREAM_TYPE_DIMENSION,
] as const;

const LABEL_KEY: Record<(typeof FINDING_DIMENSIONS)[number], I18nKey> = {
  autoobserve_finding: "alerts.incidents.findingDimension",
  stream_type: "alerts.streamType",
  stream_name: "alerts.stream_name",
};

const KIND_KEY: Record<AutoObserveFindingKind, I18nKey> = {
  stream_silence: "alerts.incidents.findingKind.stream_silence",
  stream_drop: "alerts.incidents.findingKind.stream_drop",
  stream_rise: "alerts.incidents.findingKind.stream_rise",
};

const has = (record: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const isFindingDimension = (key: string): key is (typeof FINDING_DIMENSIONS)[number] =>
  has(LABEL_KEY, key);

/** A kind this build does not know reads as a generic finding, never as its raw id. */
const kindWord = (t: TranslateFn, kind: string): I18nText =>
  t(
    has(KIND_KEY, kind)
      ? KIND_KEY[kind as AutoObserveFindingKind]
      : "alerts.incidents.findingKind.other",
  );

/** An incident AutoObserve opened: it carries the finding dimension or a finding trigger. */
export const isFindingIncident = (
  groupValues: GroupValues,
  triggers?: readonly TriggerLike[] | null,
): boolean =>
  (!!groupValues && has(groupValues, FINDING_KIND_DIMENSION)) ||
  !!triggers?.some((trigger) => trigger.alert_kind === AUTOOBSERVE_TRIGGER_KIND);

/** One dimension as label and value; another incident's dimensions keep their own keys. */
export const dimensionDisplay = (
  t: TranslateFn,
  groupValues: GroupValues,
  key: string,
  value: string,
  triggers?: readonly TriggerLike[] | null,
): DimensionDisplay => {
  if (!isFindingIncident(groupValues, triggers) || !isFindingDimension(key)) {
    return { label: null, value: raw(value) };
  }
  return {
    label: t(LABEL_KEY[key]),
    value: key === FINDING_KIND_DIMENSION ? kindWord(t, value) : raw(value),
  };
};

/** A finding's dimension keys in display order, whatever order the server sent; another incident keeps its own. */
export const orderedDimensionKeys = (
  groupValues: GroupValues,
  triggers?: readonly TriggerLike[] | null,
): string[] => {
  const keys = Object.keys(groupValues ?? {});
  if (!isFindingIncident(groupValues, triggers)) return keys;
  return [
    ...FINDING_DIMENSIONS.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !isFindingDimension(key)),
  ];
};

/** Chip order for lists: a finding's in display order, any other incident's alphabetical. */
export const chipDimensionKeys = (groupValues: GroupValues): string[] =>
  isFindingIncident(groupValues)
    ? orderedDimensionKeys(groupValues)
    : Object.keys(groupValues ?? {}).sort();

/** What the side panel shows for a finding, or null when its dimensions cannot be read. */
export const findingFacts = (
  t: TranslateFn,
  groupValues: GroupValues,
  triggers?: readonly TriggerLike[] | null,
): FindingFacts | null => {
  const kind = groupValues?.[FINDING_KIND_DIMENSION];
  const streamType = groupValues?.[FINDING_STREAM_TYPE_DIMENSION];
  const streamName = groupValues?.[FINDING_STREAM_NAME_DIMENSION];
  if (!kind || !streamType || !streamName) return null;
  const fired = (triggers ?? [])
    .filter((trigger) => trigger.alert_kind === AUTOOBSERVE_TRIGGER_KIND && trigger.alert_fired_at)
    .map((trigger) => trigger.alert_fired_at);
  return {
    what: kindWord(t, kind),
    streamType,
    streamName,
    startedAt: fired.length ? Math.min(...fired) : null,
  };
};

export const findingLabels = (
  t: TranslateFn,
  groupValues: GroupValues,
): Record<string, string> | null => {
  if (!groupValues || !isFindingIncident(groupValues)) return null;
  const labels: Record<string, string> = {};
  for (const key of FINDING_DIMENSIONS) {
    const value = groupValues[key];
    if (value) labels[t(LABEL_KEY[key])] = dimensionDisplay(t, groupValues, key, value).value;
  }
  return Object.keys(labels).length ? labels : null;
};
