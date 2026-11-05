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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";
import enLocale from "@/locales/languages/en-US.json";
import SampleDataProgressDock from "./SampleDataProgressDock.vue";

const ORG = "test-org";

vi.mock("@/composables/sampleData/useSampleDataSession", async () => {
  const { ref, reactive } = await import("vue");
  const s = {
    status: ref("loading"),
    loadingOrg: ref("test-org"),
    error: ref<string | null>(null),
    forbidden: ref(false),
    welcomeOpen: ref(false),
    fraction: ref(0.2),
    counts: reactive({ logs: 0, spans: 0, metrics: 0 }),
    tour: ref<{ org: string } | null>(null),
    start: vi.fn(),
    startTour: vi.fn(),
    openWelcome: vi.fn(),
  };
  return { useSampleDataSession: () => s };
});
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";

const session = useSampleDataSession() as any;

const mountDock = (printMode = false) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  const store = createStore({
    state: {
      selectedOrganization: { identifier: ORG },
      kioskMode: false,
      printMode,
      zoConfig: { ingest_allowed_upto: 6 },
    },
  });
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: enLocale } });
  return mount(SampleDataProgressDock, { global: { plugins: [store, router, i18n] } });
};

describe("SampleDataProgressDock", () => {
  afterEach(() => {
    session.status.value = "loading";
    session.error.value = null;
    session.forbidden.value = false;
    session.tour.value = null;
    session.start.mockClear();
  });

  it("announces only the state line, not the counts", async () => {
    const wrapper = mountDock();
    await flushPromises();
    expect(
      wrapper.get('[data-test="sample-data-progress-dock"]').attributes("role"),
    ).toBeUndefined();
    const live = wrapper.findAll('[role="status"]');
    expect(live.map((el) => el.text())).toEqual([enLocale.sampleData.welcome.progress.title]);
    session.status.value = "failed";
    await flushPromises();
    expect(wrapper.findAll('[role="status"]').map((el) => el.text())).toEqual([
      enLocale.sampleData.toast.loadFailed,
    ]);
  });

  it("shows a failed state with retry when a background load fails", async () => {
    const wrapper = mountDock();
    session.status.value = "failed";
    session.error.value = "boom";
    await flushPromises();
    const dock = wrapper.get('[data-test="sample-data-progress-dock"]');
    expect(dock.attributes("data-state")).toBe("failed");
    expect(dock.text()).toContain("boom");
    await wrapper.get('[data-test="sample-data-progress-dock-retry"]').trigger("click");
    expect(session.start).toHaveBeenCalledWith(ORG, 6);
  });

  it("says the user needs write access when the load is refused", async () => {
    const wrapper = mountDock();
    session.status.value = "failed";
    session.error.value = "Unauthorized Access";
    session.forbidden.value = true;
    await flushPromises();
    expect(wrapper.get('[data-test="sample-data-progress-dock-error"]').text()).toBe(
      enLocale.sampleData.loadForbidden,
    );
  });

  it("hides Retry when the load was refused, since it would fail again", async () => {
    const wrapper = mountDock();
    session.status.value = "failed";
    session.forbidden.value = true;
    await flushPromises();
    expect(wrapper.find('[data-test="sample-data-progress-dock-retry"]').exists()).toBe(false);
  });

  it("still shows the ready notice when the saved tour belongs to another org", async () => {
    const wrapper = mountDock();
    session.tour.value = { org: "other-org" };
    session.status.value = "loaded";
    await flushPromises();
    expect(wrapper.get('[data-test="sample-data-progress-dock"]').attributes("data-state")).toBe(
      "done",
    );
  });

  it("falls back to the generic message and can be closed", async () => {
    const wrapper = mountDock();
    session.status.value = "failed";
    await flushPromises();
    expect(wrapper.text()).toContain(enLocale.sampleData.toast.loadFailed);
    await wrapper.get('[data-test="sample-data-progress-dock-close"]').trigger("click");
    expect(wrapper.find('[data-test="sample-data-progress-dock"]').exists()).toBe(false);
  });

  it("stays hidden in print mode", async () => {
    const wrapper = mountDock(true);
    await flushPromises();
    expect(wrapper.find('[data-test="sample-data-progress-dock"]').exists()).toBe(false);
  });
});
