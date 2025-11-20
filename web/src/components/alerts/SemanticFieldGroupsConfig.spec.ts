// Copyright 2025 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import SemanticFieldGroupsConfig from "./SemanticFieldGroupsConfig.vue";

// Mock child components
vi.mock("./SemanticGroupItem.vue", () => ({
  default: {
    name: "SemanticGroupItem",
    template: '<div class="semantic-group-item-mock"></div>',
    props: ["group"],
  },
}));

installQuasar();

describe("SemanticFieldGroupsConfig", () => {
  const defaultGroups = [
    {
      id: "service",
      display_name: "Service",
      field_names: ["service", "service_name"],
      normalize: true,
    },
    {
      id: "host",
      display_name: "Host",
      field_names: ["host", "hostname"],
      normalize: false,
    },
  ];

  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(SemanticFieldGroupsConfig, {
      props: {
        semanticFieldGroups: [...defaultGroups],
        fingerprintFields: ["service"],
      },
    });
  });

  it("renders correctly", () => {
    expect(wrapper.find(".semantic-field-groups-config").exists()).toBe(true);
  });

  it("displays section header with title", () => {
    expect(wrapper.find(".text-h6").text()).toBe("Field Mappings");
  });

  it("displays section header with description", () => {
    expect(wrapper.html()).toContain("Define field name mappings");
  });

  it("renders preset selector", () => {
    expect(wrapper.findComponent({ name: "QSelect" }).exists()).toBe(true);
  });

  it("renders add custom group button", () => {
    const btn = wrapper.find(".q-btn");
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain("Add Custom Group");
  });

  it("displays semantic groups when provided", () => {
    const groupItems = wrapper.findAll(".semantic-group-item-mock");
    expect(groupItems).toHaveLength(2);
  });

  it("displays fingerprint section when groups exist", () => {
    expect(wrapper.find(".fingerprint-section").exists()).toBe(true);
  });

  it("displays deduplication fields title", () => {
    expect(wrapper.html()).toContain("Deduplication Fields");
  });

  it("renders fingerprint checkboxes for each group", () => {
    const checkboxes = wrapper.findAllComponents({ name: "QCheckbox" });
    expect(checkboxes.length).toBeGreaterThan(0);
  });

  it("adds a new group when Add Custom Group clicked", async () => {
    const vm = wrapper.vm as any;
    const initialLength = vm.localGroups.length;

    const btn = wrapper.find(".q-btn");
    await btn.trigger("click");

    expect(vm.localGroups.length).toBe(initialLength + 1);
  });

  it("new group has empty default values", async () => {
    const vm = wrapper.vm as any;
    const btn = wrapper.find(".q-btn");
    await btn.trigger("click");

    const newGroup = vm.localGroups[vm.localGroups.length - 1];
    expect(newGroup.id).toBe("");
    expect(newGroup.display_name).toBe("");
    expect(newGroup.field_names).toEqual([]);
    expect(newGroup.normalize).toBe(true);
  });

  it("emits update events when adding group", async () => {
    const btn = wrapper.find(".q-btn");
    await btn.trigger("click");
    await flushPromises();

    expect(wrapper.emitted("update:semanticFieldGroups")).toBeTruthy();
    expect(wrapper.emitted("update:fingerprintFields")).toBeTruthy();
  });

  it("shows empty state message when no groups", () => {
    wrapper = mount(SemanticFieldGroupsConfig, {
      props: {
        semanticFieldGroups: [],
        fingerprintFields: [],
      },
    });

    expect(wrapper.html()).toContain("No semantic groups defined");
  });

  it("does not show fingerprint section when no groups", () => {
    wrapper = mount(SemanticFieldGroupsConfig, {
      props: {
        semanticFieldGroups: [],
        fingerprintFields: [],
      },
    });

    expect(wrapper.find(".fingerprint-section").exists()).toBe(false);
  });

  it("loads common preset correctly", async () => {
    const vm = wrapper.vm as any;
    vm.loadPreset("common");

    expect(vm.localGroups.length).toBeGreaterThan(0);
    expect(vm.localGroups[0].id).toBe("host");
  });

  it("loads kubernetes preset correctly", async () => {
    const vm = wrapper.vm as any;
    vm.loadPreset("kubernetes");

    expect(vm.localGroups.length).toBe(4);
    expect(vm.localGroups[0].id).toBe("k8s-cluster");
  });

  it("loads aws preset correctly", async () => {
    const vm = wrapper.vm as any;
    vm.loadPreset("aws");

    expect(vm.localGroups.length).toBe(3);
    expect(vm.localGroups[0].id).toBe("aws-account");
  });

  it("loads gcp preset correctly", async () => {
    const vm = wrapper.vm as any;
    vm.loadPreset("gcp");

    expect(vm.localGroups.length).toBe(3);
    expect(vm.localGroups[0].id).toBe("gcp-project");
  });

  it("loads azure preset correctly", async () => {
    const vm = wrapper.vm as any;
    vm.loadPreset("azure");

    expect(vm.localGroups.length).toBe(3);
    expect(vm.localGroups[0].id).toBe("azure-subscription");
  });

  it("does nothing when loading null preset", async () => {
    const vm = wrapper.vm as any;
    const initialLength = vm.localGroups.length;
    vm.loadPreset(null);

    expect(vm.localGroups.length).toBe(initialLength);
  });

  it("updates group at specific index", async () => {
    const vm = wrapper.vm as any;
    const updatedGroup = {
      id: "updated-service",
      display_name: "Updated Service",
      field_names: ["new_service"],
      normalize: false,
    };

    vm.updateGroup(0, updatedGroup);

    expect(vm.localGroups[0]).toEqual(updatedGroup);
  });

  it("removes group at specific index", async () => {
    const vm = wrapper.vm as any;
    const initialLength = vm.localGroups.length;

    vm.removeGroup(0);

    expect(vm.localGroups.length).toBe(initialLength - 1);
  });

  it("removes group from fingerprint fields when deleted", async () => {
    const vm = wrapper.vm as any;
    vm.localFingerprintFields = ["service", "host"];

    vm.removeGroup(0); // Remove service group

    expect(vm.localFingerprintFields).not.toContain("service");
  });

  it("displays error when no fingerprint fields selected", async () => {
    wrapper = mount(SemanticFieldGroupsConfig, {
      props: {
        semanticFieldGroups: [...defaultGroups],
        fingerprintFields: [],
      },
    });

    expect(wrapper.html()).toContain(
      "At least one field mapping is required"
    );
  });

  it("has all preset options available", () => {
    const vm = wrapper.vm as any;
    const presetOptions = vm.presetOptions;

    expect(presetOptions).toHaveLength(5);
    expect(presetOptions.map((p: any) => p.value)).toEqual([
      "common",
      "kubernetes",
      "aws",
      "gcp",
      "azure",
    ]);
  });

  it("computes group ID options correctly", () => {
    const vm = wrapper.vm as any;
    const options = vm.groupIdOptions;

    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({ label: "Service", value: "service" });
    expect(options[1]).toEqual({ label: "Host", value: "host" });
  });

  it("updates local groups when props change", async () => {
    const newGroups = [
      {
        id: "new-group",
        display_name: "New Group",
        field_names: ["field1"],
        normalize: true,
      },
    ];

    await wrapper.setProps({ semanticFieldGroups: newGroups });
    await flushPromises();

    const vm = wrapper.vm as any;
    expect(vm.localGroups).toHaveLength(1);
    expect(vm.localGroups[0].id).toBe("new-group");
  });

  it("updates local fingerprint fields when props change", async () => {
    await wrapper.setProps({ fingerprintFields: ["host"] });
    await flushPromises();

    const vm = wrapper.vm as any;
    expect(vm.localFingerprintFields).toEqual(["host"]);
  });

  it("emits both events when emitUpdate called", async () => {
    const vm = wrapper.vm as any;
    vm.emitUpdate();

    expect(wrapper.emitted("update:semanticFieldGroups")).toBeTruthy();
    expect(wrapper.emitted("update:fingerprintFields")).toBeTruthy();
  });

  it("common preset includes host and service groups", () => {
    const vm = wrapper.vm as any;
    vm.loadPreset("common");

    const groupIds = vm.localGroups.map((g: any) => g.id);
    expect(groupIds).toContain("host");
    expect(groupIds).toContain("service");
  });

  it("common preset sets fingerprint fields", () => {
    const vm = wrapper.vm as any;
    vm.loadPreset("common");

    expect(vm.localFingerprintFields).toEqual(["service", "host"]);
  });

  it("kubernetes preset includes cluster and namespace", () => {
    const vm = wrapper.vm as any;
    vm.loadPreset("kubernetes");

    const groupIds = vm.localGroups.map((g: any) => g.id);
    expect(groupIds).toContain("k8s-cluster");
    expect(groupIds).toContain("k8s-namespace");
  });

  it("aws preset includes region and account", () => {
    const vm = wrapper.vm as any;
    vm.loadPreset("aws");

    const groupIds = vm.localGroups.map((g: any) => g.id);
    expect(groupIds).toContain("aws-account");
    expect(groupIds).toContain("aws-region");
  });

  it("has correct styling classes", () => {
    expect(wrapper.find(".semantic-field-groups-config").exists()).toBe(true);
    expect(wrapper.find(".section-header").exists()).toBe(true);
    expect(wrapper.find(".groups-list").exists()).toBe(true);
  });

  it("preset selector has correct label", () => {
    const select = wrapper.findComponent({ name: "QSelect" });
    expect(select.props("label")).toBe("Load Preset Template");
  });

  it("displays hint text for preset selector", () => {
    expect(wrapper.html()).toContain("Quick start with common field groups");
  });

  it("renders checkboxes in fingerprint section", () => {
    const checkboxes = wrapper.findAllComponents({ name: "QCheckbox" });
    expect(checkboxes.length).toBe(2); // One for each group
  });

  it("checkbox labels match group display names", () => {
    const checkboxes = wrapper.findAllComponents({ name: "QCheckbox" });
    expect(checkboxes[0].props("label")).toBe("Service");
    expect(checkboxes[1].props("label")).toBe("Host");
  });

  it("renders info icon in empty state", () => {
    wrapper = mount(SemanticFieldGroupsConfig, {
      props: {
        semanticFieldGroups: [],
        fingerprintFields: [],
      },
    });

    expect(wrapper.findComponent({ name: "QIcon" }).exists()).toBe(true);
  });

  it("preset selector is clearable", () => {
    const select = wrapper.findComponent({ name: "QSelect" });
    expect(select.props("clearable")).toBe(true);
  });

  it("preset selector emits value", () => {
    const select = wrapper.findComponent({ name: "QSelect" });
    expect(select.props("emitValue")).toBe(true);
  });

  it("preset selector maps options", () => {
    const select = wrapper.findComponent({ name: "QSelect" });
    expect(select.props("mapOptions")).toBe(true);
  });

  it("fingerprint checkboxes have correct value binding", () => {
    const checkboxes = wrapper.findAllComponents({ name: "QCheckbox" });
    expect(checkboxes[0].props("val")).toBe("service");
    expect(checkboxes[1].props("val")).toBe("host");
  });

  it("gcp preset sets correct fingerprint fields", () => {
    const vm = wrapper.vm as any;
    vm.loadPreset("gcp");

    expect(vm.localFingerprintFields).toEqual([
      "gcp-project",
      "gcp-zone",
      "gcp-service",
    ]);
  });

  it("azure preset sets correct fingerprint fields", () => {
    const vm = wrapper.vm as any;
    vm.loadPreset("azure");

    expect(vm.localFingerprintFields).toEqual([
      "azure-subscription",
      "azure-resource-group",
      "azure-service",
    ]);
  });

  it("displays fingerprint description text", () => {
    expect(wrapper.html()).toContain(
      "Alerts with the same values for these fields will be deduplicated"
    );
  });

  it("common preset has 4 groups", () => {
    const vm = wrapper.vm as any;
    vm.loadPreset("common");

    expect(vm.localGroups.length).toBe(4);
  });

  it("kubernetes preset sets correct fingerprint fields", () => {
    const vm = wrapper.vm as any;
    vm.loadPreset("kubernetes");

    expect(vm.localFingerprintFields).toEqual([
      "k8s-cluster",
      "k8s-namespace",
      "k8s-pod",
    ]);
  });

  it("aws preset sets correct fingerprint fields", () => {
    const vm = wrapper.vm as any;
    vm.loadPreset("aws");

    expect(vm.localFingerprintFields).toEqual([
      "aws-account",
      "aws-region",
      "aws-service",
    ]);
  });

  it("displays hint for preset selector", () => {
    const select = wrapper.findComponent({ name: "QSelect" });
    expect(select.props("hint")).toBe("Quick start with common field groups");
  });

  it("preset selector is dense", () => {
    const select = wrapper.findComponent({ name: "QSelect" });
    expect(select.props("dense")).toBe(true);
  });

  it("preset selector is filled", () => {
    const select = wrapper.findComponent({ name: "QSelect" });
    expect(select.props("filled")).toBe(true);
  });

  it("displays correct empty state text", () => {
    wrapper = mount(SemanticFieldGroupsConfig, {
      props: {
        semanticFieldGroups: [],
        fingerprintFields: [],
      },
    });

    expect(wrapper.html()).toContain(
      "No semantic groups defined. Add a group or load a preset template."
    );
  });

  it("section header has description about field mappings", () => {
    expect(wrapper.html()).toContain(
      "Define field name mappings for correlation and deduplication"
    );
  });
});


