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

// Matches 19+ digit integers in start_time/end_time fields — nanosecond epoch
// values that exceed JS Number precision (safe up to ~15-16 digits).
// (?<!\\) skips escaped-quote sequences (\"start_time\") inside JSON string values.
const NS_FIELDS_RE = /(?<!\\)"(start_time|end_time)"\s*:\s*(\d{19,})/g;

// Injects string shadow fields (_start_time_ns / _end_time_ns) into raw JSON
// before JSON.parse so the exact nanosecond values are preserved as strings.
// streamWorker.js keeps an inline copy of this logic since it cannot import TS.
export function patchNsFieldsInJson(text: string): string {
  NS_FIELDS_RE.lastIndex = 0;
  return text.replace(NS_FIELDS_RE, '"$1":$2,"_$1_ns":"$2"');
}
