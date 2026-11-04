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

const { listEnvironments, listGlobalVariables, deleteEnvironment, toastMock } = vi.hoisted(() => ({
  listEnvironments: vi.fn(),
  listGlobalVariables: vi.fn(),
  deleteEnvironment: vi.fn(),
  toastMock: vi.fn(),
}));
vi.mock("@/services/synthetics", () => ({
  default: { listEnvironments, listGlobalVariables, deleteEnvironment },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

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

const ODialogStub = {
  props: ["open", "title", "primaryButtonLabel", "primaryButtonVariant"],
  emits: ["click:primary", "click:secondary", "update:open"],
  template: '<div v-if="open"><slot /></div>',
};

async function mountTab() {
  const wrapper = shallowMount(SyntheticsVariablesTab, {
    global: {
      plugins: [i18n],
      provide: { store: { state: { selectedOrganization: { identifier: "default" } } } },
      stubs: { ODialog: ODialogStub, "i18n-t": false },
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

  it("passes a license denial to the list as the forbidden state", async () => {
    listEnvironments.mockRejectedValue({
      response: { status: 403, data: { code: 40001, error_detail: "synthetics" } },
    });
    wrapper = await mountTab();

    expect(wrapper.findComponent(SyntheticsVariablesList).props("forbidden")).toEqual([
      "synthetics",
    ]);
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

describe("SyntheticsVariablesTab — deleting an environment", () => {
  let wrapper: VueWrapper;
  const staging = env("staging", { variables: [BASE_URL] });

  beforeEach(() => {
    listEnvironments.mockResolvedValue({ data: [GLOBAL, staging] });
    listGlobalVariables.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  const dialog = () => wrapper.findComponent(ODialogStub);

  it("names the environment in bold, counts its variables, and confirms in red", async () => {
    wrapper = await mountTab();
    wrapper.findComponent(SyntheticsScopeRail).vm.$emit("delete", staging);
    await flushPromises();

    expect(dialog().props("open")).toBe(true);
    expect(dialog().props("primaryButtonVariant")).toBe("destructive");
    const name = wrapper.find('[data-test="synthetics-environment-delete-name"]');
    expect(name.text()).toBe("staging");
    expect(name.classes()).toContain("font-semibold");
    expect(dialog().text()).toBe("Delete the staging environment and its 1 variable?");
    expect(deleteEnvironment).not.toHaveBeenCalled();
  });

  it("deletes the environment and its variables only after the confirm", async () => {
    deleteEnvironment.mockResolvedValue({});
    wrapper = await mountTab();
    wrapper.findComponent(SyntheticsScopeRail).vm.$emit("delete", staging);
    await flushPromises();
    dialog().vm.$emit("click:primary");
    await flushPromises();

    expect(deleteEnvironment).toHaveBeenCalledWith("default", "staging", true);
    expect(dialog().props("open")).toBe(false);
  });

  it("closes without deleting on cancel", async () => {
    wrapper = await mountTab();
    wrapper.findComponent(SyntheticsScopeRail).vm.$emit("delete", env("empty"));
    await flushPromises();
    expect(dialog().text()).toBe("Delete the empty environment?");
    dialog().vm.$emit("click:secondary");
    await flushPromises();

    expect(dialog().props("open")).toBe(false);
    expect(deleteEnvironment).not.toHaveBeenCalled();
  });
});
