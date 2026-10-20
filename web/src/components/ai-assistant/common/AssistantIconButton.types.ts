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

import type { IconName } from "@/lib/core/Icon/OIcon.types";
import type { I18nText } from "@/types/i18n";

export interface AssistantIconButtonProps {
  /** Accessible name and tooltip; an icon-only control has no visible text to repeat. */
  label: I18nText;
  icon: IconName;
  /** Registry id whose keycaps the tooltip renders (OTooltip `shortcut-id`). */
  shortcutId?: string;
  variant?: "ghost" | "outline" | "secondary" | "primary";
  /** `sm` → OButton `icon-sm`, `toolbar` → `icon-toolbar`; 2.75 rem below md and on coarse pointers. */
  size?: "sm" | "toolbar";
  /** The busy spinner of an action in flight (Stop while stopping). */
  loading?: boolean;
  /** Renders `aria-pressed`. */
  pressed?: boolean;
  disabled?: boolean;
  /** Shown as the tooltip and `aria-describedby`; keeps the disabled button focusable so the reason can be read. */
  disabledReason?: I18nText;
  /** A small state glyph at the icon's corner (a locked door keeps its verb glyph). */
  badge?: IconName;
  /** Touch has no hover: a tooltip opened by a tap would stay over the page. */
  noTooltip?: boolean;
  dataTest: string;
}

export interface AssistantIconButtonSlots {
  /** Tooltip content that says more than the name, such as what a door sends; the name stays `label`. */
  tooltip?: () => unknown;
}

export interface AssistantIconButtonEmits {
  (e: "click", event: MouseEvent): void;
}
