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

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import HomeViewSkeleton from "./HomeViewSkeleton.vue";
import { createStore } from "vuex";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";


describe("HomeViewSkeleton", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
      },
    });
  });

  it("should render the component", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          OSkeleton: true,
        },
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should render with light theme", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          OSkeleton: true,
        },
      },
    });

    const streamsHeader = wrapper.find('[data-test="home-view-skeleton-streams-header"]');
    expect(streamsHeader.exists()).toBe(true);
    const firstChart = wrapper.findAll('[data-test="home-view-skeleton-chart"]')[0];
    expect(firstChart.classes()).toContain("bg-card-glass-bg");
  });

  it("should render with dark theme", () => {
    const darkStore = createStore({
      state: {
        theme: "dark",
      },
    });

    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [darkStore],
        stubs: {
          OSkeleton: true,
        },
      },
    });

    const streamsHeader = wrapper.find('[data-test="home-view-skeleton-streams-header"]');
    expect(streamsHeader.exists()).toBe(true);
    const firstChart = wrapper.findAll('[data-test="home-view-skeleton-chart"]')[0];
    // Glass surface uses a single semantic token; class is theme-independent now.
    expect(firstChart.classes()).toContain("bg-card-glass-bg");
  });

  it("should render streams header", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          OSkeleton: true,
        },
      },
    });

    const header = wrapper.find('[data-test="home-view-skeleton-streams-header"]');
    expect(header.exists()).toBe(true);
  });

  it("should render 5 tiles in the tiles grid", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          OSkeleton: true,
        },
      },
    });

    const tiles = wrapper.findAll('[data-test="home-view-skeleton-tile"]');
    expect(tiles).toHaveLength(5);
  });

  it("should render tile content in each tile", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          OSkeleton: true,
        },
      },
    });

    const tiles = wrapper.findAll('[data-test="home-view-skeleton-tile"]');
    expect(tiles).toHaveLength(5);
    tiles.forEach((tile) => {
      // Each tile is a vertical flex column carrying its skeleton placeholders.
      expect(tile.classes()).toContain("flex");
      expect(tile.classes()).toContain("flex-col");
      expect(tile.findAll("o-skeleton-stub").length).toBe(3);
    });
  });

  it("should render charts main container", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          OSkeleton: true,
        },
      },
    });

    const charts = wrapper.findAll('[data-test="home-view-skeleton-chart"]');
    expect(charts).toHaveLength(2);
  });

  it("should render resources rail column", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          OSkeleton: true,
        },
      },
    });

    const rail = wrapper.find('[data-test="home-view-skeleton-rail"]');
    expect(rail.exists()).toBe(true);
    expect(rail.classes()).toContain("bg-card-glass-bg");
  });

  it("should render two chart cards in the main region", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          OSkeleton: true,
        },
      },
    });

    const chartCards = wrapper.findAll('[data-test="home-view-skeleton-chart"]');
    expect(chartCards).toHaveLength(2);
  });

  it("should render first chart container", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          OSkeleton: true,
        },
      },
    });

    const firstChart = wrapper.findAll('[data-test="home-view-skeleton-chart"]')[0];
    expect(firstChart.exists()).toBe(true);
  });

  it("should render second chart container", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          OSkeleton: true,
        },
      },
    });

    const secondChart = wrapper.findAll('[data-test="home-view-skeleton-chart"]')[1];
    expect(secondChart.exists()).toBe(true);
  });

  it("should render OSkeleton components", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        components: {
          OSkeleton,
        },
      },
    });

    const skeletonBoxes = wrapper.findAllComponents(OSkeleton);
    expect(skeletonBoxes.length).toBeGreaterThan(0);
  });

  it("should apply correct theme classes to chart containers", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          OSkeleton: true,
        },
      },
    });

    const charts = wrapper.findAll('[data-test="home-view-skeleton-chart"]');
    expect(charts).toHaveLength(2);

    expect(charts[0].classes()).toContain("bg-card-glass-bg");
    expect(charts[1].classes()).toContain("bg-card-glass-bg");
  });

  it("should render skeleton placeholders in each chart section", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          OSkeleton: true,
        },
      },
    });

    const charts = wrapper.findAll('[data-test="home-view-skeleton-chart"]');
    expect(charts).toHaveLength(2);
    charts.forEach((chart) => {
      // Header (3), stats row (4) and chart area (1) => 8 skeleton stubs each.
      expect(chart.findAll("o-skeleton-stub").length).toBe(8);
    });
  });

  it("should have correct structure for responsive layout", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          OSkeleton: true,
        },
      },
    });

    // The skeleton mirrors the loaded UsageTab: KPI tiles, the resources rail
    // and both chart cards all sit on the card-glass surface.
    expect(wrapper.find(".bg-card-glass-bg").exists()).toBe(true);

    const charts = wrapper.findAll('[data-test="home-view-skeleton-chart"]');
    expect(charts).toHaveLength(2);
  });
});
