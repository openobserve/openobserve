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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { intentSchemaKey, type IntentStream } from "@/utils/alerts/intents";
import {
  buildIntentChoices,
  pickSuggestions,
  visibleIntents,
  type IntentChoice,
} from "@/utils/alerts/startSuggestions";

const mocks = vi.hoisted(() => ({ load: vi.fn(), run: vi.fn() }));
const choices = ref<IntentChoice[]>([]);

vi.mock("@/composables/alerts/useAlertSuggestions", () => ({
  useAlertSuggestions: () => ({
    loading: ref(false),
    hasData: ref(true),
    choices,
    suggestions: computed(() => pickSuggestions(choices.value)),
    load: mocks.load,
  }),
  useSuggestionBacktest: () => ({ run: mocks.run }),
}));

import AlertListFirstRun from "@/components/alerts/AlertListFirstRun.vue";

const NOW = Date.now();
const app: IntentStream = {
  name: "app",
  stream_type: "logs",
  stats: { doc_num: 900, doc_time_max: (NOW - 60_000) * 1000 },
};

const mountFirstRun = (hasData: boolean | null) =>
  mount(AlertListFirstRun, {
    props: { hasData },
    global: { plugins: [i18n, store, router] },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.run.mockResolvedValue(null);
  choices.value = buildIntentChoices(
    visibleIntents(false),
    [app],
    { [intentSchemaKey(app)]: [{ name: "level", type: "Utf8" }] },
    NOW,
  );
});

describe("AlertListFirstRun", () => {
  it("shows the org's suggestions above the ways to start", async () => {
    const wrapper = mountFirstRun(true);
    await flushPromises();
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("Set up your first alert");
    expect(wrapper.findAll('[data-test="alert-start-sheet-suggestion"]').length).toBeGreaterThan(0);
    expect(wrapper.find('[data-test="alert-list-first-run-situations"]').exists()).toBe(true);
  });

  it("emits a suggestion's prefill and each way to start", async () => {
    const wrapper = mountFirstRun(true);
    await flushPromises();
    await wrapper.find('[data-test="alert-start-sheet-suggestion"] button').trigger("click");
    await wrapper.find('[data-test="alert-list-first-run-create"]').trigger("click");
    await wrapper.find('[data-test="alert-list-first-run-situations"]').trigger("click");
    await wrapper.find('[data-test="alert-list-first-run-import"]').trigger("click");
    expect((wrapper.emitted("choose")?.[0][0] as any).source).toBe("suggestion");
    expect(wrapper.emitted("blank")).toHaveLength(1);
    expect(wrapper.emitted("situations")).toHaveLength(1);
    expect(wrapper.emitted("import")).toHaveLength(1);
  });

  it("asks for data first when the org has none, keeping create and import", async () => {
    const wrapper = mountFirstRun(false);
    await flushPromises();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Send data first");
    expect(wrapper.find('[data-test="alert-start-sheet-suggestion"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-list-first-run-ingest"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-list-first-run-create"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-list-first-run-import"]').exists()).toBe(true);
  });
});
