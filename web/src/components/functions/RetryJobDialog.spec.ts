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

import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import RetryJobDialog from "./RetryJobDialog.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";

installQuasar();

describe("RetryJobDialog", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
      },
    });
  });

  it("should render the component when modelValue is true", () => {
    const wrapper = mount(RetryJobDialog, {
      props: {
        modelValue: true,
        tableName: "test_table",
        url: "https://example.com/data.csv",
        supportsRange: true,
        lastBytePosition: 1024,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    expect(wrapper.exists()).toBe(true);
    wrapper.unmount();
  });

  it("should display table name and URL", async () => {
    const wrapper = mount(RetryJobDialog, {
      props: {
        modelValue: true,
        tableName: "my_enrichment_table",
        url: "https://cdn.example.com/enrichment.csv",
        supportsRange: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await wrapper.vm.$nextTick();
    await flushPromises();

    const bodyText = document.body.textContent || "";
    expect(bodyText).toContain("my_enrichment_table");
    expect(bodyText).toContain("https://cdn.example.com/enrichment.csv");
    wrapper.unmount();
  });

  it("should show warning when range is not supported", async () => {
    const wrapper = mount(RetryJobDialog, {
      props: {
        modelValue: true,
        tableName: "test_table",
        url: "https://example.com/data.csv",
        supportsRange: false,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await wrapper.vm.$nextTick();
    await flushPromises();

    const bodyText = document.body.textContent || "";
    expect(bodyText).toContain("Range requests not supported");
    wrapper.unmount();
  });

  it("should show retry options when range is supported", async () => {
    const wrapper = mount(RetryJobDialog, {
      props: {
        modelValue: true,
        tableName: "test_table",
        url: "https://example.com/data.csv",
        supportsRange: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await wrapper.vm.$nextTick();
    await flushPromises();

    const bodyText = document.body.textContent || "";
    expect(bodyText).toContain("Start from Beginning");
    expect(bodyText).toContain("Resume from Last Position");
    wrapper.unmount();
  });

  it("should default to resume option when range is supported", () => {
    const wrapper = mount(RetryJobDialog, {
      props: {
        modelValue: true,
        tableName: "test_table",
        url: "https://example.com/data.csv",
        supportsRange: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    expect(wrapper.vm.resumeFromLast).toBe(true);
    wrapper.unmount();
  });

  it("should emit cancel when cancel button is clicked", async () => {
    const wrapper = mount(RetryJobDialog, {
      props: {
        modelValue: true,
        tableName: "test_table",
        url: "https://example.com/data.csv",
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await wrapper.vm.$nextTick();

    const buttons = wrapper.findAllComponents({ name: "QBtn" });
    const cancelButton = buttons.find(btn => btn.text() === "Cancel");
    await cancelButton?.trigger("click");

    expect(wrapper.emitted("cancel")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    wrapper.unmount();
  });

  it("should emit confirm with resumeFromLast value when retry button is clicked", async () => {
    const wrapper = mount(RetryJobDialog, {
      props: {
        modelValue: true,
        tableName: "test_table",
        url: "https://example.com/data.csv",
        supportsRange: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await wrapper.vm.$nextTick();

    const buttons = wrapper.findAllComponents({ name: "QBtn" });
    const retryButton = buttons.find(btn => btn.text() === "Retry");
    await retryButton?.trigger("click");

    expect(wrapper.emitted("confirm")).toBeTruthy();
    expect(wrapper.emitted("confirm")?.[0]).toEqual([true]);
    wrapper.unmount();
  });

  it("should format bytes correctly", () => {
    const wrapper = mount(RetryJobDialog, {
      props: {
        modelValue: true,
        tableName: "test_table",
        url: "https://example.com/data.csv",
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    expect(wrapper.vm.formatBytes(0)).toBe("0 Bytes");
    expect(wrapper.vm.formatBytes(1024)).toBe("1 KB");
    expect(wrapper.vm.formatBytes(1048576)).toBe("1 MB");
    expect(wrapper.vm.formatBytes(1073741824)).toBe("1 GB");
    wrapper.unmount();
  });

  it("should display formatted last byte position", async () => {
    const wrapper = mount(RetryJobDialog, {
      props: {
        modelValue: true,
        tableName: "test_table",
        url: "https://example.com/data.csv",
        supportsRange: true,
        lastBytePosition: 5242880, // 5 MB
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await wrapper.vm.$nextTick();
    await flushPromises();

    const bodyText = document.body.textContent || "";
    expect(bodyText).toContain("5 MB");
    wrapper.unmount();
  });

  it("should apply dark theme when theme is dark", async () => {
    const darkStore = createStore({
      state: {
        theme: "dark",
      },
    });

    const wrapper = mount(RetryJobDialog, {
      props: {
        modelValue: true,
        tableName: "test_table",
        url: "https://example.com/data.csv",
      },
      global: {
        plugins: [darkStore],
      },
      attachTo: document.body,
    });

    await wrapper.vm.$nextTick();
    await flushPromises();

    const dialog = document.body.querySelector(".retry-dialog");
    expect(dialog?.classList.contains("dark-theme")).toBe(true);
    wrapper.unmount();
  });

  it("should toggle resume option", async () => {
    const wrapper = mount(RetryJobDialog, {
      props: {
        modelValue: true,
        tableName: "test_table",
        url: "https://example.com/data.csv",
        supportsRange: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await wrapper.vm.$nextTick();
    await flushPromises();

    const radios = document.body.querySelectorAll('input[type="radio"]');
    expect(radios.length).toBe(2);

    (radios[0] as HTMLInputElement).click();
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.resumeFromLast).toBe(false);

    (radios[1] as HTMLInputElement).click();
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.resumeFromLast).toBe(true);

    wrapper.unmount();
  });

  it("should show recommended badge on resume option", async () => {
    const wrapper = mount(RetryJobDialog, {
      props: {
        modelValue: true,
        tableName: "test_table",
        url: "https://example.com/data.csv",
        supportsRange: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await wrapper.vm.$nextTick();
    await flushPromises();

    const bodyText = document.body.textContent || "";
    expect(bodyText).toContain("Recommended");
    wrapper.unmount();
  });

  it("should show dialog title", async () => {
    const wrapper = mount(RetryJobDialog, {
      props: {
        modelValue: true,
        tableName: "test_table",
        url: "https://example.com/data.csv",
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await wrapper.vm.$nextTick();
    await flushPromises();

    const bodyText = document.body.textContent || "";
    expect(bodyText).toContain("Retry Enrichment Table Job");
    wrapper.unmount();
  });
});
