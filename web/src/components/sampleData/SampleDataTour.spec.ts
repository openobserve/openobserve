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

const resolveMock = vi.hoisted(() => vi.fn());
vi.mock("@/utils/sampleData/tour", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/sampleData/tour")>()),
  resolveTourTarget: (...args: unknown[]) => resolveMock(...args),
}));

vi.mock("@/composables/sampleData/useSampleDataPresence", () => ({
  useSampleDataPresence: () => ({ ready: ref(true), hasRealData: ref(false) }),
}));

const ORG = "test-org";
const session = useSampleDataSession();

const mountTour = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/p/:id", name: "page", component: { template: "<div />" } },
    ],
  });
  await router.push("/");
  const store = createStore({
    state: { selectedOrganization: { identifier: ORG }, kioskMode: false },
  });
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: enLocale } });
  const wrapper = mount(SampleDataTour, { global: { plugins: [store, router, i18n] } });
  return { wrapper, router };
};

describe("SampleDataTour", () => {
  beforeEach(() => {
    resolveMock.mockReset();
    resolveMock.mockImplementation(async (_org: string, id: string) => ({
      name: "page",
      params: { id },
    }));
  });
  afterEach(() => session.stopTour());

  it("restart navigates to the first step's page", async () => {
    session.startTour(ORG, SAMPLE_TOUR_STEPS.length);
    const { wrapper, router } = await mountTour();
    await wrapper.get('[data-test="sample-tour-restart"]').trigger("click");
    await flushPromises();
    expect(session.tour.value?.index).toBe(0);
    expect(router.currentRoute.value.params.id).toBe(SAMPLE_TOUR_STEPS[0].id);
  });

  it("only the latest step request navigates when resolutions finish out of order", async () => {
    session.startTour(ORG, 0);
    const { wrapper, router } = await mountTour();
    const releases: Record<string, () => void> = {};
    resolveMock.mockImplementation(
      (_org: string, id: string) =>
        new Promise((resolve) => {
          releases[id] = () => resolve({ name: "page", params: { id } });
        }),
    );
    const next = wrapper.get('[data-test="sample-tour-next"]');
    await next.trigger("click");
    await next.trigger("click");
    releases[SAMPLE_TOUR_STEPS[2].id]();
    await flushPromises();
    releases[SAMPLE_TOUR_STEPS[1].id]();
    await flushPromises();
    expect(session.tour.value?.index).toBe(2);
    expect(router.currentRoute.value.params.id).toBe(SAMPLE_TOUR_STEPS[2].id);
  });
});
