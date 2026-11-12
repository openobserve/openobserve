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
import { createStore } from "vuex";

import i18n from "@/locales";

import AgentHomeGreeting from "./AgentHomeGreeting.vue";

const mountGreeting = (email?: string, props: Record<string, number> = {}) =>
  mount(AgentHomeGreeting, {
    props,
    global: { plugins: [i18n, createStore({ state: { userInfo: email ? { email } : {} } })] },
  });

describe("AgentHomeGreeting", () => {
  it("highlights the name inside the translated greeting, beside the plain logo", () => {
    const wrapper = mountGreeting("marco.rossi@example.com");
    const heading = wrapper.get('[data-test="agent-home-greeting-text"]');
    expect(heading.element.tagName).toBe("H2");
    expect(heading.text()).toMatch(/, Marco$/);
    expect(heading.classes()).toEqual(expect.arrayContaining(["text-3xl", "max-md:text-2xl"]));
    const name = heading.get('[data-test="agent-home-greeting-name"]');
    expect(name.text()).toBe("Marco");
    expect(name.classes()).toEqual(
      expect.arrayContaining(["bg-gradient-brand-ribbon", "text-transparent"]),
    );
    const mark = wrapper.get('[data-test="agent-home-greeting-mark"]');
    expect(mark.find(".blur-lg").exists()).toBe(false);
    expect(mark.find('[data-test="assistant-mark"]').exists()).toBe(false);
    expect(mark.get('[data-test="agent-home-greeting-logo"]').attributes("src")).toContain(
      "o2_ai_logo",
    );
  });

  it("greets without a name, keeps the answers-ready chip and draws no needs-you chip", () => {
    const wrapper = mountGreeting(undefined, { answersReady: 2, needYou: 3 });
    expect(wrapper.find('[data-test="agent-home-greeting-name"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="agent-home-greeting-text"]').text()).not.toContain(",");
    expect(wrapper.get('[data-test="agent-home-greeting-answers"]').text()).toContain("2");
    expect(wrapper.find('[data-test="agent-home-greeting-need-you"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/need/i);
  });
});
