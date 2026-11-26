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

/** One scope dimension: its current value, the values available, and its setter. */
export interface DbmScopeFilter {
  key: string;
  /** Plain-language name of the axis; the colour comes from `key`, not this. */
  dimension: I18nText;
  value: string | null;
  placeholder: I18nText;
  options: { value: string; label: I18nText }[];
  onChange: (value: unknown) => void;
  /** Display-only lock (Metrics tab); other tabs never set it. */
  disabled?: boolean;
  disabledReason?: I18nText;
}
