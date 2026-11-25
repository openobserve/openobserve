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

// Bundle entry for bundle.spec.ts: the core with en-us, plus one lazy locale load.
import { EN_US_TIME_RANGE_PACK, loadTimeRangeLocale, parseTimeRangeInput } from "../index";

export async function probe(): Promise<string> {
  const de = await loadTimeRangeLocale("de");
  return [EN_US_TIME_RANGE_PACK.locale, de.locale, typeof parseTimeRangeInput].join(",");
}
