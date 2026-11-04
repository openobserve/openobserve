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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createStore } from "vuex";
import enLocale from "@/locales/languages/en-US.json";
import SampleDataProgress from "./SampleDataProgress.vue";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";

const session = useSampleDataSession();
const i18n = createI18n({ legacy: false, locale: "en", messages: { en: enLocale } });

const frames: FrameRequestCallback[] = [];
const runFrame = (now: number) => frames.splice(0).forEach((cb) => cb(now));

const mountProgress = (props: { done?: boolean } = {}) =>
  mount(SampleDataProgress, {
    props,
    global: {
      plugins: [i18n, createStore({ state: { selectedOrganization: { identifier: "test-org" } } })],
      stubs: { SampleLivePreview: true },
    },
  });
const tileText = (wrapper: ReturnType<typeof mountProgress>, key: string) =>
  wrapper.get(`[data-test="sample-data-progress-${key}"]`).text();

describe("SampleDataProgress", () => {
  beforeEach(() => {
    frames.length = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    session.status.value = "loading";
    Object.assign(session.counts, { logs: 0, spans: 0, metrics: 0 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    session.status.value = "idle";
  });

  it("counts the tiles up to the latest totals", async () => {
    const wrapper = mountProgress();
    Object.assign(session.counts, { logs: 1200, spans: 300, metrics: 45 });
    await nextTick();
    runFrame(0);
    runFrame(300);
    await nextTick();
    expect(tileText(wrapper, "logs")).not.toContain((1200).toLocaleString());
    runFrame(600);
    await nextTick();
    expect(tileText(wrapper, "logs")).toContain((1200).toLocaleString());
    expect(tileText(wrapper, "spans")).toContain("300");
    expect(tileText(wrapper, "metrics")).toContain("45");
  });

  it("jumps straight to the totals under reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const wrapper = mountProgress();
    Object.assign(session.counts, { logs: 1200, spans: 300, metrics: 45 });
    await nextTick();
    expect(tileText(wrapper, "logs")).toContain((1200).toLocaleString());
  });

  it("shows sample data loaded earlier as complete, without counts it never saw", () => {
    session.status.value = "idle";
    const wrapper = mountProgress({ done: true });
    expect(wrapper.get('[data-test="sample-data-progress-percent"]').text()).toBe("100%");
    expect(
      wrapper.findAll('[data-test^="sample-data-step-"]').map((c) => c.attributes("data-status")),
    ).toEqual(Array(6).fill("done"));
    expect(tileText(wrapper, "logs")).toContain("—");
    // no rows were sent in this session, so there is nothing real to replay
    expect(wrapper.findComponent({ name: "SampleLivePreview" }).exists()).toBe(false);
  });
});
