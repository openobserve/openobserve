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
import { defineComponent } from "vue";
import { createStore } from "vuex";
import i18n from "@/locales";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { qLayoutInjections } from "@/test/unit/helpers/layout-injections";
import { makeAddSettingVariableSchema } from "./AddSettingVariable.schema";

const { labelValues, streamMock, routeQuery, echoOnMount, liveText } = vi.hoisted(() => ({
  labelValues: vi.fn(),
  streamMock: vi.fn(),
  routeQuery: { value: {} as Record<string, unknown> },
  echoOnMount: { value: null as string | null },
  liveText: { value: null as string | null },
}));

vi.mock("@/services/metrics", () => ({ default: { labelValues, labels: vi.fn() } }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: streamMock,
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: routeQuery.value }) }));
vi.mock("@/components/QueryEditor.vue", () => ({
  default: {
    name: "UnifiedQueryEditor",
    props: ["query", "languages", "defaultLanguage"],
    emits: ["update:query", "run-query", "user-edit"],
    template: '<textarea data-test="query-editor-stub" :value="query"></textarea>',
    mounted(this: any) {
      if (echoOnMount.value !== null) this.$emit("update:query", echoOnMount.value);
    },
    methods: {
      getValue(this: any) {
        return liveText.value ?? this.query;
      },
    },
  },
}));

import QueryVariableEditor from "./QueryVariableEditor.vue";

const store = createStore({
  state: { theme: "light", selectedOrganization: { identifier: "org" } },
});

const mountEditor = (queryData: Record<string, unknown>, variablesList: any[] = []) => {
  const Harness = defineComponent({
    components: { OForm, QueryVariableEditor },
    setup() {
      const form = useOForm<any>({
        defaultValues: {
          name: "namespace",
          type: "query_values",
          query_data: {
            stream_type: "logs",
            stream: "",
            field: "",
            filter: [],
            custom_query: true,
            query_type: "sql",
            query: "",
            value_field: "",
            label_field: "",
            max_record_size: null,
            ...queryData,
          },
        },
        schema: makeAddSettingVariableSchema(i18n.global.t),
        onSubmit: vi.fn(),
      });
      return { form, variablesList };
    },
    template: `
      <OForm :form="form" id="qv-form">
        <QueryVariableEditor :dashboard-variables-list="variablesList" />
      </OForm>
    `,
  });
  return mount(Harness, {
    global: { plugins: [i18n, store], provide: qLayoutInjections() },
    attachTo: document.body,
  });
};

const formOf = (wrapper: any) => (wrapper.findComponent(OForm).vm as any).form;

const runPreview = async (wrapper: any) => {
  await wrapper.find('[data-test="dashboard-variable-query-run-preview"]').trigger("click");
  await flushPromises();
};

// Replays a finished search stream with the given rows, or a stream error.
const streamRespondsWith = (rows: Record<string, unknown>[] | { error: string }) => {
  streamMock.mockImplementation((payload: any, handlers: any) => {
    if ("error" in rows) {
      handlers.data(payload, { type: "error", content: { message: rows.error } });
      return;
    }
    handlers.data(payload, { type: "search_response_hits", content: { results: { hits: rows } } });
    handlers.data(payload, { type: "end" });
  });
};

describe("QueryVariableEditor", () => {
  beforeEach(() => {
    labelValues.mockReset();
    streamMock.mockReset();
    routeQuery.value = { period: "1h", "var-cluster": "prod" };
    echoOnMount.value = null;
    liveText.value = null;
  });

  it("previews the text just typed even before the editor commits it", async () => {
    labelValues.mockResolvedValue({ data: { status: "success", data: ["api"] } });
    const wrapper = mountEditor({ stream_type: "metrics", query_type: "promql", query: "" });
    await flushPromises();
    const editor = wrapper.findComponent({ name: "UnifiedQueryEditor" });
    liveText.value = "label_values(up, job)";
    editor.vm.$emit("user-edit");
    await runPreview(wrapper);
    expect(labelValues).toHaveBeenCalledWith(
      expect.objectContaining({ label: "job", match: "up" }),
    );
    expect(formOf(wrapper).state.values.query_data.query).toBe("label_values(up, job)");
    wrapper.unmount();
  });

  it("keeps a prefilled query when the editor echoes an empty model while mounting", async () => {
    echoOnMount.value = "";
    const wrapper = mountEditor({ query: 'SELECT DISTINCT "host" FROM "default"' });
    await flushPromises();
    expect(formOf(wrapper).state.values.query_data.query).toBe(
      'SELECT DISTINCT "host" FROM "default"',
    );
    wrapper.unmount();
  });

  it("lets the user clear the query once they have typed in it", async () => {
    const wrapper = mountEditor({ query: "SELECT 1" });
    await flushPromises();
    const editor = wrapper.findComponent({ name: "UnifiedQueryEditor" });
    editor.vm.$emit("user-edit");
    editor.vm.$emit("update:query", "");
    await flushPromises();
    expect(formOf(wrapper).state.values.query_data.query).toBe("");
    wrapper.unmount();
  });

  it("writes the edited query into the form", async () => {
    const wrapper = mountEditor({});
    await flushPromises();
    wrapper.findComponent({ name: "UnifiedQueryEditor" }).vm.$emit("update:query", "SELECT 1");
    await flushPromises();
    expect(formOf(wrapper).state.values.query_data.query).toBe("SELECT 1");
    wrapper.unmount();
  });

  it("shows the required error under the editor after a submit without a query", async () => {
    const wrapper = mountEditor({});
    await flushPromises();
    await formOf(wrapper).handleSubmit();
    await flushPromises();
    expect(wrapper.find('[data-test="dashboard-variable-query-error"]').text()).toBe(
      "Query is required",
    );
    wrapper.unmount();
  });

  it("previews PromQL label values with the parent value substituted", async () => {
    labelValues.mockResolvedValue({
      data: { status: "success", data: ["default", "kube-system"] },
    });
    const wrapper = mountEditor(
      { query_type: "promql", query: 'label_values(kube_pod_info{cluster="$cluster"}, namespace)' },
      [{ name: "cluster", type: "custom", options: [] }],
    );
    await flushPromises();
    expect(wrapper.find('[data-test="dashboard-variable-query-parent-cluster"]').text()).toBe(
      "$cluster = prod",
    );

    await runPreview(wrapper);

    expect(labelValues).toHaveBeenCalledWith(
      expect.objectContaining({ label: "namespace", match: 'kube_pod_info{cluster="prod"}' }),
    );
    const chips = wrapper.find('[data-test="dashboard-variable-query-preview-values"]');
    expect(chips.text()).toContain("default");
    expect(chips.text()).toContain("kube-system");
    expect(wrapper.find('[data-test="dashboard-variable-query-preview-count"]').text()).toBe(
      "2 values",
    );
    wrapper.unmount();
  });

  it("previews SQL rows in a table and defaults the value column to the first column", async () => {
    streamRespondsWith([
      { service: "checkout", errors: 4 },
      { service: "cart", errors: 2 },
    ]);
    const wrapper = mountEditor({ query: "SELECT service, count(*) errors FROM logs GROUP BY 1" });
    await flushPromises();

    await runPreview(wrapper);

    expect(streamMock.mock.calls[0][0].pageType).toBe("logs");
    expect(streamMock.mock.calls[0][0].queryReq.query.size).toBe(11);
    expect(wrapper.find('[data-test="dashboard-variable-query-preview-table"]').text()).toContain(
      "checkout",
    );
    expect(formOf(wrapper).state.values.query_data.value_field).toBe("service");
    wrapper.unmount();
  });

  it("flags a capped preview", async () => {
    streamRespondsWith([{ v: "a" }, { v: "b" }, { v: "c" }]);
    const wrapper = mountEditor({ query: "SELECT v FROM t", max_record_size: 2 });
    await flushPromises();
    await runPreview(wrapper);
    expect(wrapper.find('[data-test="dashboard-variable-query-preview-capped"]').text()).toContain(
      "Capped at 2",
    );
    wrapper.unmount();
  });

  it("shows the empty state when the query returns no rows", async () => {
    streamRespondsWith([]);
    const wrapper = mountEditor({ query: "SELECT v FROM t" });
    await flushPromises();
    await runPreview(wrapper);
    expect(wrapper.find('[data-test="dashboard-variable-query-preview-empty"]').exists()).toBe(
      true,
    );
    wrapper.unmount();
  });

  it("clears the preview when the form switches the query language", async () => {
    streamRespondsWith([]);
    const wrapper = mountEditor({ stream_type: "metrics", query: "SELECT v FROM t" });
    await flushPromises();
    await runPreview(wrapper);
    expect(wrapper.find('[data-test="dashboard-variable-query-preview-empty"]').exists()).toBe(
      true,
    );
    formOf(wrapper).setFieldValue("query_data.query_type", "promql");
    await flushPromises();
    expect(wrapper.find('[data-test="dashboard-variable-query-preview-idle"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dashboard-variable-query-functions-trigger"]').exists()).toBe(
      true,
    );
    wrapper.unmount();
  });

  it("shows the failure inline", async () => {
    streamRespondsWith({ error: "column v not found" });
    const wrapper = mountEditor({ query: "SELECT v FROM t" });
    await flushPromises();
    await runPreview(wrapper);
    expect(wrapper.find('[data-test="dashboard-variable-query-preview-error"]').text()).toContain(
      "column v not found",
    );
    wrapper.unmount();
  });

  it("clears the value and label columns once a preview fails", async () => {
    streamRespondsWith([{ service_id: "svc-0", service_name: "checkout" }]);
    const wrapper = mountEditor({
      query: "SELECT service_id, service_name FROM logs",
      label_field: "service_name",
    });
    await flushPromises();
    await runPreview(wrapper);
    expect(formOf(wrapper).state.values.query_data.value_field).toBe("service_id");

    streamRespondsWith({ error: "No field named service_idd" });
    await runPreview(wrapper);

    expect(formOf(wrapper).state.values.query_data.value_field).toBe("");
    expect(formOf(wrapper).state.values.query_data.label_field).toBe("");
    wrapper.unmount();
  });

  it("warns about variables the dashboard does not define", async () => {
    const wrapper = mountEditor(
      { query_type: "promql", query: 'label_values(up{job="$job", cluster="$cluster"}, pod)' },
      [{ name: "cluster", type: "custom", options: [] }],
    );
    await flushPromises();
    const warning = wrapper.find('[data-test="dashboard-variable-query-undefined-variables"]');
    expect(warning.text()).toContain("$job");
    expect(warning.text()).not.toContain("$cluster");
    expect(warning.text()).toContain("sent to the query as written");
    expect(warning.text()).not.toContain("may return nothing");
    wrapper.unmount();
  });

  it("inserts PromQL templates that reference no undefined variables", async () => {
    const wrapper = mountEditor({ query_type: "promql" });
    await flushPromises();
    await wrapper.find('[data-test="dashboard-variable-query-functions-trigger"]').trigger("click");
    await flushPromises();
    const inserts = document.querySelectorAll(
      '[data-test^="dashboard-variable-query-function-insert-"]',
    );
    expect(inserts.length).toBe(5);
    for (const button of Array.from(inserts)) {
      (button as HTMLElement).click();
      await flushPromises();
      expect(formOf(wrapper).state.values.query_data.query).not.toContain("$");
      await wrapper
        .find('[data-test="dashboard-variable-query-functions-trigger"]')
        .trigger("click");
      await flushPromises();
    }
    expect(
      wrapper.find('[data-test="dashboard-variable-query-undefined-variables"]').exists(),
    ).toBe(false);
    wrapper.unmount();
  });
});
