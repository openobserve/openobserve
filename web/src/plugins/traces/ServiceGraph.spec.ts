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
import ServiceGraph from "@/plugins/traces/ServiceGraph.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import serviceGraphService from "@/services/service_graph";

installQuasar();

// Mock service graph service
vi.mock("@/services/service_graph", () => ({
  default: {
    getCurrentTopology: vi.fn(),
  },
}));

// Mock useStreams composable
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn().mockResolvedValue({
      list: [
        { name: "default" },
        { name: "test-stream" },
      ],
    }),
  }),
}));

describe("ServiceGraph.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.selectedOrganization = {
      identifier: "test-org",
      name: "Test Org",
    };
  });

  it("should mount successfully", () => {
    const wrapper = mount(ServiceGraph, {
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should call API with time range parameters when loading", async () => {
    const mockResponse = {
      data: {
        nodes: [],
        edges: [],
        availableStreams: ["default"],
      },
    };

    vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue(
      mockResponse
    );

    const wrapper = mount(ServiceGraph, {
      global: {
        plugins: [i18n, store],
      },
    });

    // Wait for component to mount and load data
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify API was called with time range
    expect(serviceGraphService.getCurrentTopology).toHaveBeenCalled();
    const callArgs = vi.mocked(serviceGraphService.getCurrentTopology).mock.calls[0];
    expect(callArgs[0]).toBe("test-org");
    expect(callArgs[1]).toHaveProperty("startTime");
    expect(callArgs[1]).toHaveProperty("endTime");
  });

  it("should pass streamName filter when stream is selected", async () => {
    const mockResponse = {
      data: {
        nodes: [],
        edges: [],
        availableStreams: ["default", "test-stream"],
      },
    };

    vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue(
      mockResponse
    );

    const wrapper = mount(ServiceGraph, {
      global: {
        plugins: [i18n, store],
      },
    });

    // Wait for initial load
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Simulate stream filter change
    await wrapper.vm.onStreamFilterChange("test-stream");

    // Verify API was called with stream filter
    const lastCall = vi.mocked(serviceGraphService.getCurrentTopology).mock
      .calls[vi.mocked(serviceGraphService.getCurrentTopology).mock.calls.length - 1];

    expect(lastCall[1]).toHaveProperty("streamName", "test-stream");
  });

  it("should update time range when date picker changes", async () => {
    const mockResponse = {
      data: {
        nodes: [],
        edges: [],
        availableStreams: [],
      },
    };

    vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue(
      mockResponse
    );

    const wrapper = mount(ServiceGraph, {
      global: {
        plugins: [i18n, store],
      },
    });

    // Wait for initial load
    await new Promise((resolve) => setTimeout(resolve, 100));
    const initialCallCount = vi.mocked(serviceGraphService.getCurrentTopology).mock.calls.length;

    // Simulate time range change
    const newTimeRange = {
      startTime: 1000000,
      endTime: 2000000,
      relativeTimePeriod: "1h",
    };

    await wrapper.vm.updateTimeRange(newTimeRange);

    // Verify new API call was made with updated time range
    expect(vi.mocked(serviceGraphService.getCurrentTopology).mock.calls.length).toBeGreaterThan(initialCallCount);

    const lastCall = vi.mocked(serviceGraphService.getCurrentTopology).mock
      .calls[vi.mocked(serviceGraphService.getCurrentTopology).mock.calls.length - 1];

    expect(lastCall[1]?.startTime).toBe(1000000);
    expect(lastCall[1]?.endTime).toBe(2000000);
  });

  it("should display error message when API fails", async () => {
    vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(
      new Error("Network error")
    );

    const wrapper = mount(ServiceGraph, {
      global: {
        plugins: [i18n, store],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(wrapper.vm.error).toBeTruthy();
  });

  it("should persist visualization type to localStorage", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    const wrapper = mount(ServiceGraph, {
      global: {
        plugins: [i18n, store],
      },
    });

    // Change visualization type
    await wrapper.vm.setVisualizationType("tree");

    expect(setItemSpy).toHaveBeenCalledWith(
      "serviceGraph_visualizationType",
      "tree"
    );
  });

  it("should persist layout type to localStorage", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    const wrapper = mount(ServiceGraph, {
      global: {
        plugins: [i18n, store],
      },
    });

    // Change layout
    await wrapper.vm.setLayout("circular");

    expect(setItemSpy).toHaveBeenCalledWith(
      "serviceGraph_layoutType",
      "circular"
    );
  });

  it("should restore stream filter from localStorage on mount", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockReturnValue("test-stream");

    const wrapper = mount(ServiceGraph, {
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.vm.streamFilter).toBe("test-stream");
    getItemSpy.mockRestore();
  });
});
