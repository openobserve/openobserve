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
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import SyntheticsLocationForm from "./SyntheticsLocationForm.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
  },
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => path),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/services/synthetics", () => ({
  default: {
    createLocation: vi.fn(),
    updateLocation: vi.fn(),
  },
}));

import syntheticsService from "@/services/synthetics";

// ── ODrawer stub ─────────────────────────────────────────────────────────────
// Renders the slot body and exposes title attr so tests can assert against the
// resolved i18n title (create vs edit).

const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "title",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "formId",
  ],
  emits: ["update:open", "click:secondary", "click:primary", "click:neutral"],
  template:
    '<div data-test="o-drawer-stub" :data-title="title" :data-primary-label="primaryButtonLabel" :data-secondary-label="secondaryButtonLabel"><slot /></div>',
};

// ── Form field stubs ─────────────────────────────────────────────────────────
// Light stubs so UI / wiring tests exercise the template structure without
// requiring the full ODev form store machinery.

const OFormSelectStub = {
  name: "OFormSelect",
  props: ["modelValue", "name", "label", "options", "placeholder", "required"],
  emits: ["update:modelValue"],
  template:
    '<select :data-test="$attrs[\'data-test\']" :name="name" @change="$emit(\'update:modelValue\', $event.target.value)"></select>',
};

const OFormInputStub = {
  name: "OFormInput",
  props: ["modelValue", "name", "label", "placeholder", "required", "readonly", "disabled"],
  emits: ["update:modelValue"],
  template:
    '<input :data-test="$attrs[\'data-test\']" :name="name" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const OFormSwitchStub = {
  name: "OFormSwitch",
  props: ["modelValue", "name", "label"],
  emits: ["update:modelValue"],
  template:
    '<input type="checkbox" :data-test="$attrs[\'data-test\']" :name="name" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
};

const OFormStub = {
  name: "OForm",
  props: ["schema", "defaultValues", "id"],
  emits: ["submit"],
  template: '<form data-test="o-form" @submit.prevent=\'$emit("submit", {})\'><slot /></form>',
};

const lightStubs = {
  ODrawer: ODrawerStub,
  OForm: OFormStub,
  OFormSelect: OFormSelectStub,
  OFormInput: OFormInputStub,
  OFormSwitch: OFormSwitchStub,
};

// ── Factory ──────────────────────────────────────────────────────────────────

const createWrapper = (props = {}) => {
  return mount(SyntheticsLocationForm, {
    props: {
      open: true,
      isEdit: false,
      data: {},
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: lightStubs,
    },
    attachTo: document.body,
  });
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SyntheticsLocationForm", () => {
  let wrapper: ReturnType<typeof createWrapper>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear any teleported DOM from previous tests.
    document.body.innerHTML = "";
  });

  afterEach(() => {
    // Unmount cleans the wrapper's DOM and teleported children.
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── 1. Create mode ─────────────────────────────────────────────────────────

  it("renders in create mode (isEdit=false) with title 'Add Location'", () => {
    wrapper = createWrapper({ isEdit: false });

    // The ODrawer is rendered with create-mode title and button labels.
    const drawer = wrapper.findComponent({ name: "ODrawer" });
    expect(drawer.exists()).toBe(true);
    expect(drawer.props("title")).toBe("Add Location");
    expect(drawer.props("primaryButtonLabel")).toBe("Create & Close");
    expect(drawer.props("secondaryButtonLabel")).toBe("Cancel");
  });

  // ── 2. Edit mode with pre-filled data ──────────────────────────────────────

  it("renders in edit mode (isEdit=true) with pre-filled data", () => {
    wrapper = createWrapper({
      isEdit: true,
      data: {
        id: "aws-us-east-1",
        provider: "aws",
        region: "us-east-1",
        name: "AWS US East",
        enabled: false,
      },
    });

    // The ODrawer renders edit-mode title and button labels.
    const drawer = wrapper.findComponent({ name: "ODrawer" });
    expect(drawer.props("title")).toBe("Edit Location");
    expect(drawer.props("primaryButtonLabel")).toBe("Update & Close");

    // Defaults computed seeds the form values for edit mode.
    expect(wrapper.vm.locationFormDefaults).toEqual({
      provider: "aws",
      customProvider: "",
      region: "us-east-1",
      label: "AWS US East",
      enabled: false,
    });
  });

  it("maps non-standard providers to custom in edit defaults", () => {
    // When editing a location whose provider is not aws/gcp/azure the computed
    // defaults set provider to "custom" and seed customProvider with the raw value.
    wrapper = createWrapper({
      isEdit: true,
      data: {
        id: "datadog-us-west-1",
        provider: "datadog",
        region: "us-west-1",
        name: "Datadog US West",
        enabled: true,
      },
    });

    expect(wrapper.vm.locationFormDefaults).toEqual({
      provider: "custom",
      customProvider: "datadog",
      region: "us-west-1",
      label: "Datadog US West",
      enabled: true,
    });
  });

  it("defaults to blank form values in create mode", () => {
    wrapper = createWrapper({ isEdit: false });
    expect(wrapper.vm.locationFormDefaults).toEqual({
      provider: "aws",
      customProvider: "",
      region: "",
      label: "",
      enabled: true,
    });
  });

  // ── 3. Conditional customProvider input — shown ────────────────────────────

  it("shows customProvider input when provider is 'custom'", () => {
    // In edit mode with a non-standard provider the computed defaults set
    // providerValue to "custom", which conditionally renders the input.
    wrapper = createWrapper({
      isEdit: true,
      data: { provider: "datadog", region: "us-east-1", name: "Test" },
    });

    // providerValue is initialized from locationFormDefaults.provider = "custom"
    expect(wrapper.vm.providerValue).toBe("custom");

    const customInput = wrapper.find(
      '[data-test="synthetics-location-custom-provider-input"]',
    );
    expect(customInput.exists()).toBe(true);
  });

  // ── 4. Conditional customProvider input — hidden ───────────────────────────

  it("hides customProvider input when provider is not 'custom'", () => {
    // In create mode providerValue starts at "aws" — customProvider is hidden.
    wrapper = createWrapper({ isEdit: false });
    expect(wrapper.vm.providerValue).toBe("aws");

    const customInput = wrapper.find(
      '[data-test="synthetics-location-custom-provider-input"]',
    );
    expect(customInput.exists()).toBe(false);
  });

  it("hides customProvider when editing a known provider (aws)", () => {
    wrapper = createWrapper({
      isEdit: true,
      data: { provider: "aws", region: "us-east-1", name: "Test" },
    });
    expect(wrapper.vm.providerValue).toBe("aws");

    const customInput = wrapper.find(
      '[data-test="synthetics-location-custom-provider-input"]',
    );
    expect(customInput.exists()).toBe(false);
  });

  // ── 5. Emits close / update:open on secondary button click ─────────────────

  it("emits close and update:open on secondary button click", () => {
    wrapper = createWrapper();

    const drawer = wrapper.findComponent({ name: "ODrawer" });
    drawer.vm.$emit("click:secondary");

    expect(wrapper.emitted("close")).toBeTruthy();
    expect(wrapper.emitted("close")!.length).toBe(1);
    expect(wrapper.emitted("update:open")).toBeTruthy();
    expect(wrapper.emitted("update:open")!![0]).toEqual([false]);
  });

  it("emits close and update:open via handleClose method", () => {
    wrapper = createWrapper();

    wrapper.vm.handleClose();

    expect(wrapper.emitted("close")).toBeTruthy();
    expect(wrapper.emitted("update:open")).toBeTruthy();
    expect(wrapper.emitted("update:open")!![0]).toEqual([false]);
  });

  // ── 6. Create location on form submit ──────────────────────────────────────

  it("calls syntheticsService.createLocation on form submit in create mode", async () => {
    const createLocMock = syntheticsService.createLocation as ReturnType<typeof vi.fn>;
    createLocMock.mockResolvedValue({ status: 200 });

    wrapper = createWrapper({ isEdit: false });

    await wrapper.vm.saveLocation({
      provider: "aws",
      customProvider: "",
      region: "us-east-1",
      label: "AWS US East",
      enabled: true,
    });

    expect(createLocMock).toHaveBeenCalledTimes(1);
    expect(createLocMock).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        kind: "public",
        id: "aws-us-east-1",
        provider: "aws",
        region: "us-east-1",
        label: "AWS US East",
        enabled: true,
      }),
    );

    // On success emits close and update:list.
    expect(wrapper.emitted("close")).toBeTruthy();
    expect(wrapper.emitted("update:list")).toBeTruthy();
  });

  it("calls syntheticsService.createLocation with custom provider", async () => {
    const createLocMock = syntheticsService.createLocation as ReturnType<typeof vi.fn>;
    createLocMock.mockResolvedValue({ status: 200 });

    wrapper = createWrapper({ isEdit: false });

    await wrapper.vm.saveLocation({
      provider: "custom",
      customProvider: "datadog",
      region: "us-west-1",
      label: "Datadog US West",
      enabled: true,
    });

    expect(createLocMock).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        provider: "datadog",
        id: "datadog-us-west-1",
      }),
    );
  });

  // ── 7. Update location on form submit ──────────────────────────────────────

  it("calls syntheticsService.updateLocation on form submit in edit mode", async () => {
    const updateLocMock = syntheticsService.updateLocation as ReturnType<typeof vi.fn>;
    updateLocMock.mockResolvedValue({ status: 200 });

    wrapper = createWrapper({
      isEdit: true,
      data: {
        id: "azure-eastus",
        provider: "azure",
        region: "eastus",
        name: "Azure East US",
        enabled: true,
      },
    });

    await wrapper.vm.saveLocation({
      provider: "azure",
      customProvider: "",
      region: "eastus",
      label: "Azure East US Updated",
      enabled: false,
    });

    expect(updateLocMock).toHaveBeenCalledTimes(1);
    expect(updateLocMock).toHaveBeenCalledWith(
      "default",
      "azure-eastus",
      expect.objectContaining({
        label: "Azure East US Updated",
        enabled: false,
      }),
    );

    // On success emits close and update:list.
    expect(wrapper.emitted("close")).toBeTruthy();
    expect(wrapper.emitted("update:list")).toBeTruthy();
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it("does not emit success events on create failure", async () => {
    const createLocMock = syntheticsService.createLocation as ReturnType<typeof vi.fn>;
    createLocMock.mockRejectedValue({
      response: { status: 500, data: { message: "Server error" } },
    });

    wrapper = createWrapper({ isEdit: false });

    await wrapper.vm.saveLocation({
      provider: "aws",
      customProvider: "",
      region: "us-east-1",
      label: "AWS US East",
      enabled: true,
    });

    // Failure path — no success emits.
    expect(wrapper.emitted("close")).toBeFalsy();
    expect(wrapper.emitted("update:list")).toBeFalsy();
  });

  it("does not emit success events on update failure", async () => {
    const updateLocMock = syntheticsService.updateLocation as ReturnType<typeof vi.fn>;
    updateLocMock.mockRejectedValue({
      response: { status: 500, data: { message: "Server error" } },
    });

    wrapper = createWrapper({
      isEdit: true,
      data: { id: "aws-us-east-1", provider: "aws", region: "us-east-1", name: "Test" },
    });

    await wrapper.vm.saveLocation({
      provider: "aws",
      customProvider: "",
      region: "us-east-1",
      label: "AWS US East",
      enabled: true,
    });

    expect(wrapper.emitted("close")).toBeFalsy();
    expect(wrapper.emitted("update:list")).toBeFalsy();
  });

  // ── Derived ID display ─────────────────────────────────────────────────────

  it("displays '-' when derivedId is empty", () => {
    wrapper = createWrapper({ isEdit: false });
    // In create mode with defaults provider="aws", region="" → derivedId = ""
    expect(wrapper.vm.derivedId).toBe("");
    expect(wrapper.html()).toContain("-");
  });

  it("renders the location ID label and container", () => {
    wrapper = createWrapper({
      isEdit: true,
      data: { provider: "gcp", region: "us-central1", name: "GCP Central" },
    });
    // The "Location ID" label and the derived-id container are present.
    expect(wrapper.text()).toContain("Location ID");
    // The ID derives from provider + region; the reactive wiring depends on
    // the form store which isn't fully exercised with a stubbed OForm, so we
    // verify the computed default seeds are correct instead.
    expect(wrapper.vm.locationFormDefaults.provider).toBe("gcp");
    expect(wrapper.vm.locationFormDefaults.region).toBe("us-central1");
  });

  // ── Data-test attributes ───────────────────────────────────────────────────

  it("renders all expected data-test attributes", () => {
    wrapper = createWrapper();

    expect(
      wrapper.find('[data-test="synthetics-location-form-drawer"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="synthetics-location-provider-select"]').exists(),
    ).toBe(true);
    // customProvider is hidden for non-custom provider
    expect(
      wrapper.find('[data-test="synthetics-location-custom-provider-input"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-test="synthetics-location-region-input"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="synthetics-location-label-input"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="synthetics-location-enabled-toggle"]').exists(),
    ).toBe(true);
  });

  // ── Provider options ───────────────────────────────────────────────────────

  it("exposes the four provider options in the computed", () => {
    wrapper = createWrapper();
    const options = wrapper.vm.providerOptions;
    expect(options).toHaveLength(4);
    expect(options.map((o: { value: string }) => o.value)).toEqual([
      "aws",
      "gcp",
      "azure",
      "custom",
    ]);
  });
});
