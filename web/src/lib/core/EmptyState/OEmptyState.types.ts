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

/** `region`: a table body, page body or panel over 240 px, top-aligned at 64 px. `compact`: a short panel or cell, left-aligned. */
export type EmptyStateSize = "region" | "compact";

export const EMPTY_STATE_KINDS = [
  "first-run",
  "filtered",
  "denied",
  "error",
] as const satisfies readonly EmptyStateKind[];

export const EMPTY_STATE_SIZES = ["region", "compact"] as const satisfies readonly EmptyStateSize[];

export interface EmptyStateProps {
  /** Picks the default icon, copy and action. Defaults to `first-run`. */
  kind?: EmptyStateKind;
  /** Defaults to `region`. */
  size?: EmptyStateSize;
  /** Says what is empty; `filtered`, `denied` and `error` fall back to their own copy. */
  title?: I18nText;
  /** One or two sentences: why it is empty and what to do. */
  text?: I18nText;
  /** Overrides the kind's default icon. */
  icon?: IconName;
  /** Primary action; `error` defaults to Retry and `filtered` to Clear filters. */
  actionLabel?: I18nText;
  /** Region only: compact shows one action at most. */
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
  /** OButtons in place of the action buttons: md in a region, sm in compact, never cards. */
  actions?: () => unknown;
  /** Content below the actions, such as a checklist. */
  extra?: () => unknown;
}
