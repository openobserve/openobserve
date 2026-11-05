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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import AssistantHandoffSuggestion from "./AssistantHandoffSuggestion.vue";

const card = (w: ReturnType<typeof mount>) => w.get('[data-test="assistant-handoff-suggestion"]');

describe("AssistantHandoffSuggestion", () => {
  it("shows the title, the body and both actions in tab order", () => {
    const w = mount(AssistantHandoffSuggestion, { props: { agent: "sre" } });
    expect(card(w).text()).toContain("Investigator can look for the cause");
    expect(w.get('[data-test="assistant-handoff-suggestion-body"]').text()).toBe(
      "It gets this chat and its context. It can take a few minutes.",
    );
    const buttons = w.findAll("button").map((button) => button.text());
    expect(buttons).toEqual(["Hand off to Investigator", "Not now"]);
  });

  it("mentions credits only on a metered org", () => {
    const w = mount(AssistantHandoffSuggestion, { props: { agent: "sre", metered: true } });
    expect(w.get('[data-test="assistant-handoff-suggestion-body"]').text()).toContain(
      "Uses AI credits",
    );
  });

  it("reports Hand off and Not now, and Escape equals Not now", async () => {
    const w = mount(AssistantHandoffSuggestion, { props: { agent: "sre" } });
    await w.get('[data-test="assistant-handoff-suggestion-accept"]').trigger("click");
    await w.get('[data-test="assistant-handoff-suggestion-dismiss"]').trigger("click");
    await card(w).trigger("keydown", { key: "Escape" });
    expect(w.emitted("accept")).toHaveLength(1);
    expect(w.emitted("dismiss")).toHaveLength(2);
  });

  it("collapses to one line that can still hand off", async () => {
    const w = mount(AssistantHandoffSuggestion, { props: { agent: "sre", collapsed: true } });
    expect(w.text()).toContain("Investigator was suggested");
    expect(w.find('[data-test="assistant-handoff-suggestion"]').exists()).toBe(false);
    await w.get('[data-test="assistant-handoff-suggestion-reopen"]').trigger("click");
    expect(w.emitted("accept")).toHaveLength(1);
  });
});
