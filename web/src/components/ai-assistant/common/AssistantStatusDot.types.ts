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

export type AssistantSignal = "working" | "attention" | "failed" | "unread";

export type AssistantSignalShape = "ring" | "dot-count" | "glyph" | "dot";

/** One shape per signal so colour is never the only cue: ring, dot + count, glyph, neutral dot. */
export const assistantSignalShape: Record<AssistantSignal, AssistantSignalShape> = {
  working: "ring",
  attention: "dot-count",
  failed: "glyph",
  unread: "dot",
};

export interface AssistantStatusDotProps {
  state: AssistantSignal;
  /** Needs-you count; assistive tech reads it at every width, and it shows visually from md up. */
  count?: number;
  /** Position relative to a positioned parent. */
  placement?: "corner" | "inline";
}
