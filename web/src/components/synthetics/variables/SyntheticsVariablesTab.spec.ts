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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import type { SyntheticsEnvironment, SyntheticsVariable } from "@/types/synthetics";

const { listEnvironments, listGlobalVariables, toastMock } = vi.hoisted(() => ({
  listEnvironments: vi.fn(),
  listGlobalVariables: vi.fn(),
  toastMock: vi.fn(),
}));
vi.mock("@/services/synthetics", () => ({
  default: { listEnvironments, listGlobalVariables },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

import SyntheticsVariablesTab from "./SyntheticsVariablesTab.vue";
import SyntheticsScopeRail from "./SyntheticsScopeRail.vue";
import SyntheticsVariablesList from "./SyntheticsVariablesList.vue";
import SyntheticsEnvironmentForm from "./SyntheticsEnvironmentForm.vue";

function env(name: string, over: Partial<SyntheticsEnvironment> = {}): SyntheticsEnvironment {
  return {
    id: `id-${name}`,
    name,
    description: "",
    is_global: false,
    created_at: 0,
    updated_at: 0,
    checks_count: 0,
    variables: [],
    ...over,
  };
}

const GLOBAL = env("global", { id: "global_default", is_global: true });
const BASE_URL = { name: "BASE_URL", kind: "plain", has_value: true } as SyntheticsVariable;

async function mountTab() {
  const wrapper = shallowMount(SyntheticsVariablesTab, {
    global: {
      plugins: [i18n],
      provide: { store: { state: { selectedOrganization: { identifier: "default" } } } },
    },
  }) as VueWrapper;
  await flushPromises();
  return wrapper;
}

describe("SyntheticsVariablesTab — landing on a new environment", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    listEnvironments.mockResolvedValue({ data: [GLOBAL] });
    listGlobalVariables.mockResolvedValue({ data: [BASE_URL] });
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("starts on Global", async () => {
    wrapper = await mountTab();

    expect(wrapper.findComponent(SyntheticsScopeRail).props("modelValue")).toBe("global");
    expect(wrapper.findComponent(SyntheticsVariablesList).props("environment")).toBeNull();
  });

  function expectLandedOnStaging() {
    expect(wrapper.findComponent(SyntheticsScopeRail).props("modelValue")).toBe("staging");
    const list = wrapper.findComponent(SyntheticsVariablesList);
    expect(list.props("environment")).toBe("staging");
    expect(list.props("scopeLabel")).toBe("staging");
    expect(list.props("variables")).toEqual([]);
  }

  it("refreshes the rail itself on created, then selects the new environment", async () => {
    wrapper = await mountTab();
    listEnvironments.mockResolvedValue({ data: [GLOBAL, env("staging")] });

    wrapper.findComponent(SyntheticsEnvironmentForm).vm.$emit("created", "staging");
    await flushPromises();

    // Mount plus the handler's own refresh: the handler cannot lean on update:list.
    expect(listEnvironments).toHaveBeenCalledTimes(2);
    expectLandedOnStaging();
  });

  it("lands on the new environment through the form's real create flow", async () => {
    wrapper = await mountTab();
    listEnvironments.mockResolvedValue({ data: [GLOBAL, env("staging")] });

    const form = wrapper.findComponent(SyntheticsEnvironmentForm);
    form.vm.$emit("update:list");
    form.vm.$emit("created", "staging");
    await flushPromises();

    expect(listEnvironments.mock.calls.length).toBeGreaterThanOrEqual(2);
    expectLandedOnStaging();
  });

  it("keeps the selection where it was after an edit", async () => {
    listEnvironments.mockResolvedValue({ data: [GLOBAL, env("staging"), env("prod")] });
    wrapper = await mountTab();
    wrapper.findComponent(SyntheticsScopeRail).vm.$emit("update:modelValue", "prod");
    await flushPromises();
    expect(wrapper.findComponent(SyntheticsScopeRail).props("modelValue")).toBe("prod");

    wrapper.findComponent(SyntheticsEnvironmentForm).vm.$emit("update:list");
    await flushPromises();

    expect(listEnvironments).toHaveBeenCalledTimes(2);
    expect(wrapper.findComponent(SyntheticsScopeRail).props("modelValue")).toBe("prod");
    expect(wrapper.findComponent(SyntheticsVariablesList).props("environment")).toBe("prod");
  });
});
