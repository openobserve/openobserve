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

import { z } from "zod";
import { RETENTION_STREAM_TYPES, type RetentionKey } from "@/utils/dataRetention";

export const MIN_RETENTION_DAYS = 3;

const isEmpty = (value: unknown): boolean => value === "" || value === null || value === undefined;

// Mirrors the backend's save check; there is no upper limit.
const isValidDays = (value: unknown): boolean => {
  const days = Number(value);
  return Number.isInteger(days) && (days === 0 || days >= MIN_RETENTION_DAYS);
};

export const makeDataRetentionDefaultsSchema = (t: (_key: string) => string) => {
  const invalid = { message: t("settings.dataRetentionDefaults.invalid") };
  const invalidType = { message: t("settings.dataRetentionDefaults.invalidType") };
  return z.object({
    default: z.any().refine((value) => isEmpty(value) || isValidDays(value), invalid),
    types: z.array(
      z.object({
        type: z.enum(RETENTION_STREAM_TYPES),
        // Empty or 0 would save as "no override" and drop the row; removing a type is the row's own control.
        days: z
          .any()
          .refine(
            (value) => !isEmpty(value) && isValidDays(value) && Number(value) > 0,
            invalidType,
          ),
      }),
    ),
  });
};

export type DataRetentionDefaultsForm = z.infer<ReturnType<typeof makeDataRetentionDefaultsSchema>>;

export type DataRetentionPayload = Partial<Record<RetentionKey, number>>;

export const toRetentionFormValues = (
  stored?: DataRetentionPayload,
): DataRetentionDefaultsForm => ({
  default: stored?.default && stored.default > 0 ? stored.default : "",
  types: RETENTION_STREAM_TYPES.filter((type) => (stored?.[type] ?? 0) > 0).map((type) => ({
    type,
    days: stored?.[type],
  })),
});

// An empty default is sent as 0 and a removed type is left out: both mean "use the global value".
export const toRetentionPayload = (value: DataRetentionDefaultsForm): DataRetentionPayload => {
  const payload: DataRetentionPayload = { default: Number(value.default || 0) };
  for (const row of value.types) payload[row.type] = Number(row.days);
  return payload;
};

type RetentionRows = DataRetentionDefaultsForm["types"] | undefined;

/** Stream types added, removed or given other days than saved: one change each. */
export const retentionRowChanges = (current: RetentionRows, saved: RetentionRows): number => {
  const days = (rows: RetentionRows) =>
    new Map((rows ?? []).map((row) => [row.type, String(row.days ?? "")]));
  const now = days(current);
  const before = days(saved);
  const edited = [...now].filter(([type, value]) => before.get(type) !== value).length;
  const removed = [...before.keys()].filter((type) => !now.has(type)).length;
  return edited + removed;
};
