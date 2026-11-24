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

const { getDashboard, labelValues, updateVariable, scrollIntoView } = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  labelValues: vi.fn(),
  updateVariable: vi.fn(),
  scrollIntoView: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: { dashboard: "d1", folder: "default", period: "1h" } }),
}));
vi.mock("@/utils/commons", () => ({
  getDashboard,
  addVariable: vi.fn(),
  updateVariable,
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

// jsdom has no layout, so a blocked Save's scroll to its message is only recorded.
Element.prototype.scrollIntoView = scrollIntoView;

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

const mountForm = async (variable: any = autoPromqlVariable, others: any[] = []) => {
  const list = [...others, variable];
  getDashboard.mockResolvedValue({ tabs: [], variables: { list } });
  const wrapper = mount(AddSettingVariable, {
    props: { variableName: variable.name, dashboardVariablesList: list },
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
    updateVariable.mockReset();
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

  it("labels the Builder pickers Metric and Label for PromQL, and Stream and Field for SQL", async () => {
    const wrapper = await mountForm();
    const pickerLabel = (name: string) =>
      wrapper
        .findAllComponents({ name: "OFormSelect" })
        .find((select: any) => select.props("name") === name)
        ?.props("label");
    expect([pickerLabel("query_data.stream"), pickerLabel("query_data.field")]).toEqual([
      "Metric",
      "Label",
    ]);

    await click(wrapper, "dashboard-variable-query-language-sql");
    expect([pickerLabel("query_data.stream"), pickerLabel("query_data.field")]).toEqual([
      "Stream",
      "Field",
    ]);
    wrapper.unmount();
  });

  it("names the modes Builder and Custom like the panel editor, apart from the Custom values default", async () => {
    const wrapper = await mountForm();
    const text = (dataTest: string) => wrapper.find(`[data-test="${dataTest}"]`).text();
    expect(text("dashboard-variable-query-mode-auto")).toBe("Builder");
    expect(text("dashboard-variable-query-mode-custom")).toBe("Custom");
    expect(text("dashboard-multi-select-default-value-toggle-custom")).toBe("Custom values");
    wrapper.unmount();
  });

  it("opens a saved query as custom SQL and saves it back without a mode or language key", async () => {
    const customSql = {
      name: "svc",
      type: "query_values",
      query_data: {
        stream_type: "logs",
        stream: "",
        field: "",
        max_record_size: null,
        filter: [],
        query: "SELECT svc FROM logs",
      },
    };
    const wrapper = await mountForm(customSql);
    expect(wrapper.find('[data-test="dashboard-variable-query-editor"]').exists()).toBe(true);
    expect(editorText(wrapper)).toBe("SELECT svc FROM logs");
    expect(wrapper.vm.variableData.query_data.query_type).toBe("sql");

    const saved = (wrapper.vm as any).buildVariablePayload(wrapper.vm.variableData).query_data;
    expect(saved.query).toBe("SELECT svc FROM logs");
    expect(saved).not.toHaveProperty("custom_query");
    expect(saved).not.toHaveProperty("query_type");
    wrapper.unmount();
  });

  it("prefills IN for a filter on a multi-select parent, as the auto query runs it", async () => {
    const env = {
      name: "env",
      type: "query_values",
      multiSelect: true,
      query_data: { stream_type: "logs", stream: "app", field: "env", filter: [] },
    };
    const service = {
      name: "service",
      type: "query_values",
      query_data: {
        stream_type: "logs",
        stream: "app",
        field: "service",
        max_record_size: null,
        filter: [
          { name: "env", operator: "=", value: "$env" },
          { name: "region", operator: "=", value: "eu" },
        ],
      },
    };
    const wrapper = await mountForm(service, [env]);
    await click(wrapper, "dashboard-variable-query-mode-custom");

    expect(editorText(wrapper)).toBe(
      `SELECT DISTINCT "service" FROM "app" WHERE "env" IN ('$env') AND "region" = 'eu'`,
    );
    wrapper.unmount();
  });

  it("swaps the custom text when the language switch is clicked", async () => {
    const wrapper = await mountForm();
    await click(wrapper, "dashboard-variable-query-mode-custom");
    await click(wrapper, "dashboard-variable-query-language-sql");

    expect(editorText(wrapper)).toBe(`SELECT DISTINCT "job" FROM "up" WHERE "env" = 'prod'`);
    wrapper.unmount();
  });

  it("checks the Builder settings for a loop once a typed custom query is left behind", async () => {
    const env = {
      name: "env",
      type: "query_values",
      query_data: {
        stream_type: "logs",
        stream: "app",
        field: "env",
        filter: [{ name: "service", operator: "=", value: "$svc" }],
      },
    };
    const svc = {
      name: "svc",
      type: "query_values",
      query_data: { stream_type: "logs", stream: "app", field: "service", filter: [] },
    };
    const wrapper = await mountForm(svc, [env]);
    const vm = wrapper.vm as any;
    await click(wrapper, "dashboard-variable-query-mode-custom");
    vm.setFormField("query_data.query", "SELECT service FROM app WHERE env = '$env'");
    await vm.onSubmit(vm.variableData);
    expect(vm.filterCycleError).toBe("env and svc depend on each other.");
    expect(updateVariable).not.toHaveBeenCalled();

    await click(wrapper, "dashboard-variable-query-mode-auto");
    await vm.onSubmit(vm.variableData);
    await flushPromises();
    expect(vm.filterCycleError).toBe("");
    expect(updateVariable).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});

describe("AddSettingVariable OR filters and blocked saves", () => {
  const sqlMetricsVariable = {
    ...autoPromqlVariable,
    query_data: {
      ...autoPromqlVariable.query_data,
      query_type: "sql",
      filter: [
        { name: "env", operator: "=", value: "staging" },
        { name: "job", operator: "=", value: "job-eu-west" },
      ],
    },
  };
  const selfLoop = {
    name: "svc",
    type: "query_values",
    query_data: {
      stream_type: "logs",
      stream: "",
      field: "",
      max_record_size: null,
      filter: [],
      query: `SELECT service FROM "app" WHERE service != '$svc'`,
      value_field: "service",
    },
  };

  const mountWithOrFilters = async () => {
    const wrapper = await mountForm(sqlMetricsVariable);
    await click(wrapper, "dashboard-variable-filter-builder-connector-1");
    expect(wrapper.vm.variableData.query_data.filter_group).toBeTruthy();
    return wrapper;
  };

  beforeEach(() => {
    updateVariable.mockReset();
    scrollIntoView.mockReset();
  });

  it("keeps a PromQL variable with OR filters in Builder and shows why when Custom is clicked", async () => {
    const wrapper = await mountWithOrFilters();
    await click(wrapper, "dashboard-variable-query-language-promql");
    await click(wrapper, "dashboard-variable-query-mode-custom");

    expect(wrapper.vm.variableData.query_data.custom_query).toBe(false);
    expect(wrapper.find('[data-test="dashboard-variable-query-editor"]').exists()).toBe(false);
    const issues = wrapper.find('[data-test="dashboard-variable-filter-builder-issues"]');
    expect(issues.text()).toContain("PromQL filters support AND only");
    expect(scrollIntoView.mock.contexts).toContain(issues.element);
    wrapper.unmount();
  });

  it("leaves the PromQL text empty instead of dropping OR filters on a language switch in Custom", async () => {
    const wrapper = await mountWithOrFilters();
    await click(wrapper, "dashboard-variable-query-mode-custom");
    expect(editorText(wrapper)).toContain(`"env" = 'staging' OR "job" = 'job-eu-west'`);

    await click(wrapper, "dashboard-variable-query-language-promql");
    expect(editorText(wrapper)).toBe("");
    wrapper.unmount();
  });

  it("brings a blocked Save's filter message into view", async () => {
    const wrapper = await mountWithOrFilters();
    await click(wrapper, "dashboard-variable-query-language-promql");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(updateVariable).not.toHaveBeenCalled();
    const issues = wrapper.find('[data-test="dashboard-variable-filter-builder-issues"]');
    expect(scrollIntoView.mock.contexts).toContain(issues.element);
    wrapper.unmount();
  });

  it("shows a custom query's loop under the query and brings it into view on Save", async () => {
    const wrapper = await mountForm(selfLoop);
    const vm = wrapper.vm as any;
    await vm.onSubmit(vm.variableData);
    await flushPromises();

    const error = wrapper.find('[data-test="dashboard-variable-query-cycle-error"]');
    expect(error.text()).toBe("svc can't depend on itself.");
    const preview = wrapper.find('[data-test="dashboard-variable-query-preview"]').element;
    expect(error.element.compareDocumentPosition(preview)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(scrollIntoView.mock.contexts).toContain(error.element);
    expect(updateVariable).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("clears a custom query's loop message once the query no longer uses the variable", async () => {
    const wrapper = await mountForm(selfLoop);
    const vm = wrapper.vm as any;
    await vm.onSubmit(vm.variableData);
    await flushPromises();
    expect(vm.filterCycleError).toBe("svc can't depend on itself.");

    vm.setFormField("query_data.query", `SELECT service FROM "app" WHERE service = '$svc' OR 1=1`);
    await flushPromises();
    expect(vm.filterCycleError).toBe("svc can't depend on itself.");

    vm.setFormField("query_data.query", `SELECT DISTINCT service FROM "app"`);
    await flushPromises();
    expect(vm.filterCycleError).toBe("");
    expect(wrapper.find('[data-test="dashboard-variable-query-cycle-error"]').isVisible()).toBe(
      false,
    );
    wrapper.unmount();
  });
});
