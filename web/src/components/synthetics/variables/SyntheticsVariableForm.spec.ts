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
import { shallowMount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";

const confirmMock = vi.fn();
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

const createEnvVar = vi.fn().mockResolvedValue({});
const createGlobalVar = vi.fn().mockResolvedValue({});
const updateEnvVar = vi.fn().mockResolvedValue({});
vi.mock("@/services/synthetics", () => ({
  default: {
    createEnvironmentVariable: (...a: unknown[]) => createEnvVar(...a),
    createGlobalVariable: (...a: unknown[]) => createGlobalVar(...a),
    updateEnvironmentVariable: (...a: unknown[]) => updateEnvVar(...a),
    updateGlobalVariable: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import SyntheticsVariableForm from "./SyntheticsVariableForm.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";

function mountForm(props: Record<string, unknown> = {}) {
  return shallowMount(SyntheticsVariableForm, {
    props: { open: true, ...props },
    global: {
      plugins: [i18n],
      provide: { store: { state: { selectedOrganization: { identifier: "default" } } } },
      // The fields live inside two nested slots, which shallowMount drops.
      stubs: {
        ODrawer: { template: "<div><slot /></div>" },
        OForm: { template: "<form><slot /></form>" },
      },
    },
  }) as VueWrapper;
}

describe("SyntheticsVariableForm — cross-tier shadow confirms", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("asks before creating an env variable that shadows a global", async () => {
    wrapper = mountForm({ environment: "staging", otherTierNames: { URL: [] } });
    await (wrapper.vm as any).save({ name: "url", kind: "plain", value: "x" });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    const message = String(confirmMock.mock.calls[0][0].message);
    expect(message).toContain("staging");
    expect(message).toContain("URL");
    expect(createEnvVar).toHaveBeenCalledTimes(1);
  });

  it("declining the confirm saves nothing", async () => {
    confirmMock.mockResolvedValue(false);
    wrapper = mountForm({ environment: "staging", otherTierNames: { URL: [] } });
    await (wrapper.vm as any).save({ name: "URL", kind: "plain", value: "x" });

    expect(createEnvVar).not.toHaveBeenCalled();
    expect(wrapper.emitted("update:list")).toBeUndefined();
  });

  it("a name with no counterpart in the other tier saves without asking", async () => {
    wrapper = mountForm({ environment: "staging", otherTierNames: { URL: [] } });
    await (wrapper.vm as any).save({ name: "TIMEOUT", kind: "plain", value: "x" });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(createEnvVar).toHaveBeenCalledTimes(1);
  });

  it("editing an existing shadow without renaming does not re-ask", async () => {
    wrapper = mountForm({
      environment: "staging",
      isEdit: true,
      data: { id: "v1", name: "URL", kind: "plain", has_value: true },
      otherTierNames: { URL: [] },
    });
    await (wrapper.vm as any).save({ name: "URL", kind: "plain", value: "" });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(updateEnvVar).toHaveBeenCalledTimes(1);
  });

  it("creating a global under env rows names the environments that keep theirs", async () => {
    wrapper = mountForm({ environment: null, otherTierNames: { URL: ["staging", "ap1"] } });
    await (wrapper.vm as any).save({ name: "URL", kind: "plain", value: "x" });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    const message = String(confirmMock.mock.calls[0][0].message);
    expect(message).toContain("staging, ap1");
    expect(createGlobalVar).toHaveBeenCalledTimes(1);
  });
});

describe("SyntheticsVariableForm — kind is fixed at creation", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("disables the Kind select when editing an existing variable", () => {
    // Both kinds hold the same ciphertext, so kind alone hides the value.
    wrapper = mountForm({
      environment: "staging",
      isEdit: true,
      data: { id: "v1", name: "API_KEY", kind: "secret", has_value: true },
    });

    expect(wrapper.findComponent(OFormSelect).props("disabled")).toBe(true);
  });

  it("leaves the Kind select enabled when creating inside an environment", () => {
    wrapper = mountForm({ environment: "staging" });

    expect(wrapper.findComponent(OFormSelect).props("disabled")).toBe(false);
  });

  it("keeps the Kind select disabled on the global tab, where a secret cannot exist", () => {
    wrapper = mountForm({ environment: null });

    expect(wrapper.findComponent(OFormSelect).props("disabled")).toBe(true);
  });
});
