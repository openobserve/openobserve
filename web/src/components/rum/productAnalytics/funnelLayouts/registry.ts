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

import type { Component } from "vue";

declare global {
  interface Window {
    _o2_paFunnelLayout?: string;
  }
}

// The first key is the default, so a missing or unknown choice always lands on it.
export const FUNNEL_LAYOUTS = {
  inline: () => import("./inline/FunnelLayoutInline.vue"),
  rail: () => import("./rail/FunnelLayoutRail.vue"),
} satisfies Record<string, () => Promise<{ default: Component }>>;

export type FunnelLayoutName = keyof typeof FUNNEL_LAYOUTS;

export function funnelLayoutName(choice: unknown): FunnelLayoutName {
  return typeof choice === "string" && Object.prototype.hasOwnProperty.call(FUNNEL_LAYOUTS, choice)
    ? (choice as FunnelLayoutName)
    : (Object.keys(FUNNEL_LAYOUTS)[0] as FunnelLayoutName);
}
