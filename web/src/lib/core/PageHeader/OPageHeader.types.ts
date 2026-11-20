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

import type { RouteLocationRaw } from "vue-router";
import type { I18nText } from "@/types/i18n";

interface PageHeaderBackBase {
  /** The parent's name, shown as "‹ {label}" in the context line (H4). */
  label: I18nText;
  dataTest?: string;
}

/**
 * The "‹ Parent" link of a detail, editor or import page. `to` is the parent page: the link's
 * href, and where Back lands when there is no history (N3). `onClick` replaces smart back.
 */
export type PageHeaderBack = PageHeaderBackBase &
  ({ to: RouteLocationRaw; onClick?: () => void } | { to?: undefined; onClick: () => void });

export interface PageHeaderProps {
  /** The page or object name; never the active tab's name (H8). */
  title?: I18nText;
  titleDataTest?: string;
  /** Replaces the context line with the parent link (H4, N3). */
  back?: PageHeaderBack;
  /** Overrides the context line derived from the rail group or the org. */
  context?: I18nText;
  /** Help that used to be a subtitle, behind an About button beside the title (H2). */
  about?: I18nText;
  /** Ends the band at this reading-column width (ConstrainedPage's scale); the rule still spans the header. */
  contentSize?: "sm" | "md" | "lg" | "xl";
}
