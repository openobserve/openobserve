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

export type NoticeTone = "info" | "warning" | "error";

export interface Notice {
  key: string;
  tone: NoticeTone;
  text: I18nText;
  actionLabel?: I18nText;
  onAction?: () => void;
  dataTest?: string;
}

export interface NoticeBarProps {
  notices: Notice[];
  dataTest?: string;
  /** data-test of the expand toggle. */
  toggleDataTest?: string;
}
