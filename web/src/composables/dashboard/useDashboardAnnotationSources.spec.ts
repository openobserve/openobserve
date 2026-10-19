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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, ref, type Ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import type { AnnotationSource } from "@/ts/interfaces/dashboard";
import { ANNOTATION_SOURCE_ROW_LIMIT } from "@/utils/dashboard/annotationSources";

vi.mock("@/services/search", () => ({
  default: { search: vi.fn() },
}));

import searchService from "@/services/search";
import {
  DASHBOARD_ANNOTATION_SOURCES_KEY,
  useDashboardAnnotationSources,
  usePanelAnnotationSources,
  type AnnotationQueryVariable,
  type AnnotationTimeRange,
  type DashboardAnnotationSources,
} from "./useDashboardAnnotationSources";

const search = vi.mocked(searchService.search);

const store = {
  state: {
    selectedOrganization: { identifier: "org1" },
    organizationData: { organizationSettings: { scrape_interval: 15 } },
  },
};

const START = 1_700_000_000_000_000;
const END = 1_700_003_600_000_000;
const range = (): AnnotationTimeRange => ({
  start_time: new Date(START),
  end_time: new Date(END),
});

const deploys: AnnotationSource = {
  id: "deploys",
  name: "Deploys",
  color: "#34d399",
  enabled: true,
  mode: "builder",
  streamType: "logs",
  stream: "k8s_events",
  filters: {
    filterType: "group",
    logicalOperator: "AND",
    conditions: [
      {
        filterType: "condition",
        column: "env",
        operator: "=",
        value: "$env",
        logicalOperator: "AND",
      },
    ],
  },
  title: "{service}",
};

const incidents: AnnotationSource = {
  id: "incidents",
  name: "Incidents",
  color: "#f87171",
  enabled: true,
  mode: "sql",
  streamType: "logs",
  stream: "",
  filters: { filterType: "group", logicalOperator: "AND", conditions: [] },
  query: "SELECT _timestamp, title FROM incidents",
  title: "{title}",
  panels: ["p2"],
};

const PANELS = [
  { id: "p1", type: "line" },
  { id: "p2", type: "area" },
  { id: "p3", type: "bar" },
  { id: "p4", type: "table" },
  { id: "p5", type: "line" },
];

const PanelProbe = defineComponent({
  props: { panelId: { type: String, required: true }, panelType: { type: String, required: true } },
  setup(props) {
    const { markers, failedSources, truncatedSources } = usePanelAnnotationSources(
      () => props.panelId,
      () => props.panelType,
    );
    return () =>
      h("div", {
        "data-test": `probe-${props.panelId}`,
        "data-markers": markers.value.map((marker) => marker.title).join(","),
        "data-failed": failedSources.value.join(","),
        "data-truncated": truncatedSources.value.join(","),
      });
  },
});

interface HarnessOptions {
  dashboard: Ref<{
    dashboardId: string;
    annotationSources: AnnotationSource[];
    variables?: object;
  }>;
  timeRange: Ref<AnnotationTimeRange>;
  variables: Ref<AnnotationQueryVariable[]>;
  schemaFields?: (_stream: string, _streamType: string) => Promise<string[]>;
}

const mountDashboard = ({ dashboard, timeRange, variables, schemaFields }: HarnessOptions) => {
  let api: DashboardAnnotationSources | null = null;
  const Dashboard = defineComponent({
    setup() {
      api = useDashboardAnnotationSources({
        dashboardData: () => dashboard.value,
        timeRange: () => timeRange.value,
        variables: () => variables.value,
        store,
        schemaFields,
      });
      provide(DASHBOARD_ANNOTATION_SOURCES_KEY, api);
      return () =>
        h(
          "div",
          PANELS.map((panel) =>
            h(PanelProbe, { key: panel.id, panelId: panel.id, panelType: panel.type }),
          ),
        );
    },
  });
  const wrapper = mount(Dashboard);
  return { wrapper, api: () => api as unknown as DashboardAnnotationSources };
};

const hitsFor = (sql: string) =>
  sql.includes("incidents")
    ? [{ _timestamp: START + 10, title: "db outage" }]
    : [
        { _timestamp: START + 1, service: "checkout" },
        { _timestamp: START + 2, service: "cart" },
      ];

describe("useDashboardAnnotationSources", () => {
  let dashboard: HarnessOptions["dashboard"];
  let timeRange: HarnessOptions["timeRange"];
  let variables: HarnessOptions["variables"];

  beforeEach(() => {
    search.mockReset();
    search.mockImplementation(async (args: { query: { query: { sql: string } } }) => ({
      data: { hits: hitsFor(args.query.query.sql) },
    }));
    dashboard = ref({
      dashboardId: "d1",
      annotationSources: [deploys, incidents],
      variables: { list: [{ name: "env", scope: "global" }] },
    });
    timeRange = ref(range());
    variables = ref([
      { name: "env", value: "prod", type: "custom", isVariablePartialLoaded: true },
    ]);
  });

  it("runs one query per enabled source no matter how many panels render", async () => {
    const { wrapper } = mountDashboard({ dashboard, timeRange, variables });
    await flushPromises();

    expect(search).toHaveBeenCalledTimes(2);
    expect(wrapper.findAllComponents(PanelProbe)).toHaveLength(PANELS.length);
  });

  it("sends the global window, the row cap and the substituted variable", async () => {
    mountDashboard({ dashboard, timeRange, variables });
    await flushPromises();

    const builderCall = search.mock.calls.find(([args]) =>
      args.query.query.sql.includes("k8s_events"),
    )?.[0];
    expect(builderCall).toMatchObject({
      org_identifier: "org1",
      page_type: "logs",
      dashboard_id: "d1",
      query: { query: { start_time: START, end_time: END, from: 0, size: 500 } },
    });
    expect(builderCall?.query.query.sql).toBe(
      `SELECT _timestamp, service\nFROM k8s_events\nWHERE env = 'prod'\nORDER BY _timestamp DESC`,
    );
    expect(search.mock.calls[0][1]).toBe("dashboards");
  });

  it("hands each panel only the markers aimed at it", async () => {
    const { wrapper } = mountDashboard({ dashboard, timeRange, variables });
    await flushPromises();

    const markersOf = (id: string) =>
      wrapper.find(`[data-test="probe-${id}"]`).attributes("data-markers");
    expect(markersOf("p1")).toBe("checkout,cart");
    expect(markersOf("p2")).toBe("checkout,cart,db outage");
    expect(markersOf("p4")).toBe("");
  });

  it("re-runs on a new time window and on a changed variable, but not on an unrelated one", async () => {
    mountDashboard({ dashboard, timeRange, variables });
    await flushPromises();
    expect(search).toHaveBeenCalledTimes(2);

    timeRange.value = range();
    await flushPromises();
    expect(search).toHaveBeenCalledTimes(4);

    variables.value = [
      { name: "env", value: "staging", type: "custom", isVariablePartialLoaded: true },
      { name: "other", value: "x", type: "custom", isVariablePartialLoaded: true },
    ];
    await flushPromises();
    expect(search).toHaveBeenCalledTimes(6);

    variables.value = [
      { name: "env", value: "staging", type: "custom", isVariablePartialLoaded: true },
      { name: "other", value: "y", type: "custom", isVariablePartialLoaded: true },
    ];
    await flushPromises();
    expect(search).toHaveBeenCalledTimes(6);
  });

  it("does not select a template field the schema lacks, and still draws its markers", async () => {
    dashboard.value = {
      ...dashboard.value,
      annotationSources: [{ ...deploys, title: "Deploy {ver}" }],
    };
    const schemaFields = vi.fn(async () => ["_timestamp", "service", "env"]);
    const { wrapper } = mountDashboard({ dashboard, timeRange, variables, schemaFields });
    await flushPromises();

    expect(schemaFields).toHaveBeenCalledWith("k8s_events", "logs");
    expect(search.mock.calls[0][0].query.query.sql).toBe(
      `SELECT _timestamp\nFROM k8s_events\nWHERE env = 'prod'\nORDER BY _timestamp DESC`,
    );

    expect(wrapper.find('[data-test="probe-p1"]').attributes("data-markers")).toBe("Deploy,Deploy");
  });

  it("skips disabled sources", async () => {
    dashboard.value = { ...dashboard.value, annotationSources: [{ ...deploys, enabled: false }] };
    mountDashboard({ dashboard, timeRange, variables });
    await flushPromises();
    expect(search).not.toHaveBeenCalled();
  });

  it("keeps loading true until every source settles, so a report waits for its markers", async () => {
    let release: () => void = () => undefined;
    search.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: { hits: [] } });
        }) as never,
    );
    dashboard.value = { ...dashboard.value, annotationSources: [deploys] };
    const { api } = mountDashboard({ dashboard, timeRange, variables });
    await flushPromises();
    expect(api().loading.value).toBe(true);

    release();
    await flushPromises();
    expect(api().loading.value).toBe(false);
  });

  it("waits, still loading, while a variable the query reads has not loaded", async () => {
    variables.value = [
      { name: "env", value: null, type: "query_values", isVariablePartialLoaded: false },
    ];
    const { api } = mountDashboard({ dashboard, timeRange, variables });
    await flushPromises();
    expect(search).toHaveBeenCalledTimes(1);
    expect(api().loading.value).toBe(true);

    variables.value = [
      { name: "env", value: "prod", type: "query_values", isVariablePartialLoaded: true },
    ];
    await flushPromises();
    expect(search).toHaveBeenCalledTimes(3);
    expect(api().loading.value).toBe(false);
  });

  it("stops waiting and reports the source failed if its variable never commits", async () => {
    vi.useFakeTimers();
    try {
      variables.value = [
        { name: "env", value: null, type: "query_values", isVariablePartialLoaded: false },
      ];
      const { wrapper, api } = mountDashboard({ dashboard, timeRange, variables });
      await vi.advanceTimersByTimeAsync(0);
      expect(api().loading.value).toBe(true);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(api().loading.value).toBe(false);
      expect(wrapper.find('[data-test="probe-p1"]').attributes("data-failed")).toBe("Deploys");
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a failed source on its panels and still draws the others", async () => {
    search.mockImplementation(async (args: { query: { query: { sql: string } } }) => {
      if (args.query.query.sql.includes("incidents")) throw new Error("boom");
      return { data: { hits: hitsFor(args.query.query.sql) } };
    });
    const { wrapper, api } = mountDashboard({ dashboard, timeRange, variables });
    await flushPromises();

    const probe = wrapper.find('[data-test="probe-p2"]');
    expect(probe.attributes("data-failed")).toBe("Incidents");
    expect(probe.attributes("data-markers")).toBe("checkout,cart");
    expect(wrapper.find('[data-test="probe-p1"]').attributes("data-failed")).toBe("");
    expect(api().loading.value).toBe(false);
  });

  it("marks a source truncated on its panels when it returns exactly the row cap", async () => {
    const cappedHits = Array.from({ length: ANNOTATION_SOURCE_ROW_LIMIT }, (_, index) => ({
      _timestamp: START + index,
      service: `svc-${index}`,
    }));
    search.mockImplementation(async (args: { query: { query: { sql: string } } }) =>
      args.query.query.sql.includes("incidents")
        ? { data: { hits: hitsFor(args.query.query.sql) } }
        : { data: { hits: cappedHits } },
    );
    const { wrapper } = mountDashboard({ dashboard, timeRange, variables });
    await flushPromises();

    expect(wrapper.find('[data-test="probe-p1"]').attributes("data-truncated")).toBe("Deploys");
    expect(wrapper.find('[data-test="probe-p2"]').attributes("data-truncated")).toBe("Deploys");
  });

  it("discards a stale run's result when it resolves after a newer run already landed", async () => {
    dashboard.value = {
      dashboardId: "d1",
      annotationSources: [deploys],
      variables: { list: [{ name: "env", scope: "global" }] },
    };
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    let calls = 0;
    search.mockImplementation(
      () =>
        new Promise((resolve) => {
          calls += 1;
          if (calls === 1) resolveFirst = resolve;
          else resolveSecond = resolve;
        }),
    );
    const { wrapper } = mountDashboard({ dashboard, timeRange, variables });
    await flushPromises();

    timeRange.value = range();
    await flushPromises();
    expect(calls).toBe(2);

    // The newer (second) run resolves first; the stale (first) run resolves after.
    resolveSecond({ data: { hits: [{ _timestamp: START + 1, service: "current" }] } });
    await flushPromises();
    resolveFirst({ data: { hits: [{ _timestamp: START + 1, service: "stale" }] } });
    await flushPromises();

    expect(wrapper.find('[data-test="probe-p1"]').attributes("data-markers")).toBe("current");
  });

  it("aborts the in-flight request when the composable unmounts", async () => {
    let capturedSignal: AbortSignal | undefined;
    search.mockImplementation((args: { signal?: AbortSignal }) => {
      capturedSignal = args.signal;
      return new Promise(() => undefined);
    });
    const { wrapper } = mountDashboard({ dashboard, timeRange, variables });
    await flushPromises();

    expect(capturedSignal?.aborted).toBe(false);
    wrapper.unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("gives a panel outside any dashboard no markers", () => {
    const wrapper = mount(PanelProbe, { props: { panelId: "p1", panelType: "line" } });
    expect(wrapper.attributes("data-markers")).toBe("");
  });
});
