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
import { b64DecodeUnicode } from "@/utils/zincutils";
import { qLayoutInjections } from "@/test/unit/helpers/layout-injections";
import { useVariablesManager } from "@/composables/dashboard/useVariablesManager";
import {
  QUERY_VARIABLE_NO_VALUES,
  resolveQueryVariableValue,
} from "@/utils/dashboard/variables/queryVariableUtils";

const { labelValues, streamMock } = vi.hoisted(() => ({
  labelValues: vi.fn(),
  streamMock: vi.fn(),
}));

vi.mock("@/services/metrics", () => ({ default: { labelValues, labels: vi.fn() } }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: streamMock,
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

import VariablesValueSelector from "./VariablesValueSelector.vue";

const store = createStore({
  state: {
    theme: "light",
    selectedOrganization: { identifier: "org" },
    zoConfig: { timestamp_column: "_timestamp" },
  },
});

const selectedTimeDate = {
  start_time: new Date(1_700_000_000_000),
  end_time: new Date(1_700_003_600_000),
};

const regionVariable = {
  name: "region",
  type: "custom",
  options: [{ label: "EU", value: "eu", selected: true }],
  multiSelect: false,
};

const sqlServiceVariable = {
  name: "service",
  label: "Service",
  type: "query",
  multiSelect: false,
  query_data: {
    query_type: "sql",
    stream_type: "logs",
    query: "SELECT svc, display FROM logs WHERE region = '$region'",
    value_field: "svc",
    label_field: "display",
    max_record_size: 5,
  },
};

const sentSql = () => b64DecodeUnicode(streamMock.mock.calls.at(-1)[0].queryReq.query.sql);

const streamReturns = (rows: Record<string, unknown>[]) =>
  streamMock.mockImplementation((payload: any, handlers: any) => {
    handlers.data(payload, { type: "search_response_hits", content: { results: { hits: rows } } });
    handlers.data(payload, { type: "end" });
  });

const streamFails = (message: string) =>
  streamMock.mockImplementation((payload: any, handlers: any) => {
    handlers.data(payload, { type: "error", content: { message } });
  });

const mountSelector = (props: Record<string, unknown>) =>
  mount(VariablesValueSelector, {
    props: { selectedTimeDate, ...props },
    global: { plugins: [i18n, store], provide: qLayoutInjections() },
    attachTo: document.body,
  });

const findVariable = (wrapper: any, name: string) =>
  wrapper.vm.variablesData.values.find((v: any) => v.name === name);

describe("VariablesValueSelector — query variables", () => {
  beforeEach(() => {
    streamMock.mockReset();
    labelValues.mockReset();
  });

  it("runs the SQL with the parent value and shows the label of the selected option", async () => {
    streamReturns([
      { svc: "checkout", display: "Checkout" },
      { svc: "cart", display: "Cart" },
      { svc: "checkout", display: "Checkout (dup)" },
    ]);
    const wrapper = mountSelector({
      variablesConfig: { list: [regionVariable, sqlServiceVariable] },
      initialVariableValues: { value: {} },
    });
    await flushPromises();

    expect(sentSql()).toBe("SELECT svc, display FROM logs WHERE region = 'eu'");
    const service = findVariable(wrapper, "service");
    expect(service.options).toEqual([
      { label: "Checkout", value: "checkout" },
      { label: "Cart", value: "cart" },
    ]);
    expect(service.value).toBe("checkout");
    expect(wrapper.find('[data-test="variable-selector-service-inner-value"]').text()).toBe(
      "Checkout",
    );
    wrapper.unmount();
  });

  it("keeps the last good options and shows an error indicator when a reload fails", async () => {
    streamReturns([{ svc: "checkout", display: "Checkout" }]);
    const wrapper = mountSelector({
      variablesConfig: { list: [regionVariable, sqlServiceVariable] },
      initialVariableValues: { value: {} },
    });
    await flushPromises();
    const service = findVariable(wrapper, "service");

    streamFails("table logs not found");
    await (wrapper.vm as any).loadVariableOptions(service);
    await flushPromises();

    expect(service.options).toEqual([{ label: "Checkout", value: "checkout" }]);
    expect(service.value).toBe("checkout");
    expect(service.isLoading).toBe(false);
    expect(service.isVariablePartialLoaded).toBe(true);
    expect(service.queryError).toBe("table logs not found");
    const error = wrapper.find('[data-test="variable-query-error-service"]');
    expect(error.exists()).toBe(true);
    expect(error.classes()).toEqual(expect.arrayContaining(["w-0", "min-w-full"]));
    wrapper.unmount();
  });

  it("shows the capped hint when the query has more rows than max records", async () => {
    streamReturns([{ svc: "a" }, { svc: "b" }, { svc: "c" }]);
    const wrapper = mountSelector({
      variablesConfig: {
        list: [
          regionVariable,
          {
            ...sqlServiceVariable,
            query_data: { ...sqlServiceVariable.query_data, max_record_size: 2 },
          },
        ],
      },
      initialVariableValues: { value: {} },
    });
    await flushPromises();
    expect(findVariable(wrapper, "service").options).toHaveLength(2);
    expect(wrapper.find('[data-test="variable-query-capped-service"]').exists()).toBe(true);
    wrapper.unmount();
  });

  describe("with the variables manager", () => {
    const promNamespace = {
      name: "namespace",
      type: "query",
      scope: "global",
      multiSelect: false,
      query_data: {
        query_type: "promql",
        query: 'label_values(kube_pod_info{region="$region"}, namespace)',
      },
    };

    const mountWithManager = async () => {
      const manager = useVariablesManager(i18n.global.t);
      await manager.initialize([{ ...regionVariable, scope: "global" }, promNamespace] as any, {
        tabs: [],
      });
      const wrapper = mountSelector({ variablesManager: manager, scope: "global" });
      await flushPromises();
      await flushPromises();
      return { manager, wrapper };
    };

    it("treats a query variable as loading until its values arrive, then releases panels", async () => {
      let resolveValues!: (value: unknown) => void;
      labelValues.mockReturnValue(new Promise((resolve) => (resolveValues = resolve)));
      const { manager, wrapper } = await mountWithManager();

      expect(manager.isLoading.value).toBe(true);
      expect(labelValues).toHaveBeenCalledWith(
        expect.objectContaining({ label: "namespace", match: 'kube_pod_info{region="eu"}' }),
      );

      resolveValues({ data: { status: "success", data: ["default", "monitoring"] } });
      await flushPromises();

      const namespace = manager.getVariable("namespace", "global")!;
      expect(namespace.value).toBe("default");
      expect(manager.isLoading.value).toBe(false);
      wrapper.unmount();
    });

    const mountWith = async (variables: any[], query: Record<string, string> = {}) => {
      const manager = useVariablesManager(i18n.global.t);
      await manager.initialize(variables, { tabs: [] });
      manager.loadFromUrl({ query });
      manager.commitAll();
      const wrapper = mountSelector({ variablesManager: manager, scope: "global" });
      await flushPromises();
      await flushPromises();
      return { manager, wrapper };
    };
    const promValues = (values: string[]) => ({ data: { status: "success", data: values } });

    it("reloads on a new time range and drops a value the range no longer has", async () => {
      labelValues.mockResolvedValue(promValues(["default", "monitoring"]));
      const { manager, wrapper } = await mountWith([
        { ...regionVariable, scope: "global" },
        promNamespace,
      ]);
      expect(manager.getVariable("namespace", "global")!.value).toBe("default");

      labelValues.mockClear();
      labelValues.mockResolvedValue(promValues([]));
      await wrapper.setProps({
        selectedTimeDate: {
          start_time: new Date(1_700_003_300_000),
          end_time: new Date(1_700_003_600_000),
        },
      });
      await flushPromises();

      expect(labelValues).toHaveBeenCalledWith(
        expect.objectContaining({ start_time: 1_700_003_300_000, end_time: 1_700_003_600_000 }),
      );
      const namespace = manager.getVariable("namespace", "global") as any;
      expect(namespace.value).toBeNull();
      expect(namespace.options).toEqual([]);
      const committed = manager.committedVariablesData.global.find(
        (v: any) => v.name === "namespace",
      );
      expect(committed?.value).toBeNull();
      wrapper.unmount();
    });

    const multiNamespace = {
      ...promNamespace,
      multiSelect: true,
      selectAllValueForMultiSelect: "all",
    };
    const moveRange = (wrapper: any, start: number) =>
      wrapper.setProps({
        selectedTimeDate: { start_time: new Date(start), end_time: new Date(start + 300_000) },
      });
    const committedNamespace = (manager: any) =>
      manager.committedVariablesData.global.find((v: any) => v.name === "namespace");

    it("commits the new list behind 'All' after an empty range, and never leaves it unfiltered", async () => {
      labelValues.mockResolvedValue(promValues([]));
      const { manager, wrapper } = await mountWith([
        { ...regionVariable, scope: "global" },
        multiNamespace,
      ]);
      manager.commitAll();
      expect(resolveQueryVariableValue(committedNamespace(manager))).toEqual([
        QUERY_VARIABLE_NO_VALUES,
      ]);
      expect(wrapper.find('[data-test="variable-selector-namespace-inner-value"]').text()).toBe(
        "(No Data Found)",
      );

      labelValues.mockResolvedValue(promValues(["default", "monitoring"]));
      await moveRange(wrapper, 1_700_002_700_000);
      await flushPromises();

      const committed = committedNamespace(manager);
      expect(committed.value).toEqual(["_o2_all_"]);
      expect(resolveQueryVariableValue(committed)).toEqual(["default", "monitoring"]);
      wrapper.unmount();
    });

    it("restores an explicit pick once a later range lists its values again", async () => {
      labelValues.mockResolvedValue(promValues(["default", "monitoring", "kube"]));
      const { manager, wrapper } = await mountWith(
        [{ ...regionVariable, scope: "global" }, multiNamespace],
        { "var-namespace": ["default", "monitoring"] as any },
      );
      const namespace = manager.getVariable("namespace", "global") as any;
      expect(namespace.value).toEqual(["default", "monitoring"]);

      labelValues.mockResolvedValue(promValues([]));
      await moveRange(wrapper, 1_700_003_300_000);
      await flushPromises();
      expect(namespace.value).toEqual(["_o2_all_"]);

      labelValues.mockResolvedValue(promValues(["monitoring", "kube"]));
      await moveRange(wrapper, 1_700_002_700_000);
      await flushPromises();
      expect(namespace.value).toEqual(["monitoring"]);

      labelValues.mockResolvedValue(promValues(["default", "monitoring", "kube"]));
      await moveRange(wrapper, 1_700_000_000_000);
      await flushPromises();
      expect(namespace.value).toEqual(["default", "monitoring"]);
      expect(committedNamespace(manager).value).toEqual(["default", "monitoring"]);
      wrapper.unmount();
    });

    it("treats a URL pick on an empty range like an in-page change, and restores it later", async () => {
      labelValues.mockResolvedValue(promValues([]));
      const { manager, wrapper } = await mountWith(
        [{ ...regionVariable, scope: "global" }, multiNamespace],
        { "var-namespace": ["default", "monitoring"] as any },
      );
      const namespace = manager.getVariable("namespace", "global") as any;
      expect(namespace.value).toEqual(["_o2_all_"]);
      expect(namespace.options).toEqual([]);
      expect(committedNamespace(manager).value).toEqual(["_o2_all_"]);

      labelValues.mockResolvedValue(promValues(["default", "monitoring", "kube"]));
      await moveRange(wrapper, 1_700_000_000_000);
      await flushPromises();
      expect(namespace.value).toEqual(["default", "monitoring"]);
      wrapper.unmount();
    });

    it("loads the options behind an 'All' default before panels may run, and keeps All", async () => {
      let resolveValues!: (value: unknown) => void;
      labelValues.mockReturnValue(new Promise((resolve) => (resolveValues = resolve)));
      const { manager, wrapper } = await mountWith([
        { ...regionVariable, scope: "global" },
        { ...promNamespace, multiSelect: true, selectAllValueForMultiSelect: "all" },
      ]);

      const namespace = manager.getVariable("namespace", "global") as any;
      expect(namespace.isVariablePartialLoaded).toBe(false);
      expect(manager.isLoading.value).toBe(true);

      resolveValues(promValues(["default", "monitoring"]));
      await flushPromises();

      expect(namespace.value).toEqual(["_o2_all_"]);
      expect(namespace.options.map((o: any) => o.value)).toEqual(["default", "monitoring"]);
      expect(namespace.isVariablePartialLoaded).toBe(true);
      expect(manager.isLoading.value).toBe(false);
      wrapper.unmount();
    });

    it("fetches a URL-restored query variable so its label shows, keeping the URL value", async () => {
      streamReturns([
        { svc: "svc-0", display: "checkout" },
        { svc: "svc-1", display: "payments" },
      ]);
      const { manager, wrapper } = await mountWith(
        [
          { ...regionVariable, scope: "global" },
          { ...sqlServiceVariable, scope: "global" },
        ],
        { "var-service": "svc-1" },
      );

      expect(streamMock).toHaveBeenCalled();
      expect(manager.getVariable("service", "global")!.value).toBe("svc-1");
      expect(wrapper.find('[data-test="variable-selector-service-inner-value"]').text()).toBe(
        "payments",
      );
      wrapper.unmount();
    });

    it("ignores saved placeholder options and states why a failing query failed", async () => {
      streamFails("Schema error: No field named service_idd");
      const { manager, wrapper } = await mountWith([
        { ...regionVariable, scope: "global" },
        {
          ...sqlServiceVariable,
          scope: "global",
          options: [{ label: "", value: "", selected: true }],
        },
      ]);

      expect((manager.getVariable("service", "global") as any).options).toEqual([]);
      expect(wrapper.find('[data-test="variable-query-error-service"]').text()).toContain(
        "No field named service_idd",
      );
      wrapper.unmount();
    });

    it("never holds panels when the query fails", async () => {
      labelValues.mockRejectedValue({ response: { data: { message: "bad matcher" } } });
      const { manager, wrapper } = await mountWithManager();

      const namespace = manager.getVariable("namespace", "global") as any;
      expect(namespace.queryError).toBe("bad matcher");
      expect(namespace.isVariablePartialLoaded).toBe(true);
      expect(manager.isLoading.value).toBe(false);
      wrapper.unmount();
    });
  });
});
