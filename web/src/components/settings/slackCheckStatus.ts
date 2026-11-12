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
import type { SlackCheckStatus } from "@/types/slack";

const ICONS: Record<SlackCheckStatus, IconName> = {
  pass: "check-circle",
  warn: "warning-amber",
  fail: "cancel",
};

const ICON_CLASSES: Record<SlackCheckStatus, string> = {
  pass: "text-status-positive",
  warn: "text-status-warning-text",
  fail: "text-status-negative",
};

export const checkIcon = (status: SlackCheckStatus): IconName => ICONS[status];

export const checkIconClass = (status: SlackCheckStatus): string => ICON_CLASSES[status];
