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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import { mockMonitorHttp } from "@/test/unit/mockData/synthetics";
import type { BrowserCheck } from "@/types/synthetics";

const { listEnvironmentsMock } = vi.hoisted(() => ({
  listEnvironmentsMock: vi.fn(() => Promise.resolve({ data: [] })),
}));
vi.mock("@/services/synthetics", () => ({
  default: { listEnvironments: listEnvironmentsMock },
}));

import CheckEnvironments from "./CheckEnvironments.vue";

const OCheckboxStub = {
  props: ["modelValue", "label", "disabled"],
  emits: ["update:modelValue"],
  template: `<label v-bind="$attrs"><input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit('update:modelValue', !modelValue)" />{{ label }}</label>`,
};
const OIconStub = { props: ["name", "size"], template: '<i v-bind="$attrs" />' };

const env = (id: string, name: string, description = "") => ({
  id,
  name,
  description,
  created_at: 0,
  updated_at: 0,
  checks_count: 0,
  variables: [],
});

function checkWith(environments: string[]): BrowserCheck {
  return { ...mockMonitorHttp, environments };
}

function mountCard(check: BrowserCheck) {
  return mount(CheckEnvironments, {
    props: { check },
    global: {
      plugins: [i18n],
      stubs: { OCheckbox: OCheckboxStub, OIcon: OIconStub },
      provide: { store: { state: { selectedOrganization: { identifier: "default" } } } },
    },
  }) as VueWrapper;
}

const sel = (suffix: string) => `[data-test="synthetics-check-environments${suffix}"]`;

describe("CheckEnvironments", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("renders one checkbox per environment with its description", async () => {
    listEnvironmentsMock.mockResolvedValueOnce({
      data: [env("e1", "staging", "Pre-prod stack"), env("e2", "qa")],
    } as never);
    wrapper = mountCard(checkWith([]));
    await flushPromises();

    expect(wrapper.find(sel("-row-staging")).text()).toContain("Pre-prod stack");
    expect(wrapper.find(sel("-row-qa")).exists()).toBe(true);
  });

  it("toggling emits update:check with the environment id added, then removed", async () => {
    listEnvironmentsMock.mockResolvedValueOnce({ data: [env("e1", "staging")] } as never);
    wrapper = mountCard(checkWith([]));
    await flushPromises();

    await wrapper.find(sel("-checkbox-staging")).find("input").trigger("change");
    expect(wrapper.emitted("update:check")![0][0]).toMatchObject({ environments: ["e1"] });

    await wrapper.setProps({ check: checkWith(["e1"]) });
    await wrapper.find(sel("-checkbox-staging")).find("input").trigger("change");
    expect(wrapper.emitted("update:check")![1][0]).toMatchObject({ environments: [] });
  });

  it("disables unchecked boxes at the cap, with the reason shown", async () => {
    const envs = Array.from({ length: 6 }, (_, i) => env(`e${i}`, `env_${i}`));
    listEnvironmentsMock.mockResolvedValueOnce({ data: envs } as never);
    wrapper = mountCard(checkWith(["e0", "e1", "e2", "e3", "e4"]));
    await flushPromises();

    expect(wrapper.find(sel("-checkbox-env_5")).find("input").attributes("disabled")).toBeDefined();
    expect(
      wrapper.find(sel("-checkbox-env_0")).find("input").attributes("disabled"),
    ).toBeUndefined();
    expect(wrapper.find(sel("-cap-note")).exists()).toBe(true);
  });

  it("shows a stored id the list does not return as checked, locked, and explained", async () => {
    listEnvironmentsMock.mockResolvedValueOnce({ data: [env("e1", "staging")] } as never);
    wrapper = mountCard(checkWith(["e1", "prod-id-hidden"]));
    await flushPromises();

    const locked = wrapper.find(sel("-locked-row"));
    expect(locked.exists()).toBe(true);
    expect(locked.find("input").attributes("disabled")).toBeDefined();
    expect(wrapper.find(sel("-locked-note")).exists()).toBe(true);
  });

  it("shows the empty hint when the org has no environments", async () => {
    listEnvironmentsMock.mockResolvedValueOnce({ data: [] } as never);
    wrapper = mountCard(checkWith([]));
    await flushPromises();

    expect(wrapper.find(sel("-empty")).exists()).toBe(true);
  });
});
