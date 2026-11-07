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

import { formatInTimeZone } from "date-fns-tz";

import type { SegmentedFieldStatus } from "@/lib/forms/SegmentedField/OSegmentedField.types";
import { formatUtcOffsetAt, wallInstants } from "@/utils/rangeText";

const MICROS_PER_SECOND = 1_000_000;

/** The last second of a day; an End reading it stands for the next midnight, since the backend end is exclusive. */
export const END_OF_DAY = "23:59:59";
export const START_OF_DAY = "00:00:00";

export type DraftEdgeName = "start" | "end";

/** One end of the Custom range draft: `YYYY-MM-DD`, 24h `HH:mm:ss`, and the offset chosen in a repeated hour. */
export interface DraftEdge {
  date: string;
  time: string;
  offset: string;
}

export interface RangeDraft {
  start: DraftEdge;
  end: DraftEdge;
}

/** What each field part reports, so an incomplete part is told apart from an empty one. */
export interface DraftFieldStatus {
  startDate: SegmentedFieldStatus;
  startTime: SegmentedFieldStatus;
  endDate: SegmentedFieldStatus;
  endTime: SegmentedFieldStatus;
}

export type DraftEdgeError =
  | "incomplete-date"
  | "incomplete-time"
  | "invalid-date"
  | "out-of-range"
  | "skipped"
  | "end-before-start";

export interface DraftValidation {
  valid: boolean;
  start: DraftEdgeError | null;
  end: DraftEdgeError | null;
  /** The instants the draft sends, End already moved past a 23:59:59; null while invalid. */
  startUs: number | null;
  endUs: number | null;
}

export interface EdgeInstant {
  us: number | null;
  /** The wall time falls in a spring-forward gap. */
  skipped: boolean;
  /** Both offsets of a repeated wall time, earlier first; empty otherwise. */
  offsets: string[];
}

export const emptyEdge = (): DraftEdge => ({ date: "", time: "", offset: "" });

export const emptyDraft = (): RangeDraft => ({ start: emptyEdge(), end: emptyEdge() });

export const emptyFieldStatus = (): DraftFieldStatus => ({
  startDate: "empty",
  startTime: "empty",
  endDate: "empty",
  endTime: "empty",
});

export const toIsoDate = (date: string): string => date.replace(/\//g, "-");

export const toSlashDate = (date: string): string => date.replace(/-/g, "/");

/** The draft for an applied range: an end at an exclusive midnight reads as the previous day's 23:59:59. */
export const draftFromRange = (startUs: number, endUs: number, zone: string): RangeDraft => ({
  start: edgeFromInstant(startUs, zone),
  end: edgeFromInstant(endsAtMidnight(startUs, endUs, zone) ? endUs - 1 : endUs, zone),
});

/** A wall time in the zone as an instant; a repeated hour takes the chosen offset, else its first occurrence. */
export const edgeInstant = (edge: DraftEdge, zone: string): EdgeInstant => {
  if (!edge.date || !edge.time) return { us: null, skipped: false, offsets: [] };
  const instants = wallInstants(edge.date, edge.time, zone);
  if (instants.length === 0) return { us: null, skipped: true, offsets: [] };
  const offsets = instants.length > 1 ? instants.map((ms) => formatUtcOffsetAt(ms, zone)) : [];
  const chosen = offsets.indexOf(edge.offset);
  return { us: instants[chosen === -1 ? 0 : chosen] * 1000, skipped: false, offsets };
};

/** The instant an End sends: 23:59:59 means through that second, so it is sent as the next midnight. */
export const endInstantUs = (edge: DraftEdge, zone: string): number | null => {
  const { us } = edgeInstant(edge, zone);
  if (us === null) return null;
  return edge.time === END_OF_DAY ? us + MICROS_PER_SECOND : us;
};

/** Checks the draft the way Apply does; an empty part is not an error, only not appliable. */
export const validateDraft = (
  draft: RangeDraft,
  status: DraftFieldStatus,
  zone: string,
  dateOnly = false,
): DraftValidation => {
  const start = edgeError(status.startDate, dateOnly ? "valid" : status.startTime);
  const end = edgeError(status.endDate, dateOnly ? "valid" : status.endTime);
  const startEdge = dateOnly ? { ...draft.start, time: START_OF_DAY } : draft.start;
  const endEdge = dateOnly ? { ...draft.end, time: END_OF_DAY } : draft.end;
  const startInstant = edgeInstant(startEdge, zone);
  const endUs = endInstantUs(endEdge, zone);
  const startError = start ?? (startInstant.skipped ? "skipped" : null);
  const endSkipped = edgeInstant(endEdge, zone).skipped;
  let endError = end ?? (endSkipped ? "skipped" : null);
  const startUs = startInstant.us;
  if (!startError && !endError && startUs !== null && endUs !== null && endUs <= startUs) {
    endError = "end-before-start";
  }
  const filled = startUs !== null && endUs !== null;
  const valid = filled && !startError && !endError;
  return {
    valid,
    start: startError,
    end: endError,
    startUs: valid ? startUs : null,
    endUs: valid ? endUs : null,
  };
};

/** Whether two drafts name the same wall times and offsets. */
export const sameDraft = (a: RangeDraft, b: RangeDraft): boolean =>
  (["start", "end"] as const).every(
    (edge) =>
      a[edge].date === b[edge].date &&
      a[edge].time === b[edge].time &&
      a[edge].offset === b[edge].offset,
  );

const edgeFromInstant = (us: number, zone: string): DraftEdge => {
  const ms = Math.floor(us / 1000);
  const date = formatInTimeZone(ms, zone, "yyyy-MM-dd");
  const time = formatInTimeZone(ms, zone, "HH:mm:ss");
  const instants = wallInstants(date, time, zone);
  return { date, time, offset: instants.length > 1 ? formatUtcOffsetAt(ms, zone) : "" };
};

const endsAtMidnight = (startUs: number, endUs: number, zone: string): boolean =>
  endUs > startUs &&
  endUs % MICROS_PER_SECOND === 0 &&
  formatInTimeZone(Math.floor(endUs / 1000), zone, "HH:mm:ss") === START_OF_DAY;

const edgeError = (
  date: SegmentedFieldStatus,
  time: SegmentedFieldStatus,
): DraftEdgeError | null => {
  if (date === "invalid") return "invalid-date";
  if (date === "out-of-range") return "out-of-range";
  if (date === "incomplete") return "incomplete-date";
  if (time === "incomplete") return "incomplete-time";
  if (date === "empty" && time !== "empty") return "incomplete-date";
  if (time === "empty" && date !== "empty") return "incomplete-time";
  return null;
};
