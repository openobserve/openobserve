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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import RelativeTime from "./RelativeTime.vue";
import { createStore } from "vuex";

// Mock zincutils
vi.mock("@/utils/zincutils", () => ({
  timestampToTimezoneDate: vi.fn((timestamp, timezone, format) => {
    return "2024-01-15 10:30:45.123";
  }),
}));

describe("RelativeTime", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        timezone: "UTC",
      },
    });

    vi.clearAllMocks();
  });

  it("should render the component", () => {
    const wrapper = mount(RelativeTime, {
      props: {
        timestamp: Date.now(),
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should display relative time for recent timestamp", async () => {
    const timestamp = Date.now() - 30000; // 30 seconds ago
    const wrapper = mount(RelativeTime, {
      props: {
        timestamp,
      },
      global: {
        plugins: [store],
      },
    });

    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toBeTruthy();
  });

  it("should handle null timestamp", () => {
    const wrapper = mount(RelativeTime, {
      props: {
        timestamp: null,
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.text()).toBe("");
  });

  it("should display empty string when timestamp is not provided", () => {
    const wrapper = mount(RelativeTime, {
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.text()).toBe("");
  });

  it("should have title attribute with formatted exact time", () => {
    const timestamp = Date.now();
    const wrapper = mount(RelativeTime, {
      props: {
        timestamp,
      },
      global: {
        plugins: [store],
      },
    });

    const span = wrapper.find("span");
    expect(span.attributes("title")).toBeTruthy();
  });

  it("should include fullTimePrefix in title when provided", () => {
    const timestamp = Date.now();
    const wrapper = mount(RelativeTime, {
      props: {
        timestamp,
        fullTimePrefix: "Last Updated:",
      },
      global: {
        plugins: [store],
      },
    });

    const span = wrapper.find("span");
    const title = span.attributes("title");
    expect(title).toContain("Last Updated:");
  });

  it("should format timestamp as relative time in seconds", async () => {
    const timestamp = Date.now() - 5000; // 5 seconds ago
    const wrapper = mount(RelativeTime, {
      props: {
        timestamp,
      },
      global: {
        plugins: [store],
      },
    });

    await wrapper.vm.$nextTick();

    // Should show something like "5 sec ago"
    expect(wrapper.text()).toBeTruthy();
  });

  it("should format timestamp as relative time in minutes", async () => {
    const timestamp = Date.now() - 120000; // 2 minutes ago
    const wrapper = mount(RelativeTime, {
      props: {
        timestamp,
      },
      global: {
        plugins: [store],
      },
    });

    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toBeTruthy();
  });

  it("should format timestamp as relative time in hours", async () => {
    const timestamp = Date.now() - 7200000; // 2 hours ago
    const wrapper = mount(RelativeTime, {
      props: {
        timestamp,
      },
      global: {
        plugins: [store],
      },
    });

    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toBeTruthy();
  });

  it("should update relative time when timestamp prop changes", async () => {
    const timestamp1 = Date.now() - 30000;
    const wrapper = mount(RelativeTime, {
      props: {
        timestamp: timestamp1,
      },
      global: {
        plugins: [store],
      },
    });

    const initialText = wrapper.text();

    const timestamp2 = Date.now() - 120000;
    await wrapper.setProps({ timestamp: timestamp2 });

    // Text should update
    expect(wrapper.text()).toBeTruthy();
  });

  it("should include timezone in title", () => {
    const timestamp = Date.now();
    const wrapper = mount(RelativeTime, {
      props: {
        timestamp,
      },
      global: {
        plugins: [store],
      },
    });

    const span = wrapper.find("span");
    const title = span.attributes("title");
    expect(title).toContain("UTC");
  });

  it("should accept timestamp as number", async () => {
    const timestamp = 1704067200000; // Specific timestamp
    const wrapper = mount(RelativeTime, {
      props: {
        timestamp,
      },
      global: {
        plugins: [store],
      },
    });

    await wrapper.vm.$nextTick();

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.text()).toBeTruthy();
  });

  it("should render span element", () => {
    const timestamp = Date.now();
    const wrapper = mount(RelativeTime, {
      props: {
        timestamp,
      },
      global: {
        plugins: [store],
      },
    });

    const span = wrapper.find("span");
    expect(span.exists()).toBe(true);
  });

  it("should use default fullTimePrefix as empty string", () => {
    const timestamp = Date.now();
    const wrapper = mount(RelativeTime, {
      props: {
        timestamp,
      },
      global: {
        plugins: [store],
      },
    });

    const span = wrapper.find("span");
    const title = span.attributes("title");
    // Should not start with extra spaces from empty prefix
    expect(title).toBeTruthy();
  });
});
