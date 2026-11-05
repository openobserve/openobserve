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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";
import enLocale from "@/locales/languages/en-US.json";
import SampleDataTour from "./SampleDataTour.vue";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";
import { SAMPLE_TOUR_STEPS } from "@/utils/sampleData/tour";
import { logsReapplyRequest } from "@/utils/queryHistory/logs";

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

const resolveMock = vi.hoisted(() => vi.fn());
vi.mock("@/utils/sampleData/tour", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/sampleData/tour")>()),
  resolveTourTarget: (...args: unknown[]) => resolveMock(...args),
}));

const hasRealData = vi.hoisted(() => ({ value: false }));
vi.mock("@/composables/sampleData/useSampleDataPresence", () => ({
  useSampleDataPresence: () => ({ ready: ref(true), hasRealData: ref(hasRealData.value) }),
}));

const ORG = "test-org";
const session = useSampleDataSession();

const mounted: { unmount: () => void }[] = [];
const mountTour = async (
  start = "/",
  attachTo?: HTMLElement,
  features: Record<string, string> = {},
  printMode = false,
) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/p/:id", name: "page", component: { template: "<div />" } },
      { path: "/logs", name: "logs", component: { template: "<div />" } },
      {
        path: "/alerts",
        name: "alertList",
        meta: { licenseFeature: "alerts" },
        component: { template: "<div />" },
      },
    ],
  });
  await router.push(start);
  const store = createStore({
    state: {
      selectedOrganization: { identifier: ORG },
      kioskMode: false,
      printMode,
      zoConfig: { features },
    },
  });
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: enLocale } });
  const wrapper = mount(SampleDataTour, { attachTo, global: { plugins: [store, router, i18n] } });
  mounted.push(wrapper);
  return { wrapper, router };
};

describe("SampleDataTour", () => {
  beforeEach(() => {
    resolveMock.mockReset();
    hasRealData.value = false;
    resolveMock.mockImplementation(async (_org: string, id: string) => ({
      name: "page",
      params: { id },
    }));
  });
  afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
    session.stopTour();
  });

  it("restart navigates to the first step's page", async () => {
    session.startTour(ORG, SAMPLE_TOUR_STEPS.length);
    const { wrapper, router } = await mountTour();
    await wrapper.get('[data-test="sample-tour-restart"]').trigger("click");
    await flushPromises();
    expect(session.tour.value?.index).toBe(0);
    expect(router.currentRoute.value.params.id).toBe(SAMPLE_TOUR_STEPS[0].id);
  });

  it("toasts and stays on the step when the next page cannot be resolved", async () => {
    session.startTour(ORG, 1);
    const { wrapper, router } = await mountTour();
    resolveMock.mockRejectedValue(new Error("folders failed"));
    await wrapper.get('[data-test="sample-tour-next"]').trigger("click");
    await flushPromises();
    expect(session.tour.value?.index).toBe(1);
    expect(router.currentRoute.value.name).toBe("home");
    expect(toastMock).toHaveBeenCalledWith({
      variant: "error",
      message: "Could not open this step. Try again.",
    });
  });

  it("labels the finale buttons in Title Case", async () => {
    session.startTour(ORG, SAMPLE_TOUR_STEPS.length);
    const { wrapper } = await mountTour();
    const text = (id: string) => wrapper.get(`[data-test="sample-tour-${id}"]`).text();
    expect([text("connect"), text("restart"), text("finish")]).toEqual([
      "Connect Your Own Data",
      "Restart Tour",
      "Finish Tour",
    ]);
  });

  it("a double click on Next opens only the next step", async () => {
    session.startTour(ORG, 1);
    const { wrapper, router } = await mountTour();
    let release = () => {};
    resolveMock.mockImplementation(
      (_org: string, id: string) =>
        new Promise((resolve) => {
          release = () => resolve({ name: "page", params: { id } });
        }),
    );
    const next = wrapper.get('[data-test="sample-tour-next"]');
    await next.trigger("click");
    expect(next.attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-test="sample-tour-back"]').attributes("disabled")).toBeDefined();
    await next.trigger("click");
    expect(session.tour.value?.index).toBe(2);
    release();
    await flushPromises();
    expect(router.currentRoute.value.params.id).toBe(SAMPLE_TOUR_STEPS[2].id);
    expect(next.attributes("disabled")).toBeUndefined();
  });

  it("a tour restarted while active stays visible in an org with real data", async () => {
    hasRealData.value = true;
    session.startTour(ORG, 0);
    const { wrapper } = await mountTour();
    await flushPromises();
    expect(session.tour.value?.ownData).toBe(true);
    session.startTour(ORG, 0);
    await flushPromises();
    expect(session.tour.value?.ownData).toBe(true);
    expect(wrapper.find('[data-test="sample-tour-next"]').exists()).toBe(true);
  });

  it("moves between two log chapters with the router while a load runs, so the load survives", async () => {
    const logsIndex = SAMPLE_TOUR_STEPS.findIndex((s) => s.id === "logs");
    resolveMock.mockImplementation(async (_org: string, id: string) => ({
      name: "logs",
      query: { step: id },
    }));
    session.startTour(ORG, logsIndex);
    session.status.value = "loading";
    try {
      const { wrapper, router } = await mountTour("/logs?step=logs");
      const seq = logsReapplyRequest.value.seq;
      await wrapper.get('[data-test="sample-tour-next"]').trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.query.step).toBe(SAMPLE_TOUR_STEPS[logsIndex + 1].id);
      expect(logsReapplyRequest.value).toEqual({ seq: seq + 1, run: true });
    } finally {
      session.status.value = "idle";
    }
  });

  it("ending the tour while a step resolves does not navigate afterwards", async () => {
    session.startTour(ORG, 0);
    const { wrapper, router } = await mountTour();
    let release = () => {};
    resolveMock.mockImplementation(
      (_org: string, id: string) =>
        new Promise((resolve) => {
          release = () => resolve({ name: "page", params: { id } });
        }),
    );
    await wrapper.get('[data-test="sample-tour-next"]').trigger("click");
    session.stopTour();
    release();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("home");
  });

  it("moves focus into the panel when the tour starts, and to Finish Tour on the last step", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      session.startTour(ORG, 0);
      const { wrapper } = await mountTour("/", host);
      await flushPromises();
      expect(document.activeElement).toBe(wrapper.get('[data-test="sample-tour-panel"]').element);
      session.setTourIndex(SAMPLE_TOUR_STEPS.length);
      await flushPromises();
      expect(document.activeElement).toBe(wrapper.get('[data-test="sample-tour-finish"]').element);
    } finally {
      host.remove();
    }
  });

  it("skips a chapter whose license feature is locked, without breaking numbering or Back", async () => {
    session.startTour(ORG, 0);
    const { wrapper } = await mountTour("/", undefined, { alerts: "locked" });
    const alertIndex = SAMPLE_TOUR_STEPS.findIndex((s) => s.id === "alert");
    const total = SAMPLE_TOUR_STEPS.length - 1;
    expect(wrapper.get('[data-test="sample-tour-position"]').text()).toBe(
      `Guided tour · step 1 of ${total}`,
    );
    expect(wrapper.find('[data-test="sample-tour-dot-alert"]').exists()).toBe(false);
    await wrapper.get('[data-test="sample-tour-next"]').trigger("click");
    await flushPromises();
    expect(session.tour.value?.index).toBe(alertIndex + 1);
    expect(wrapper.get('[data-test="sample-tour-position"]').text()).toBe(
      `Guided tour · step 2 of ${total}`,
    );
    await wrapper.get('[data-test="sample-tour-back"]').trigger("click");
    await flushPromises();
    expect(session.tour.value?.index).toBe(0);
  });

  it("stays hidden in print mode", async () => {
    session.startTour(ORG, 0);
    const { wrapper } = await mountTour("/", undefined, {}, true);
    expect(wrapper.find('[data-test="sample-tour-panel"]').exists()).toBe(false);
  });
});
