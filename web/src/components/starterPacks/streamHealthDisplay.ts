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

import type { StreamHealthState } from "@/composables/starterPacks/usePackHealth";
import type { I18nKey } from "@/types/i18n";

/** "none" is a stream nobody has checked yet, or an item that is not made. */
export type StreamDot = StreamHealthState | "none";

export const DOT_CLASS: Record<StreamDot, string> = {
  receiving: "bg-status-success-text",
  stopped: "bg-status-error-text",
  never: "bg-status-error-text",
  unknown: "bg-status-warning-text",
  none: "bg-border-strong",
};

export const STREAM_STATE_KEY: Record<StreamHealthState, I18nKey> = {
  receiving: "starterPacks.page.streams.receiving",
  stopped: "starterPacks.page.streams.stopped",
  never: "starterPacks.page.streams.never",
  unknown: "starterPacks.page.streams.unknown",
};

const WORST: StreamDot[] = ["stopped", "never", "unknown", "receiving", "none"];

/** The dot for several streams is the worst of theirs, so one stopped stream shows on every item it breaks. */
export const worstDot = (states: StreamDot[]): StreamDot =>
  WORST.find((state) => states.includes(state)) ?? "none";
