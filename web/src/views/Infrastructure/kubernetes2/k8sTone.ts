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

import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { Tone } from "./kubernetesModel";

export interface TonePill {
  variant: BadgeVariant;
  icon: IconName;
}

// Every pill carries an icon, so state never rests on colour alone.
export const TONE_PILL: Record<Tone, TonePill> = {
  success: { variant: "success-soft", icon: "check-circle" },
  error: { variant: "error-soft", icon: "error" },
  warning: { variant: "warning-soft", icon: "warning" },
  info: { variant: "default-soft", icon: "info" },
  neutral: { variant: "default-soft", icon: "schedule" },
};
