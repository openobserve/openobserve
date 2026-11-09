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

import type { StoredTurn } from "@/composables/assistant/pure";

export interface ProposalSeedInput {
  turnId: string;
  /** Epoch ms. */
  now: number;
  prompt: string;
  query: string;
  language: string;
  stream?: string;
  /** Epoch ms, the window the helper wrote and checked the query for. */
  range?: { from: number; to: number } | null;
  validated?: boolean;
}

/** The helper's finished proposal as a stored Query builder turn, in the frame shapes a live turn streams. */
export function proposalSeedTurn(input: ProposalSeedInput): StoredTurn {
  const { range } = input;
  return {
    turn_id: input.turnId,
    created: input.now,
    user: { text: input.prompt },
    status: "completed",
    frames: [
      { type: "turn_started", turn_id: input.turnId, agent_type: "generate-query" },
      {
        type: "query",
        language: input.language,
        text: input.query,
        ...(input.stream && { stream: input.stream }),
        ...(range && range.to > range.from && { time_range: { from: range.from, to: range.to } }),
        ...(typeof input.validated === "boolean" && { validated: input.validated }),
      },
      { type: "complete" },
    ],
  };
}
