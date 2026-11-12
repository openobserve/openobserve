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

import type { I18nText } from "@/types/i18n";

export interface FailedPillProps {
  /** The failure in full; shown cut with "…", or in the marker's tooltip and hidden text. */
  sentence: I18nText;
  /** Short words for a pill too narrow for the sentence, which then moves to their tooltip. */
  marker?: I18nText;
  /** Off when another control on the page already retries this failure. */
  retry?: boolean;
  dataTest?: string;
}

export interface FailedPillEmits {
  (e: "retry", event: MouseEvent): void;
}
