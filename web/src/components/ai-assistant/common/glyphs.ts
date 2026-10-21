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

import type { ChipKind } from "@/composables/assistant";
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
  remove: "delete-outline",
  download: "file-download",
  info: "info-outline",
  attachImage: "image",
  send: "send",
  stop: "stop",
  jumpToLatest: "arrow-downward",
  hints: "keyboard",
  notReadHelp: "help-outline",
  addBack: "add",
  undo: "undo",
  openSource: "open-in-new",
  expand: "expand-more",
  collapse: "expand-less",
  chipTime: "schedule",
  chipStream: "storage",
  chipQuery: "code",
  chipPanel: "dashboard",
  chipAlert: "notifications",
  chipPipeline: "account-tree",
  chipIncident: "warning",
  chipLogRow: "list",
  chipCell: "table-chart",
  chipField: "label",
  chipSpan: "timeline",
  chipQueryError: "error-outline",
  chipImage: "image",
  chipReport: "description",
  previous: "chevron-left",
  next: "chevron-right",
  edit: "edit",
  copy: "content-copy",
  copied: "check",
  regenerate: "refresh",
  markdown: "code",
  newTab: "open-in-new",
  run: "play-arrow",
  helpful: "thumb-up-off-alt",
  notHelpful: "thumb-down-off-alt",
  verified: "task-alt",
  inferred: "lightbulb-outline",
  link: "call-made",
  warning: "warning",
  fork: "fork-right",
} as const satisfies Record<string, IconName>;

/** The glyph of each chip kind (`40` §2.1); the chip passes it to `OTag` as `icon`. */
export const chipGlyph = {
  time: assistantGlyph.chipTime,
  stream: assistantGlyph.chipStream,
  query: assistantGlyph.chipQuery,
  panel: assistantGlyph.chipPanel,
  alert: assistantGlyph.chipAlert,
  pipeline_node: assistantGlyph.chipPipeline,
  incident: assistantGlyph.chipIncident,
  log_row: assistantGlyph.chipLogRow,
  cell: assistantGlyph.chipCell,
  field: assistantGlyph.chipField,
  span: assistantGlyph.chipSpan,
  query_error: assistantGlyph.chipQueryError,
  image: assistantGlyph.chipImage,
  report: assistantGlyph.chipReport,
} as const satisfies Record<ChipKind, IconName>;

export type AssistantGlyph = keyof typeof assistantGlyph;
