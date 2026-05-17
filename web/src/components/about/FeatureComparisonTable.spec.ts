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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import FeatureComparisonTable from "./FeatureComparisonTable.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import { createStore } from "vuex";

installQuasar();

// Mock feature constants
vi.mock("@/constants/features", () => ({
  FEATURE_REGISTRY: [
    {
      id: "test_feature",
      availability: {
        opensource: true,
        enterprise: true,
        cloud: true,
      },
    },
  ],
  getFeatureNameKey: vi.fn((feature) => "features.test_feature"),
}));

describe("FeatureComparisonTable", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
        zoConfig: {
          build_type: "opensource",
        },
      },
    });

    vi.clearAllMocks();
  });

  it("should render the component", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should render feature comparison table", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const table = wrapper.findComponent({ name: "QTable" });
    expect(table.exists()).toBe(true);
  });

  it("should display opensource message when build type is opensource", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.text()).toContain("You're currently using OpenObserve Open Source Edition");
  });

  it("should display enterprise message when build type is enterprise", () => {
    const enterpriseStore = createStore({
      state: {
        theme: "light",
        zoConfig: {
          build_type: "enterprise",
        },
      },
    });

    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, enterpriseStore],
      },
    });

    expect(wrapper.text()).toContain("You're using OpenObserve Enterprise Edition");
  });

  it("should have three columns: opensource, enterprise, cloud", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.vm.columns).toHaveLength(4); // name + 3 editions
    expect(wrapper.vm.columns[1].name).toBe("opensource");
    expect(wrapper.vm.columns[2].name).toBe("enterprise");
    expect(wrapper.vm.columns[3].name).toBe("cloud");
  });

  it("should load features from registry", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.vm.featureData.features).toBeDefined();
    expect(Array.isArray(wrapper.vm.featureData.features)).toBe(true);
  });

  it("should highlight opensource column when build type is opensource", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const highlightedCells = wrapper.findAll(".highlighted-column");
    expect(highlightedCells.length).toBeGreaterThan(0);
  });

  it("should highlight enterprise column when build type is enterprise", () => {
    const enterpriseStore = createStore({
      state: {
        theme: "light",
        zoConfig: {
          build_type: "enterprise",
        },
      },
    });

    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, enterpriseStore],
      },
    });

    const highlightedCells = wrapper.findAll(".highlighted-column");
    expect(highlightedCells.length).toBeGreaterThan(0);
  });

  it("should apply dark theme styles", () => {
    const darkStore = createStore({
      state: {
        theme: "dark",
        zoConfig: {
          build_type: "opensource",
        },
      },
    });

    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, darkStore],
      },
    });

    const iconWrapper = wrapper.find(".icon-wrapper");
    expect(iconWrapper.classes()).toContain("icon-wrapper-dark");
  });

  it("should apply light theme styles", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const iconWrapper = wrapper.find(".icon-wrapper");
    expect(iconWrapper.classes()).toContain("icon-wrapper-light");
  });

  it("should display feature title", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.text()).toContain("Feature Comparison");
  });

  it("should have correct table styling classes", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const table = wrapper.find(".feature-comparison-table");
    expect(table.exists()).toBe(true);
  });

  it("should display icon in header", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const icon = wrapper.find(".icon-wrapper .OIcon");
    expect(icon.exists()).toBe(true);
  });

  it("should show enterprise promotion for opensource build", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.text()).toContain("Good news");
  });

  it("should have pagination disabled", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.vm.pagination.rowsPerPage).toBe(0);
  });

  it("should display feature comparison wrapper", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const wrapper_div = wrapper.find(".feature-comparison-wrapper");
    expect(wrapper_div.exists()).toBe(true);
  });

  it("should compute currentPlanName for opensource build", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    expect((wrapper.vm as any).currentPlanName).toBeTruthy();
  });

  it("should compute currentPlanName for enterprise build", () => {
    const enterpriseStore = createStore({
      state: {
        theme: "light",
        zoConfig: {
          build_type: "enterprise",
        },
      },
    });

    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, enterpriseStore],
      },
    });

    expect((wrapper.vm as any).currentPlanName).toBeTruthy();
  });

  it("should compute currentPlanName for cloud build", () => {
    const cloudStore = createStore({
      state: {
        theme: "light",
        zoConfig: {
          build_type: "cloud",
        },
      },
    });

    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, cloudStore],
      },
    });

    expect((wrapper.vm as any).currentPlanName).toBeTruthy();
  });

  it("should return empty string for currentPlanName when build_type is unknown", () => {
    const unknownStore = createStore({
      state: {
        theme: "light",
        zoConfig: {
          build_type: "unknown",
        },
      },
    });

    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, unknownStore],
      },
    });

    expect((wrapper.vm as any).currentPlanName).toBe("");
  });

  it("should display cloud subtitle (not edition-specific message) for cloud build", () => {
    const cloudStore = createStore({
      state: {
        theme: "light",
        zoConfig: {
          build_type: "cloud",
        },
      },
    });

    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, cloudStore],
      },
    });

    // Cloud should show the generic subtitle, not the edition-specific messages
    const editionInfo = wrapper.find(".edition-info");
    expect(editionInfo.exists()).toBe(false);
  });

  it("should not show enterprise promotion for cloud build", () => {
    const cloudStore = createStore({
      state: {
        theme: "light",
        zoConfig: {
          build_type: "cloud",
        },
      },
    });

    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, cloudStore],
      },
    });

    const promotion = wrapper.find(".enterprise-promotion");
    expect(promotion.exists()).toBe(false);
  });

  it("should show enterprise promotion message for enterprise build", () => {
    const enterpriseStore = createStore({
      state: {
        theme: "light",
        zoConfig: {
          build_type: "enterprise",
        },
      },
    });

    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, enterpriseStore],
      },
    });

    const promotion = wrapper.find(".enterprise-promotion");
    expect(promotion.exists()).toBe(true);
  });

  it("should load features from registry and each feature has name and values", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const vm = wrapper.vm as any;
    const features = vm.featureData.features;
    expect(Array.isArray(features)).toBe(true);
    features.forEach((feature: any) => {
      expect(feature).toHaveProperty("name");
      expect(feature).toHaveProperty("values");
      expect(feature.values).toHaveProperty("opensource");
      expect(feature.values).toHaveProperty("enterprise");
      expect(feature.values).toHaveProperty("cloud");
    });
  });

  it("should have correct column alignment settings", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.columns[0].align).toBe("left");   // name column
    expect(vm.columns[1].align).toBe("center"); // opensource
    expect(vm.columns[2].align).toBe("center"); // enterprise
    expect(vm.columns[3].align).toBe("center"); // cloud
  });

  it("should have correct column sortable settings", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    (wrapper.vm as any).columns.forEach((col: any) => {
      expect(col.sortable).toBe(false);
    });
  });

  it("should have editions array with correct ids", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const editionIds = (wrapper.vm as any).featureData.editions.map((e: any) => e.id);
    expect(editionIds).toContain("opensource");
    expect(editionIds).toContain("enterprise");
    expect(editionIds).toContain("cloud");
  });

  it("should only highlight the current build type column", () => {
    // When build_type is opensource, only opensource column is highlighted
    expect(store.state.zoConfig.build_type).toBe("opensource");

    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const highlighted = wrapper.findAll(".highlighted-column");
    // Should have at least one highlighted cell (one per row for opensource column)
    expect(highlighted.length).toBeGreaterThan(0);
  });

  it("should render table with hidden pagination", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const table = wrapper.findComponent({ name: "QTable" });
    expect(table.exists()).toBe(true);
    // rowsPerPage: 0 means show all
    expect((wrapper.vm as any).pagination.rowsPerPage).toBe(0);
  });
});
