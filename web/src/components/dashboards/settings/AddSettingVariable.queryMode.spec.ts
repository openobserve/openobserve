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
import { createStore } from "vuex";
import i18n from "@/locales";
import { qLayoutInjections } from "@/test/unit/helpers/layout-injections";

const { getDashboard, labelValues } = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  labelValues: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: { dashboard: "d1", folder: "default", period: "1h" } }),
}));
vi.mock("@/utils/commons", () => ({
  getDashboard,
  addVariable: vi.fn(),
  updateVariable: vi.fn(),
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn().mockResolvedValue({ list: [{ name: "up" }] }),
    getStream: vi.fn().mockResolvedValue({ schema: [{ name: "job" }, { name: "env" }] }),
  }),
}));
vi.mock("@/services/metrics", () => ({ default: { labelValues, labels: vi.fn() } }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: vi.fn(),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));
vi.mock("@/components/QueryEditor.vue", () => ({
  default: {
    name: "UnifiedQueryEditor",
    props: ["query", "languages", "defaultLanguage"],
    emits: ["update:query", "run-query"],
    template: '<textarea :value="query"></textarea>',
  },
}));

import AddSettingVariable from "./AddSettingVariable.vue";

const store = createStore({
  state: { theme: "light", selectedOrganization: { identifier: "org" }, zoConfig: {} },
});

const autoPromqlVariable = {
  name: "job",
  type: "query_values",
  query_data: {
    stream_type: "metrics",
    stream: "up",
    field: "job",
    max_record_size: null,
    filter: [{ name: "env", operator: "=", value: "prod" }],
    query_type: "promql",
  },
};

const mountForm = async () => {
  getDashboard.mockResolvedValue({ tabs: [], variables: { list: [autoPromqlVariable] } });
  const wrapper = mount(AddSettingVariable, {
    props: { variableName: "job", dashboardVariablesList: [autoPromqlVariable] },
    global: { plugins: [i18n, store], provide: qLayoutInjections() },
    attachTo: document.body,
  });
  await flushPromises();
  await flushPromises();
  return wrapper;
};

const editorText = (wrapper: any) =>
  wrapper.findComponent({ name: "UnifiedQueryEditor" }).props("query");

const click = async (wrapper: any, dataTest: string) => {
  await wrapper.find(`[data-test="${dataTest}"]`).trigger("click");
  await flushPromises();
};

describe("AddSettingVariable with the real query editor", () => {
  beforeEach(() => {
    labelValues.mockReset();
  });

  it("opens a saved auto PromQL variable, switches to custom with the prefilled query and previews it", async () => {
    labelValues.mockResolvedValue({ data: { status: "success", data: ["api", "web"] } });
    const wrapper = await mountForm();
    expect(wrapper.find('[data-test="dashboard-variable-query-language-row"]').text()).toContain(
      "Query language",
    );
    expect(wrapper.find('[data-test="dashboard-variable-query-editor"]').exists()).toBe(false);

    await click(wrapper, "dashboard-variable-query-mode-custom");

    expect(editorText(wrapper)).toBe('label_values(up{env="prod"}, job)');
    expect(wrapper.find('[data-test="dashboard-variable-field-select"]').exists()).toBe(false);

    await click(wrapper, "dashboard-variable-query-run-preview");
    expect(labelValues).toHaveBeenCalledWith(
      expect.objectContaining({ label: "job", match: 'up{env="prod"}' }),
    );
    expect(wrapper.find('[data-test="dashboard-variable-query-preview-count"]').text()).toBe(
      "2 values",
    );

    await click(wrapper, "dashboard-variable-query-mode-auto");
    expect(wrapper.find('[data-test="dashboard-variable-query-editor"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="dashboard-variable-field-select"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("swaps the custom text when the language switch is clicked", async () => {
    const wrapper = await mountForm();
    await click(wrapper, "dashboard-variable-query-mode-custom");
    await click(wrapper, "dashboard-variable-query-language-sql");

    expect(editorText(wrapper)).toBe(`SELECT DISTINCT "job" FROM "up" WHERE "env" = 'prod'`);
    wrapper.unmount();
  });
});
