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
import i18n from "@/locales";
import { createStore } from "vuex";

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
  getFeatureNameKey: vi.fn((_feature: unknown) => "features.test_feature"),
}));

describe("FeatureComparisonTable", () => {
  let store: ReturnType<typeof createStore>;

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

  it("should render three edition cards", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const cards = wrapper.findAll(".edition-card");
    expect(cards).toHaveLength(3);
  });

  it("should display opensource message when build type is opensource", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.text()).toContain(
      "You're currently using OpenObserve Open Source Edition",
    );
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

    expect(wrapper.text()).toContain(
      "You're using OpenObserve Enterprise Edition",
    );
  });

  it("should mark the current edition card as active for opensource build", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const activeCards = wrapper.findAll(".edition-card--active");
    expect(activeCards).toHaveLength(1);
  });

  it("should mark the current edition card as active for enterprise build", () => {
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

    const activeCards = wrapper.findAll(".edition-card--active");
    expect(activeCards).toHaveLength(1);
  });

  it("should display feature title", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.text()).toContain("Feature Comparison");
  });

  it("should display icon in header", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const iconWrapper = wrapper.find(".ec-icon-wrapper");
    expect(iconWrapper.exists()).toBe(true);
    const icon = iconWrapper.findComponent({ name: "OIcon" });
    expect(icon.exists()).toBe(true);
  });

  it("should show Your Plan badge on the active edition card for opensource", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const badge = wrapper.find(".your-plan-badge");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain("Your Plan");
  });

  it("should render feature list items inside each edition card", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const featureItems = wrapper.findAll(".feature-item");
    // 3 edition cards × 1 mock feature (test_feature, not excluded) = 3
    expect(featureItems.length).toBeGreaterThan(0);
  });

  it("should render pillar chips inside each edition card", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const chips = wrapper.findAll(".pillar-chip");
    expect(chips.length).toBeGreaterThan(0);
  });

  it("should display edition names Open Source, Enterprise, Cloud", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const text = wrapper.text();
    expect(text).toContain("Open Source");
    expect(text).toContain("Enterprise");
    expect(text).toContain("Cloud");
  });

  it("should display cloud subtitle (generic message) for cloud build", () => {
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

    // Cloud should not show opensource or enterprise-specific messages
    expect(wrapper.text()).not.toContain(
      "You're currently using OpenObserve Open Source Edition",
    );
    expect(wrapper.text()).not.toContain(
      "You're using OpenObserve Enterprise Edition",
    );
  });

  it("should render edition card footer rows with license and support info", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const footerRows = wrapper.findAll(".footer-row");
    // 3 cards × 2 footer rows each (license + support)
    expect(footerRows.length).toBe(6);
  });

  it("should render CTA buttons/links for each edition card", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const ctaBtns = wrapper.findAll(".cta-btn");
    expect(ctaBtns).toHaveLength(3);
  });

  it("should render the current plan card CTA as disabled button", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const currentBtn = wrapper.find(".cta-btn--current");
    expect(currentBtn.exists()).toBe(true);
    expect((currentBtn.element as HTMLButtonElement).disabled).toBe(true);
  });

  it("should render action CTAs as anchor links for non-current editions", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const actionLinks = wrapper.findAll(".cta-btn--action");
    // opensource is current → 2 action links remain
    expect(actionLinks).toHaveLength(2);
    actionLinks.forEach((link) => {
      expect(link.element.tagName).toBe("A");
    });
  });

  it("should have editionList computed with 3 editions", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const vm = wrapper.vm as any;
    expect(vm.editionList).toHaveLength(3);
    const ids = vm.editionList.map((e: any) => e.id);
    expect(ids).toContain("opensource");
    expect(ids).toContain("enterprise");
    expect(ids).toContain("cloud");
  });

  it("should have listFeatures computed that excludes pillar and footer features", () => {
    const wrapper = mount(FeatureComparisonTable, {
      global: {
        plugins: [i18n, store],
      },
    });

    const vm = wrapper.vm as any;
    // test_feature is not excluded, so it should appear
    expect(Array.isArray(vm.listFeatures)).toBe(true);
    expect(vm.listFeatures).toHaveLength(1);
    expect(vm.listFeatures[0].id).toBe("test_feature");
  });
});
