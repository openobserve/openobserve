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

import { raw } from "@/types/i18n";

import AssistantAgentIdentity from "./AssistantAgentIdentity.vue";

const mark = (w: ReturnType<typeof mount>) => w.get('[data-test="assistant-mark"]');

describe("AssistantAgentIdentity", () => {
  it("shows the chip, name and time on a turn's meta row", () => {
    const w = mount(AssistantAgentIdentity, {
      props: { size: "meta", agent: "sre", time: raw("10:02") },
    });
    expect(w.get('[data-test="assistant-agent-identity-name"]').text()).toBe("Investigator");
    expect(w.get('[data-test="assistant-agent-identity-time"]').text()).toBe("10:02");
    expect(mark(w).attributes("aria-hidden")).toBe("true");
  });

  it("never omits the product's own agent", () => {
    const w = mount(AssistantAgentIdentity, { props: { size: "meta", agent: "o2-ai" } });
    expect(w.get('[data-test="assistant-agent-identity-name"]').text()).not.toBe("");
    expect(w.find('[data-test="assistant-agent-identity-time"]').exists()).toBe(false);
  });

  it("reads {agent} · {status} on the header's second line, and only the name without a status", () => {
    const w = mount(AssistantAgentIdentity, {
      props: { size: "header", agent: "generate-query", title: raw("Slow query") },
      slots: { status: "<span>Needs your approval</span>" },
    });
    expect(w.text()).toContain("Slow query");
    expect(w.get('[data-test="assistant-agent-identity-line"]').text()).toBe(
      "Query builder·Needs your approval",
    );
    const bare = mount(AssistantAgentIdentity, { props: { size: "header", agent: "sre" } });
    expect(bare.get('[data-test="assistant-agent-identity-line"]').text()).toBe("Investigator");
  });

  it("keeps the agent in the compact form's accessible name", () => {
    const w = mount(AssistantAgentIdentity, {
      props: { size: "compact", agent: "sre", title: raw("Checkout 5xx") },
    });
    expect(w.get('[data-test="assistant-agent-identity"]').attributes("aria-label")).toBe(
      "Checkout 5xx, Investigator",
    );
    expect(mark(w).attributes("data-size")).toBe("xs");
  });
});
