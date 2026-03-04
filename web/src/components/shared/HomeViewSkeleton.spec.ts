// Copyright 2023 OpenObserve Inc.
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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import SkeletonBox from "./SkeletonBox.vue";

installQuasar();

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
          SkeletonBox: true,
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
          SkeletonBox: true,
        },
      },
    });

    const featureCard = wrapper.find(".feature-card");
    expect(featureCard.classes()).toContain("light-stream-container");
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
          SkeletonBox: true,
        },
      },
    });

    const featureCard = wrapper.find(".feature-card");
    expect(featureCard.classes()).toContain("dark-stream-container");
  });

  it("should render streams header", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          SkeletonBox: true,
        },
      },
    });

    const header = wrapper.find(".streams-header");
    expect(header.exists()).toBe(true);
  });

  it("should render 5 tiles in the tiles grid", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          SkeletonBox: true,
        },
      },
    });

    const tilesGrid = wrapper.find(".tiles-grid");
    expect(tilesGrid.exists()).toBe(true);

    const tiles = tilesGrid.findAll(".tile");
    expect(tiles).toHaveLength(5);
  });

  it("should render tile content in each tile", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          SkeletonBox: true,
        },
      },
    });

    const tiles = wrapper.findAll(".tile");
    tiles.forEach((tile) => {
      const tileContent = tile.find(".tile-content");
      expect(tileContent.exists()).toBe(true);
    });
  });

  it("should render charts main container", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          SkeletonBox: true,
        },
      },
    });

    const chartsContainer = wrapper.find(".charts-main-container");
    expect(chartsContainer.exists()).toBe(true);
  });

  it("should render functions and dashboards column", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          SkeletonBox: true,
        },
      },
    });

    const functionsColumn = wrapper.find(".functions-dashboards-column");
    expect(functionsColumn.exists()).toBe(true);
  });

  it("should render two tile wrappers in functions-dashboards column", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          SkeletonBox: true,
        },
      },
    });

    const tileWrappers = wrapper.findAll(".tile-wrapper");
    expect(tileWrappers.length).toBeGreaterThanOrEqual(2);
  });

  it("should render first chart container", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          SkeletonBox: true,
        },
      },
    });

    const firstChart = wrapper.find(".first-chart-container");
    expect(firstChart.exists()).toBe(true);
  });

  it("should render second chart container", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          SkeletonBox: true,
        },
      },
    });

    const secondChart = wrapper.find(".second-chart-container");
    expect(secondChart.exists()).toBe(true);
  });

  it("should render SkeletonBox components", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        components: {
          SkeletonBox,
        },
      },
    });

    const skeletonBoxes = wrapper.findAllComponents(SkeletonBox);
    expect(skeletonBoxes.length).toBeGreaterThan(0);
  });

  it("should apply correct theme classes to chart containers", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          SkeletonBox: true,
        },
      },
    });

    const firstChart = wrapper.find(".first-chart-container");
    const secondChart = wrapper.find(".second-chart-container");

    expect(firstChart.classes()).toContain("chart-container-light");
    expect(secondChart.classes()).toContain("chart-container-light");
  });

  it("should render details container in chart sections", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          SkeletonBox: true,
        },
      },
    });

    const detailsContainers = wrapper.findAll(".details-container");
    expect(detailsContainers.length).toBeGreaterThanOrEqual(2);
  });

  it("should have correct structure for responsive layout", () => {
    const wrapper = mount(HomeViewSkeleton, {
      global: {
        plugins: [store],
        stubs: {
          SkeletonBox: true,
        },
      },
    });

    const cardContainer = wrapper.find(".card-container");
    expect(cardContainer.exists()).toBe(true);

    const chartsContainer = wrapper.find(".charts-main-container");
    expect(chartsContainer.exists()).toBe(true);
  });
});
