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

/** The four empty states of guideline K5; a failed load is `error`, never `first-run`. */
export type EmptyStateKind = "first-run" | "filtered" | "denied" | "error";

/** `page` fills a page or panel body; `inline` sits inside a table body, list or dropdown. */
export type EmptyStateSize = "page" | "inline";

export const EMPTY_STATE_KINDS = [
  "first-run",
  "filtered",
  "denied",
  "error",
] as const satisfies readonly EmptyStateKind[];

export const EMPTY_STATE_SIZES = ["page", "inline"] as const satisfies readonly EmptyStateSize[];

export interface EmptyStateProps {
  /** Picks the default icon, the tile tone and the default action. Defaults to `first-run`. */
  kind?: EmptyStateKind;
  /** Defaults to `page`. */
  size?: EmptyStateSize;
  /** Says what is empty. */
  title?: I18nText;
  /** One or two sentences: why it is empty and what to do. */
  text?: I18nText;
  /** Overrides the kind's default icon. */
  icon?: IconName;
  /** Primary action; `error` defaults to Retry and `filtered` to Clear filters. */
  actionLabel?: I18nText;
  secondaryActionLabel?: I18nText;
  /** Error detail, shown in mono under the text. */
  requestId?: string;
  /** Denied detail: who can grant access. */
  contact?: I18nText;
  /** Declared as props so the component can tell whether a listener is bound. */
  onAction?: () => void;
  onSecondaryAction?: () => void;
}

export interface EmptyStateSlots {
  /** Rich text in place of the `text` prop. */
  text?: () => unknown;
  /** Custom action content (onboarding cards) in place of the action buttons. */
  actions?: () => unknown;
  /** Content below the actions. */
  extra?: () => unknown;
}
