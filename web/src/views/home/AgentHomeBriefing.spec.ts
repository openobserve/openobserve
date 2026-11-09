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
import { describe, expect, it, vi } from "vitest";

import i18n from "@/locales";

vi.mock("@/composables/assistant", () => ({ openAssistant: vi.fn() }));

import AgentHomeBriefing from "./AgentHomeBriefing.vue";

describe("AgentHomeBriefing", () => {
  it("keeps the card its own height in the column rail instead of growing into it", () => {
    const wrapper = mount(AgentHomeBriefing, {
      props: { canBrief: true },
      global: { plugins: [i18n] },
    });
    const card = wrapper.get('[data-test="agent-home-brief-me"]');
    expect(card.classes()).toContain("flex-none!");
    expect(card.classes()).toContain("basis-auto");
  });
});
