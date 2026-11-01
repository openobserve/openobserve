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

import { shallowRef, type InjectionKey } from "vue";

import type { WindowCorner } from "@/composables/assistant";

export type WindowSizeStep = "wider" | "narrower" | "taller" | "shorter";

export type WindowKeyboardMode = "move" | "resize";

/** What a window lends its Layout menu: the moves only a window can do. */
export interface AssistantWindowHost {
  otherCorners(): WindowCorner[];
  moveTo(corner: WindowCorner): void;
  sizeLimited(step: WindowSizeStep): boolean;
  stepSize(step: WindowSizeStep): void;
  resetSize(): void;
  startMode(mode: WindowKeyboardMode): void;
}

export const assistantWindowHostKey: InjectionKey<AssistantWindowHost> =
  Symbol("assistantWindowHost");

/** A sidebar tear-off the new window carries on, under the same pointer. */
export interface TearOffDrag {
  sid: string;
  pointerId: number;
  clientX: number;
  clientY: number;
}

/** Set by the sidebar host as it tears a chat off; the window born from it takes the gesture over. */
export const tearOffRequest = /* @__PURE__ */ shallowRef<TearOffDrag | null>(null);
