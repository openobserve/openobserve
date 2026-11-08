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
import { RETENTION_STREAM_TYPES } from "@/utils/dataRetention";

export const MIN_RETENTION_DAYS = 3;

const isEmpty = (value: unknown): boolean => value === "" || value === null || value === undefined;

// Mirrors the backend's save check; there is no upper limit.
const isValidDays = (value: unknown): boolean => {
  const days = Number(value);
  return Number.isInteger(days) && (days === 0 || days >= MIN_RETENTION_DAYS);
};

export const makeDataRetentionDefaultsSchema = (t: (_key: string) => string) => {
  const invalid = { message: t("settings.dataRetentionDefaults.invalid") };
  return z.object({
    // Empty inherits; a row exists to say something, so its days are required.
    default: z.any().refine((value) => isEmpty(value) || isValidDays(value), invalid),
    types: z.array(
      z.object({
        type: z.enum(RETENTION_STREAM_TYPES),
        days: z.any().refine((value) => !isEmpty(value) && isValidDays(value), invalid),
      }),
    ),
  });
};

export type DataRetentionDefaultsForm = z.infer<ReturnType<typeof makeDataRetentionDefaultsSchema>>;
