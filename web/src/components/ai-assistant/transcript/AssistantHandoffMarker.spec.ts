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

import AssistantHandoffMarker from "./AssistantHandoffMarker.vue";

const base = { agent: "sre", questions: 2, answers: 2 } as const;

describe("AssistantHandoffMarker", () => {
  it("names the agent and the time, and keeps the disclosure closed", () => {
    const w = mount(AssistantHandoffMarker, { props: { ...base, at: 1_000 } });
    expect(w.get('[data-test="assistant-handoff-label"]').text()).toContain(
      "Handed to Investigator by you ·",
    );
    expect(w.get('[data-test="assistant-handoff-given"]').attributes("aria-expanded")).toBe(
      "false",
    );
    expect(w.get('[data-test="assistant-handoff-given-panel"]').isVisible()).toBe(false);
  });

  it("drops the time it does not have", () => {
    const w = mount(AssistantHandoffMarker, { props: base });
    expect(w.get('[data-test="assistant-handoff-label"]').text()).toBe(
      "Handed to Investigator by you",
    );
  });

  it("lists what was carried and what was not", async () => {
    const w = mount(AssistantHandoffMarker, {
      props: { ...base, chips: ["Stream · checkout", "Time · 1h"], withdrewApproval: true },
      attachTo: document.body,
    });
    await w.get('[data-test="assistant-handoff-given"]').trigger("click");
    const panel = w.get('[data-test="assistant-handoff-given-panel"]');
    expect(w.get('[data-test="assistant-handoff-given"]').attributes("aria-expanded")).toBe("true");
    expect(w.get('[data-test="assistant-handoff-given"]').attributes("aria-controls")).toBe(
      panel.attributes("id"),
    );
    expect(panel.text()).toContain("This chat so far: 2 questions, 2 answers");
    expect(panel.text()).toContain("Context: Stream · checkout, Time · 1h");
    expect(panel.text()).toContain("Not carried: the pending approval");
    w.unmount();
  });

  it("leaves out the lines with nothing to say", () => {
    const w = mount(AssistantHandoffMarker, { props: base });
    expect(w.find('[data-test="assistant-handoff-context"]').exists()).toBe(false);
    expect(w.find('[data-test="assistant-handoff-not-carried"]').exists()).toBe(false);
  });
});
