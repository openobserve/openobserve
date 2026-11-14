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

import { describe, expect, it } from "vitest";

import { approvalOf } from "@/composables/assistant/reducer";
import type { ContentBlock } from "@/ts/interfaces/chat";

import { decisionsAfterProposal } from "./approvalPlacement";

const card: ContentBlock = {
  type: "approval",
  approval: approvalOf({
    type: "confirmation_required",
    call_id: "c9",
    tool: "UpdateAlert",
    kind: "update",
    targets: [{ type: "alert", id: "a1", name: "update_target" }],
  }),
};
const resolved: ContentBlock = {
  type: "approval_result",
  resolved: { id: "c9", approved: true, recorded: true, outcome: "done", at: 1 },
};
const proposal: ContentBlock = {
  type: "text",
  text: "I proposed changing the alert's threshold to 4 and its period to 15 minutes.",
};

describe("decisionsAfterProposal (B-approvals-rca-16)", () => {
  it("puts the record after the 'I proposed …' text the model wrote after the card, text unchanged", () => {
    const lead: ContentBlock = { type: "text", text: "Looking up the alert." };
    const out = decisionsAfterProposal([lead, card, resolved, proposal]);
    expect(out).toEqual([lead, proposal, card, resolved]);
    expect(out[1]).toBe(proposal);
  });

  it("keeps the record before a later step, so it never jumps past what came next", () => {
    const step: ContentBlock = { type: "tool_call", call_id: "c10", tool: "GetAlert" };
    expect(decisionsAfterProposal([card, proposal, step])).toEqual([proposal, card, step]);
    expect(decisionsAfterProposal([card, step, proposal])).toEqual([card, step, proposal]);
  });
});
