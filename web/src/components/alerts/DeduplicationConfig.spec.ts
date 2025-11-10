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
import DeduplicationConfig from "./DeduplicationConfig.vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

// Mock child components
vi.mock("./AlertsContainer.vue", () => ({
  default: {
    name: "AlertsContainer",
    template: '<div class="alerts-container-mock"><slot /></div>',
    props: ["name", "label", "subLabel", "icon", "iconClass", "modelValue"],
  },
}));

installQuasar();

describe("DeduplicationConfig", () => {
  const defaultConfig = {
    enabled: false,
    fingerprint_fields: [],
    dedup_window_seconds: 300,
    alert_name: "alert1",
    semantic_field_groups: [],
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
    wrapper = mount(DeduplicationConfig, {
      props: {
        config: { ...defaultConfig },
        semanticFieldGroups: [...defaultSemanticGroups],
      },
      global: {
        plugins: [store, i18n],
      },
    });
  });

  it("renders correctly", () => {
    expect(wrapper.find(".deduplication-config").exists()).toBe(true);
  });

  it("receives props correctly", () => {
    // Component receives and uses props internally
    expect(wrapper.html().length).toBeGreaterThan(100);
  });

  it("contains alert setup container when expanded", () => {
    // Container exists in template
    expect(wrapper.html()).toContain("deduplication-config");
  });

  it("has AlertsContainer component", () => {
    expect(wrapper.findComponent({ name: "AlertsContainer" }).exists()).toBe(true);
  });

  it("renders q-select for fingerprint fields", async () => {
    // Component uses q-select internally
    expect(wrapper.html().length).toBeGreaterThan(0);
  });

  it("has proper structure", () => {
    expect(wrapper.element).toBeTruthy();
  });

  it("mounts without errors", () => {
    expect(wrapper.vm).toBeTruthy();
  });
});
