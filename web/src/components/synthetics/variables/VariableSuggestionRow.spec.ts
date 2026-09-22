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

import { afterEach, describe, expect, it } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import type { VariableSuggestion } from "./suggestions";
import VariableSuggestionRow from "./VariableSuggestionRow.vue";

const OIconStub = { props: ["name", "size"], template: '<i v-bind="$attrs" :data-icon="name" />' };
const OTooltipStub = {
  props: ["content", "side"],
  template: '<span :data-tip="content"><slot /></span>',
};

function suggestion(over: Partial<VariableSuggestion> = {}): VariableSuggestion {
  return { name: "BASE_URL", envs: ["staging"], global: false, secret: false, gap: [], ...over };
}

function mountRow(props: Partial<{ suggestion: VariableSuggestion; active: boolean }> = {}) {
  return mount(VariableSuggestionRow, {
    props: { suggestion: suggestion(), active: false, ...props },
    global: { plugins: [i18n], stubs: { OIcon: OIconStub, OTooltip: OTooltipStub } },
  }) as VueWrapper;
}

const scopeSel = '[data-test="synthetics-variable-suggestion-scope-icon"]';
const gapSel = '[data-test="synthetics-variable-suggestion-gap"]';
const secretSel = '[data-test="synthetics-variable-suggestion-secret"]';

describe("VariableSuggestionRow", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("shows the name in mono with its environment names", () => {
    wrapper = mountRow({ suggestion: suggestion({ envs: ["staging", "prod"] }) });
    const name = wrapper.find('[data-test="synthetics-variable-suggestion-name"]');
    expect(name.text()).toBe("BASE_URL");
    expect(name.classes()).toContain("font-mono");
    expect(wrapper.find('[data-test="synthetics-variable-suggestion-envs"]').text()).toBe(
      "staging, prod",
    );
  });

  it("uses the globe icon labelled Global for a global defined in no environment", () => {
    wrapper = mountRow({ suggestion: suggestion({ envs: [], global: true }) });
    const icon = wrapper.find(scopeSel);
    expect(icon.attributes("data-icon")).toBe("public");
    expect(icon.attributes("aria-label")).toBe("Global");
    expect(wrapper.find('[data-test="synthetics-variable-suggestion-envs"]').exists()).toBe(false);
  });

  it("labels a global overridden in an environment with the environment names alone", () => {
    wrapper = mountRow({ suggestion: suggestion({ envs: ["staging"], global: true }) });
    const icon = wrapper.find(scopeSel);
    expect(icon.attributes("data-icon")).toBe("layers");
    expect(icon.attributes("aria-label")).toBe("staging");
  });

  it("labels an environment-only variable with its environment names", () => {
    wrapper = mountRow({ suggestion: suggestion({ envs: ["staging", "prod"] }) });
    const icon = wrapper.find(scopeSel);
    expect(icon.attributes("data-icon")).toBe("layers");
    expect(icon.attributes("aria-label")).toBe("staging, prod");
  });

  it("gives a check-tier row the layers icon and no source label", () => {
    wrapper = mountRow({ suggestion: suggestion({ envs: [] }) });
    const icon = wrapper.find(scopeSel);
    expect(icon.attributes("data-icon")).toBe("layers");
    expect(icon.attributes("aria-label")).toBeUndefined();
  });

  it("warns with the coverage-gap tooltip only when gap is not empty", () => {
    wrapper = mountRow();
    expect(wrapper.find(gapSel).exists()).toBe(false);

    wrapper.unmount();
    wrapper = mountRow({ suggestion: suggestion({ gap: ["prod"] }) });
    const gap = wrapper.find(gapSel);
    expect(gap.attributes("data-icon")).toBe("warning");
    expect(gap.attributes("aria-label")).toBe("Not in prod");
    expect(wrapper.find("[data-tip]").attributes("data-tip")).toBe("Not in prod");
  });

  it("counts the environments once more than two are missing", () => {
    wrapper = mountRow({ suggestion: suggestion({ gap: ["a", "b", "c"] }) });
    expect(wrapper.find(gapSel).attributes("aria-label")).toBe("Not in 3 environments");
  });

  it("shows the lock with the secret tooltip only for a secret", () => {
    wrapper = mountRow();
    expect(wrapper.find(secretSel).exists()).toBe(false);

    wrapper.unmount();
    wrapper = mountRow({ suggestion: suggestion({ secret: true }) });
    const lock = wrapper.find(secretSel);
    expect(lock.attributes("data-icon")).toBe("lock");
    expect(wrapper.find("[data-tip]").attributes("data-tip")).toContain("Secret");
  });
});
