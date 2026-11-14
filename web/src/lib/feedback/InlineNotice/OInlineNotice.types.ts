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
import type { NoticeActionVariant } from "@/lib/feedback/Banner/OBanner.types";

export type InlineNoticeTone = "neutral" | "info" | "warn" | "err" | "ok";

export const INLINE_NOTICE_TONES = [
  "neutral",
  "info",
  "warn",
  "err",
  "ok",
] as const satisfies readonly InlineNoticeTone[];

export interface InlineNoticeProps {
  tone?: InlineNoticeTone;
  /** The condition of this section; wraps, never cut. The default slot replaces it with rich text. */
  message?: I18nText;
  /** A glyph that names the condition (lock, history) in place of the tone's own. */
  icon?: IconName;
  /** Label of the one action; the `#actions` slot replaces it. */
  actionLabel?: I18nText;
  actionVariant?: NoticeActionVariant;
  actionDataTest?: string;
}

export interface InlineNoticeEmits {
  (e: "action", event: MouseEvent): void;
}

export interface InlineNoticeSlots {
  default?: () => unknown;
  /** One small control, end-aligned; buttons inside default to the `sm` height. */
  actions?: () => unknown;
}
