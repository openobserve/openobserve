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

import type { ChipTone } from "@/lib/core/Badge/OBadge.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { Tone } from "./kubernetesModel";

export interface TonePill {
  variant: ChipTone;
  icon: IconName;
}

// Every pill carries an icon, so state never rests on colour alone.
export const TONE_PILL: Record<Tone, TonePill> = {
  success: { variant: "ok", icon: "check-circle" },
  error: { variant: "err", icon: "error" },
  warning: { variant: "warn", icon: "warning" },
  info: { variant: "neutral", icon: "info" },
  neutral: { variant: "neutral", icon: "schedule" },
};
