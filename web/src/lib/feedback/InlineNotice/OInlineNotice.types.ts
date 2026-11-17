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

export type InlineNoticeVariant = "warning" | "error";

export interface InlineNoticeProps {
  /** The sentence; cut with "…" in tight space, full text in its tooltip. */
  text: I18nText;
  /** `error` is red and an alert, for a check that failed; `warning` is amber and a status. */
  variant?: InlineNoticeVariant;
  /** Label of the one text action after the sentence; never cut. */
  actionLabel?: I18nText;
  dataTest?: string;
  /** `data-test` of the action button. */
  actionDataTest?: string;
}

export interface InlineNoticeEmits {
  (e: "action", event: MouseEvent): void;
}
