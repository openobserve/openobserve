// Copyright 2023 OpenObserve Inc.
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

/**
 * Worker-safe date/time utilities ΓÇö NO Quasar import.
 *
 * Functions that depend on Quasar's `date` helper (e.g. `convertOffsetToSeconds`)
 * live in `dateTimeUtils.ts`. This module contains only pure functions that can
 * safely run inside a Web Worker.
 */

// Check if the sample is time series (ISO-8601 "YYYY-MM-DDTHH:MM:SS" strings)
export const isTimeSeries = (sample: any) => {
  const iso8601Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
  return sample.every((value: any) => {
    return iso8601Pattern.test(value);
  });
};
