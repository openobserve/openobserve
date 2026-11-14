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

/** A page condition never succeeds, so the banner has no `ok`; a section notice does. */
export type BannerTone = "neutral" | "info" | "warn" | "err";

export const BANNER_TONES = [
  "neutral",
  "info",
  "warn",
  "err",
] as const satisfies readonly BannerTone[];

/** The one action: a secondary button, or a link for navigation. */
export type NoticeActionVariant = "secondary" | "link";

export interface BannerProps {
  tone?: BannerTone;
  /** The condition, what it affects and what to do; the default slot replaces it with rich text. */
  message?: I18nText;
  /** A glyph that names the condition (lock, history) in place of the tone's own. */
  icon?: IconName;
  /** Only for a condition the user can safely ignore. */
  dismissible?: boolean;
  /** Label of the one action; the `#actions` slot replaces it. */
  actionLabel?: I18nText;
  actionVariant?: NoticeActionVariant;
  actionDataTest?: string;
}

export interface BannerEmits {
  (e: "action", event: MouseEvent): void;
  (e: "dismiss"): void;
}

export interface BannerSlots {
  default?: () => unknown;
  /** One small control; buttons inside default to the `sm` height. */
  actions?: () => unknown;
}
