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

import type { ContentBlock } from "@/ts/interfaces/chat";

const DECISION_TYPES: ReadonlySet<ContentBlock["type"]> = new Set(["approval", "approval_result"]);

/** A decision record follows the prose that proposed it; the model's words stay as written, only the record moves below them. */
export function decisionsAfterProposal(blocks: readonly ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  let held: ContentBlock[] = [];
  for (const block of blocks) {
    if (DECISION_TYPES.has(block.type)) {
      held.push(block);
      continue;
    }
    // Only the text written right after the card is its proposal; anything else ends the run.
    if (held.length && block.type !== "text") {
      out.push(...held);
      held = [];
    }
    out.push(block);
  }
  return [...out, ...held];
}
