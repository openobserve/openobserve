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

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nText } from "@/types/i18n";

/** One headline figure on the query detail page: what it is, what it reads, and what it is worth. */
export interface DbmMetricTile {
  id: string;
  label: I18nText;
  /** The formal name the plain-English label stands for, e.g. `p95`. */
  sub?: I18nText;
  value: I18nText;
  /** The caption under the figure: how it changed, or how exact it is. */
  detail?: I18nText;
  /** A colour class, applied only where the page's own threshold fired. */
  tone?: string;
  /** Colour class for the caption, to tint a signed delta by direction. */
  detailTone?: string;
  icon?: IconName;
  /** The figure came from the application's traces, so it carries the app-source marker. */
  fromApp?: boolean;
}
