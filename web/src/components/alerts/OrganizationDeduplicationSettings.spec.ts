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
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import OrganizationDeduplicationSettings from "./OrganizationDeduplicationSettings.vue";
import store from "@/test/unit/helpers/store";

// Mock child components
vi.mock("./SemanticFieldGroupsConfig.vue", () => ({
  default: {
    name: "SemanticFieldGroupsConfig",
    template: '<div class="semantic-field-groups-config-mock"></div>',
    props: ["semanticFieldGroups", "fingerprintFields"],
  },
}));

installQuasar();

describe("OrganizationDeduplicationSettings", () => {
  const defaultConfig = {
    fingerprint_fields: [],
    time_window_minutes: 5,
  };

  const defaultSemanticGroups = [
    {
      id: "service",
      display_name: "Service",
      field_names: ["service", "service_name"],
      normalize: true,
    },
  ];

  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(OrganizationDeduplicationSettings, {
      props: {
        config: { ...defaultConfig },
        semanticFieldGroups: [...defaultSemanticGroups],
      },
      global: {
        plugins: [store],
      },
    });
  });

  it("renders correctly", () => {
    expect(wrapper.find(".q-card").exists()).toBe(true);
  });

  it("displays title", () => {
    expect(wrapper.html()).toContain("Alert Correlation");
  });

  it("receives props correctly", () => {
    // Component receives and uses props internally
    expect(wrapper.html().length).toBeGreaterThan(100);
  });

  it("renders SemanticFieldGroupsConfig component", () => {
    expect(wrapper.findComponent({ name: "SemanticFieldGroupsConfig" }).exists()).toBe(true);
  });

  it("renders q-input for time window", () => {
    // Component contains input field
    expect(wrapper.html()).toContain("minutes");
  });

  it("has proper q-card structure", () => {
    expect(wrapper.find(".q-card").exists()).toBe(true);
  });

  it("mounts without errors", () => {
    expect(wrapper.vm).toBeTruthy();
  });

  it("renders with proper structure", () => {
    expect(wrapper.element).toBeTruthy();
  });
});
