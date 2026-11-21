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

const mountGreeting = (email?: string) =>
  mount(AgentHomeGreeting, {
    global: { plugins: [i18n, createStore({ state: { userInfo: email ? { email } : {} } })] },
  });

describe("AgentHomeGreeting", () => {
  it("puts the name in the translated greeting as plain heading text, the spark to its left", () => {
    const wrapper = mountGreeting("marco.rossi@example.com");
    const heading = wrapper.get('[data-test="agent-home-greeting-text"]');
    expect(heading.element.tagName).toBe("H2");
    expect(heading.text()).toMatch(/, Marco$/);
    expect(heading.classes()).toEqual(expect.arrayContaining(["text-3xl", "max-md:text-2xl"]));
    const name = heading.get('[data-test="agent-home-greeting-name"]');
    expect(name.text()).toBe("Marco");
    // No gradient on assistant surfaces: the name reads in the heading's own colour.
    expect(name.classes()).not.toContain("text-transparent");
    expect(name.classes()).not.toContain("bg-gradient-brand-ribbon");
    expect(wrapper.find('[data-test="agent-home-greeting-mark"]').exists()).toBe(false);
    const spark = wrapper.get('[data-test="assistant-spark"]');
    expect(spark.attributes("aria-hidden")).toBe("true");
    expect(spark.element.nextElementSibling).toBe(heading.element);
    expect(wrapper.find("img").exists()).toBe(false);
  });

  it("greets without a name and draws no chips", () => {
    const wrapper = mountGreeting();
    expect(wrapper.find('[data-test="agent-home-greeting-name"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="agent-home-greeting-text"]').text()).not.toContain(",");
    expect(wrapper.find('[data-test="agent-home-greeting-answers"]').exists()).toBe(false);
  });
});
