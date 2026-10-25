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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import {
  intentSchemaKey,
  type IntentField,
  type IntentSchemas,
  type IntentStream,
} from "@/utils/alerts/intents";
import {
  buildIntentChoices,
  pickSuggestions,
  visibleIntents,
  type IntentChoice,
} from "@/utils/alerts/startSuggestions";
import type { AlertLibraryEntry } from "@/types/alertLibrary";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  run: vi.fn(),
  loadManifest: vi.fn(),
  loadAlertFile: vi.fn(),
}));

const state = {
  loading: ref(false),
  hasData: ref<boolean | null>(true),
  choices: ref<IntentChoice[]>([]),
};
const manifest = ref<any>(null);

vi.mock("@/composables/alerts/useAlertSuggestions", () => ({
  useAlertSuggestions: () => ({
    loading: state.loading,
    hasData: state.hasData,
    choices: state.choices,
    suggestions: computed(() => pickSuggestions(state.choices.value)),
    load: mocks.load,
  }),
  useSuggestionBacktest: () => ({ run: mocks.run }),
}));

vi.mock("@/composables/alerts/useAlertLibrary", () => ({
  useAlertLibrary: () => ({
    manifest,
    loadManifest: mocks.loadManifest,
    loadAlertFile: mocks.loadAlertFile,
  }),
}));

import AlertStartSheet from "@/components/alerts/AlertStartSheet.vue";

const NOW = Date.now();
const stream = (name: string, stream_type: string, doc_num: number): IntentStream => ({
  name,
  stream_type,
  stats: { doc_num, doc_time_max: (NOW - 60_000) * 1000 },
});
const fields = (...names: string[]): IntentField[] => names.map((name) => ({ name, type: "Utf8" }));
const app = stream("app", "logs", 900);
const spans = stream("spans", "traces", 500);
const schemas: IntentSchemas = {
  [intentSchemaKey(app)]: fields("level", "body"),
  [intentSchemaKey(spans)]: fields("span_status", "duration"),
};

const nginxEntry = {
  id: "nginx/5xx_spike",
  name: "nginx_5xx_spike",
  pack: "nginx",
  category: "errors",
  title: "Nginx 5xx spike",
  severity: "critical",
  description: "Server errors jump.",
  stream: "nginx",
  stream_type: "logs",
  query_type: "sql",
  required_streams: ["nginx"],
  path: "packs/nginx/alerts/5xx_spike.json",
  content_hash: "abc",
} as AlertLibraryEntry;

const ODialogStub = {
  name: "ODialog",
  props: ["open", "title", "subTitle", "size"],
  emits: ["update:open"],
  template: '<div data-test="o-dialog" :data-open="open"><slot v-if="open" /></div>',
};

const mountSheet = (props: Record<string, unknown> = {}) =>
  mount(AlertStartSheet, {
    props: { open: true, ...props },
    global: { plugins: [i18n, store, router], stubs: { ODialog: ODialogStub } },
  });

beforeEach(() => {
  state.loading.value = false;
  state.hasData.value = true;
  state.choices.value = buildIntentChoices(visibleIntents(false), [app, spans], schemas, NOW);
  manifest.value = { alerts: [nginxEntry], anomaly_alerts: [] };
  mocks.load.mockResolvedValue(undefined);
  mocks.run.mockResolvedValue(null);
  mocks.loadManifest.mockResolvedValue(manifest.value);
  (store.state as any).zoConfig = { ...(store.state as any).zoConfig, custom_hide_menus: "" };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AlertStartSheet", () => {
  it("reads the org's streams when it opens", async () => {
    mountSheet();
    await flushPromises();
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it("emits each suggestion card's own prefill", async () => {
    const wrapper = mountSheet();
    await flushPromises();
    const expected = pickSuggestions(state.choices.value);
    const cards = wrapper.findAll('[data-test="alert-start-sheet-suggestion"] button');
    expect(cards).toHaveLength(expected.length);
    for (const card of cards) await card.trigger("click");
    const emitted = (wrapper.emitted("choose") ?? []).map(([prefill]: any) => prefill);
    expect(emitted).toEqual(expected.map((s) => s.prefill));
    expect(emitted.every((p: any) => p.source === "suggestion")).toBe(true);
  });

  it("emits an intent's prefill and skips an intent no stream fits", async () => {
    const wrapper = mountSheet();
    await flushPromises();
    await wrapper.find('[data-test="alert-start-sheet-intent-errors_increase"]').trigger("click");
    await wrapper
      .find('[data-test="alert-start-sheet-intent-metric_crosses_limit"]')
      .trigger("click");
    const emitted = wrapper.emitted("choose") ?? [];
    expect(emitted).toHaveLength(1);
    expect((emitted[0][0] as any).source).toBe("intent");
    expect((emitted[0][0] as any).streamName).toBe("app");
  });

  it("lists every intent the org can use, Data stops arriving included", async () => {
    const wrapper = mountSheet();
    await flushPromises();
    const ids = wrapper
      .findAll('[data-test^="alert-start-sheet-intent-"]')
      .map((el) => el.attributes("data-test"));
    expect(ids).toContain("alert-start-sheet-intent-data_stops_arriving");
    expect(ids).toContain("alert-start-sheet-intent-message_appears");
    expect(ids).toHaveLength(5);
  });

  it("asks for data first and disables intents when the org has none", async () => {
    state.hasData.value = false;
    state.choices.value = buildIntentChoices(visibleIntents(false), [], {}, NOW);
    const wrapper = mountSheet();
    await flushPromises();
    expect(wrapper.find('[data-test="alert-start-sheet-no-data"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-start-sheet-suggestion"]').exists()).toBe(false);
    await wrapper.find('[data-test="alert-start-sheet-intent-errors_increase"]').trigger("click");
    expect(wrapper.emitted("choose")).toBeUndefined();
  });

  it("emits import and blank from the other ways to start", async () => {
    const wrapper = mountSheet();
    await flushPromises();
    await wrapper.find('[data-test="alert-start-sheet-import"]').trigger("click");
    await wrapper.find('[data-test="alert-start-sheet-blank"]').trigger("click");
    expect(wrapper.emitted("import")).toHaveLength(1);
    expect(wrapper.emitted("blank")).toHaveLength(1);
  });

  it("searches the library and opens a match as a library prefill", async () => {
    mocks.loadAlertFile.mockResolvedValue({
      name: "nginx_5xx_spike",
      stream_type: "logs",
      stream_name: "nginx",
      query_condition: { type: "sql", sql: "SELECT count(*) FROM nginx" },
      trigger_condition: { period: 5, threshold: 1, operator: ">=" },
    });
    const wrapper = mountSheet();
    await flushPromises();
    wrapper.findComponent({ name: "OSearchInput" }).vm.$emit("update:modelValue", "nginx spike");
    await flushPromises();
    const results = wrapper.findAll('[data-test="alert-start-sheet-library-result"]');
    expect(results).toHaveLength(1);
    await results[0].trigger("click");
    await flushPromises();
    expect(mocks.loadAlertFile).toHaveBeenCalledWith(nginxEntry);
    const [prefill] = (wrapper.emitted("choose") ?? [])[0] as any[];
    expect(prefill.source).toBe("library");
    expect(prefill.streamName).toBe("nginx");
  });

  it("drops the library search when the Library menu is hidden", async () => {
    (store.state as any).zoConfig.custom_hide_menus = "alertLibrary";
    const wrapper = mountSheet();
    await flushPromises();
    expect(wrapper.find('[data-test="alert-start-sheet-library"]').exists()).toBe(false);
  });
});
