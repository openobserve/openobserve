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

/** The assistant's glyphs; assistant code names icons only through this map (`90` §4.1). */
export const assistantGlyph = {
  assistant: "auto-awesome",
  explain: "lightbulb-outline",
  troubleshoot: "build",
  addToChat: "add-comment",
  helper: "auto-fix-high",
  locked: "lock",
  notSetUp: "settings",
  working: "progress-activity",
  waiting: "pause",
  stopped: "stop-circle",
  failed: "error-outline",
  done: "check",
  elsewhere: "tab",
  notSaved: "cloud-off",
  interrupted: "remove-circle-outline",
  expired: "schedule",
  restored: "swap-horiz",
  refused: "info-outline",
  openFull: "open-in-full",
  close: "close",
  history: "history",
  newChat: "add",
  share: "share",
  more: "more-vert",
  pin: "push-pin",
  info: "info-outline",
  attachImage: "image",
  send: "send",
  stop: "stop",
  jumpToLatest: "arrow-downward",
} as const satisfies Record<string, IconName>;

export type AssistantGlyph = keyof typeof assistantGlyph;
