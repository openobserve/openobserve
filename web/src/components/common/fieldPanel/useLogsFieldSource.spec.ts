// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { searchState } from "@/composables/useLogs/searchState";
import { useStreamFields } from "@/composables/useLogs/useStreamFields";
import { useHideInternalStreams } from "@/composables/useHideInternalStreams";
import { b64DecodeUnicode } from "@/utils/zincutils";
import { LOGS_FIELD_VALUES_PARITY } from "@/test/unit/mockData/logsFieldValuesParity";
import useLogsFieldSource, {
  QUICK_PICK_LIMIT,
  quoteSchemaFieldsInWhere,
  type LogsFieldSource,
} from "./useLogsFieldSource";
import StreamFieldPanel from "./StreamFieldPanel.vue";
import { MISSING_VALUE_KEY } from "./valueFilterExpression";
import type { PanelField } from "./fieldPanel.types";

const sent = vi.hoisted(() => [] as Record<string, unknown>[]);
const inFlight = vi.hoisted(
  () =>
    [] as {
      payload: Record<string, unknown>;
      handlers: Record<string, (...args: unknown[]) => void>;
    }[],
);
const onStreamChangeMock = vi.hoisted(() => vi.fn());
const getStreamsMock = vi.hoisted(() => vi.fn(async () => ({ list: [] as unknown[] })));
const keyFields = vi.hoisted(() => ({ logs: { fields: ["host"], groups: [] as string[] } }));

vi.mock("@/stores", async () => ({
  default: (await import("@/test/unit/helpers/store")).default,
}));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (
      payload: { queryReq: Record<string, unknown> },
      handlers: Record<string, (...args: unknown[]) => void>,
    ) => {
      sent.push(payload.queryReq);
      inFlight.push({ payload, handlers });
    },
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

vi.mock("@/composables/useStreams", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: (...args: unknown[]) => ({ ...actual.default(...args), getStreams: getStreamsMock }),
  };
});

vi.mock("@/composables/useLogs/useSearchBar", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useSearchBar: () => ({ onStreamChange: onStreamChangeMock, handleQueryData: vi.fn() }),
  };
});

vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: () => ({
    loadSemanticGroups: async () => [],
    loadKeyFields: async () => keyFields,
    loadFieldGrouping: async () => ({ prefix_aliases: {}, group_labels: {} }),
  }),
}));

const SCHEMA = [
  { name: "_timestamp", type: "Int64" },
  { name: "service_name", type: "Utf8" },
  { name: "level", type: "Utf8" },
  { name: "method", type: "Utf8" },
];

type StreamSeed = {
  name: string;
  schema?: { name: string; type: string }[];
  settings?: Record<string, unknown>;
  removedSchemaFields?: { name: string; type: string }[];
  stats?: Record<string, number>;
  is_internal?: boolean;
};

const stream = (name: string, extra: Partial<StreamSeed> = {}): StreamSeed => ({
  name,
  schema: SCHEMA,
  settings: {},
  ...extra,
});

const field = (name: string, extra: Partial<PanelField> = {}): PanelField => ({
  name,
  dataType: "Utf8",
  ftsKey: false,
  isSchemaField: true,
  showValues: true,
  streams: ["s1"],
  ...extra,
});

const decodeSql = () => sent.map((p) => [p.stream_name, b64DecodeUnicode(String(p.sql))]);

describe("useLogsFieldSource", () => {
  const { searchObj, streamSchemaFieldsIndexMapping } = searchState();
  const zoConfig = { ...store.state.zoConfig };
  let source: LogsFieldSource;
  let extractFields: ReturnType<typeof useStreamFields>["extractFields"];
  let wrapper: ReturnType<typeof mount>;
  const onInterestingFieldChange = vi.fn();

  const seed = (streams: StreamSeed[], type = "logs") => {
    searchObj.data.stream.streamType = type;
    searchObj.data.streamResults = { list: streams } as any;
    searchObj.data.stream.streamLists = streams.map((s) => ({
      label: s.name,
      value: s.name,
      internal: s.is_internal === true,
    }));
    searchObj.data.stream.selectedStream = streams.map((s) => s.name);
    searchObj.data.stream.selectedStreamFields = SCHEMA.map((f) => ({
      ...f,
      dataType: f.type,
      ftsKey: false,
      isSchemaField: true,
      showValues: true,
      streams: streams.map((s) => s.name),
    }));
    searchObj.data.stream.missingStreamMultiStreamFilter = [];
  };

  const extract = async () => {
    await extractFields({ reuseLoadedSchema: true });
    await flushPromises();
  };

  const rowNames = () =>
    source.fields.value.map((row) => (row.isGroup ? `#${row.group}` : row.name));

  beforeEach(async () => {
    localStorage.clear();
    sent.length = 0;
    inFlight.length = 0;
    onStreamChangeMock.mockClear();
    onInterestingFieldChange.mockClear();
    store.state.zoConfig = { ...zoConfig, show_fts_field_values: false };
    searchObj.organizationIdentifier = store.state.selectedOrganization.identifier;
    searchObj.meta.sqlMode = false;
    searchObj.meta.quickMode = false;
    searchObj.meta.regions = ["us-east"];
    searchObj.meta.clusters = ["c1"];
    searchObj.meta.useUserDefinedSchemas = "user_defined_schema";
    searchObj.meta.hasUserDefinedSchemas = false;
    searchObj.meta.showDetailTab = false;
    searchObj.loadingStream = false;
    searchObj.loadingFieldGroups = false;
    searchObj.data.query = "";
    searchObj.data.filterErrMsg = "";
    searchObj.data.tempFunctionContent = "";
    searchObj.data.transformType = "function";
    searchObj.data.queryResults = { hits: [] };
    searchObj.data.stream.selectedFields = [];
    searchObj.data.stream.filterField = "";
    searchObj.data.stream.interestingFieldList = [];
    searchObj.data.stream.selectedInterestingStreamFields = [];
    searchObj.data.datetime = {
      type: "absolute",
      startTime: 1700000000000000,
      endTime: 1700003600000000,
    };
    streamSchemaFieldsIndexMapping.value = {};
    const Consumer = defineComponent({
      setup() {
        source = useLogsFieldSource({ onInterestingFieldChange });
        extractFields = useStreamFields().extractFields;
        return () => h("div");
      },
    });
    wrapper = mount(Consumer, { global: { provide: { store }, plugins: [i18n, router] } });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    searchObj.data.stream.selectedStream = [];
    searchObj.data.stream.streamLists = [];
    searchObj.data.streamResults = { list: [] } as any;
    store.state.zoConfig = zoConfig;
    vi.restoreAllMocks();
  });

  // ─── Stream picker ───────────────────────────────────────────────

  describe("stream picker", () => {
    type Option = { label: string; header?: boolean; headerCount?: string; headerAction?: string };
    const optionLabels = () =>
      (source.streams.value as unknown as Option[]).map((o) =>
        o.header ? `# ${o.label} · ${o.headerCount ?? ""} [${o.headerAction}]` : o.label,
      );
    const header = () => (source.streams.value as unknown as Option[]).find((o) => o.header)!;
    let setting: ReturnType<typeof useHideInternalStreams>;

    beforeEach(async () => {
      const Probe = defineComponent({
        setup() {
          setting = useHideInternalStreams();
          return () => h("div");
        },
      });
      mount(Probe, { global: { plugins: [store] } });
      setting.hideInternalStreams.value = false;
      seed([
        stream("_rumdata", { is_internal: true, stats: { doc_time_max: 90 } }),
        stream("default", { stats: { doc_time_max: 50 } }),
        stream("_anomalies", { is_internal: true, stats: { doc_time_max: 80 } }),
        stream("k8s_events", { stats: { doc_time_max: 40 } }),
      ]);
      searchObj.data.stream.selectedStream = [];
      await flushPromises();
    });

    it("lists user streams first and internal streams under a header with a Hide action", () => {
      expect(optionLabels()).toEqual([
        "default",
        "k8s_events",
        "# Internal streams · 2 [Hide]",
        "_rumdata",
        "_anomalies",
      ]);
    });

    it("collapses the group on the header's Hide action, announces it, and expands on Show", async () => {
      source.picker!.onHeaderAction!(header() as never);
      await flushPromises();
      expect(setting.hideInternalStreams.value).toBe(true);
      expect(optionLabels()).toEqual([
        "default",
        "k8s_events",
        "# Internal streams · 2 hidden [Show]",
      ]);
      expect(source.picker!.announcement!.value).toBe("Internal streams hidden");

      source.picker!.onHeaderAction!(header() as never);
      await flushPromises();
      expect(optionLabels()).toContain("_rumdata");
      expect(source.picker!.announcement!.value).toBe("Internal streams shown");
    });

    it("keeps a selected internal stream listed under the collapsed row", async () => {
      searchObj.data.stream.selectedStream = ["_rumdata"];
      setting.hideInternalStreams.value = true;
      await flushPromises();
      expect(optionLabels()).toEqual([
        "default",
        "k8s_events",
        "# Internal streams · 1 hidden [Show]",
        "_rumdata",
      ]);
    });

    it("counts hidden streams matching the search while open and drops the search on close", async () => {
      setting.hideInternalStreams.value = true;
      source.picker!.onOpen!();
      source.picker!.onSearch!("_r");
      await flushPromises();
      expect(header()).toMatchObject({ headerCount: "1 hidden match", keepOnSearch: true });

      source.picker!.onClose!();
      await flushPromises();
      expect(header().headerCount).toBe("2 hidden");

      source.picker!.onSearch!("_r");
      await flushPromises();
      expect(header().headerCount).toBe("2 hidden");
    });

    it("asks the picker to close when the Source Details drawer opens", async () => {
      const before = source.picker!.closeSignal!.value;
      searchObj.meta.showDetailTab = true;
      await nextTick();
      expect(source.picker!.closeSignal!.value).toBe(before + 1);
    });

    it("offers the way back to logs only while another stream type is selected", async () => {
      expect(source.showBackToLogs.value).toBe(false);
      searchObj.data.stream.streamType = "metrics";
      await nextTick();
      expect(source.showBackToLogs.value).toBe(true);
    });

    it("refreshes the stream list from the server when the picker opens, without touching the selection (F3)", async () => {
      searchObj.data.stream.selectedStream = ["default"];
      getStreamsMock.mockClear();
      getStreamsMock.mockResolvedValueOnce({
        list: [
          ...searchObj.data.streamResults.list,
          stream("created_later", { stats: { doc_time_max: 1 } }),
        ],
      });
      source.refreshStreams!();
      await flushPromises();
      expect(getStreamsMock).toHaveBeenCalledWith("logs", false, true, true);
      expect(optionLabels()).toContain("created_later");
      expect(searchObj.data.stream.selectedStream).toEqual(["default"]);
      expect(onStreamChangeMock).not.toHaveBeenCalled();
    });

    it("keeps the loaded schemas when the refreshed list carries none, but takes its settings", async () => {
      searchObj.data.stream.selectedStream = ["default"];
      const loaded = searchObj.data.streamResults.list.find(
        (entry: StreamSeed) => entry.name === "default",
      );
      loaded.removedSchemaFields = [{ name: "_original", type: "Utf8" }];
      getStreamsMock.mockResolvedValueOnce({
        list: [stream("default", { schema: [], settings: { defined_schema_fields: ["a"] } })],
      });
      source.refreshStreams!();
      await flushPromises();
      const refreshed = searchObj.data.streamResults.list.find(
        (entry: StreamSeed) => entry.name === "default",
      );
      expect(refreshed.schema).toEqual(loaded.schema);
      expect(refreshed.schema.length).toBeGreaterThan(0);
      expect(refreshed.removedSchemaFields).toEqual([{ name: "_original", type: "Utf8" }]);
      expect(refreshed.settings).toEqual({ defined_schema_fields: ["a"] });
    });

    it("keeps the loaded settings only when the refreshed entry has none", async () => {
      searchObj.data.stream.selectedStream = ["default"];
      const loaded = searchObj.data.streamResults.list.find(
        (entry: StreamSeed) => entry.name === "default",
      );
      loaded.settings = { full_text_search_keys: ["msg"] };
      getStreamsMock.mockResolvedValueOnce({
        list: [{ name: "default", schema: [] }],
      });
      source.refreshStreams!();
      await flushPromises();
      const refreshed = searchObj.data.streamResults.list.find(
        (entry: StreamSeed) => entry.name === "default",
      );
      expect(refreshed.settings).toEqual({ full_text_search_keys: ["msg"] });
    });

    it("clears the picker when the refreshed list comes back empty", async () => {
      getStreamsMock.mockResolvedValueOnce({ list: [] });
      source.refreshStreams!();
      await flushPromises();
      expect(searchObj.data.stream.streamLists).toEqual([]);
      expect(source.streams.value).toEqual([]);
    });

    it("drops a stream list that lands after the stream type moved on", async () => {
      let release: (value: unknown) => void = () => undefined;
      getStreamsMock.mockImplementationOnce(
        () => new Promise((resolve) => (release = resolve)) as never,
      );
      source.refreshStreams!();
      searchObj.data.stream.streamType = "metrics";
      release({ list: [stream("late", { stats: { doc_time_max: 1 } })] });
      await flushPromises();
      expect(optionLabels()).not.toContain("late");
    });

    it("runs the stream change exactly as the old picker did", () => {
      source.selectStreams(["default", "k8s_events"]);
      expect(searchObj.data.stream.selectedStream).toEqual(["default", "k8s_events"]);
      expect(searchObj.data.filterErrMsg).toBe("");
      expect(onStreamChangeMock).toHaveBeenCalledWith("", { origin: "selector" });
    });

    it("picks a single stream from the empty state like a dropdown selection", () => {
      source.quickSelectStream("default");
      expect(searchObj.data.stream.selectedStream).toEqual(["default"]);
      expect(onStreamChangeMock).toHaveBeenCalledWith("", { origin: "selector" });
    });

    describe("quick picks", () => {
      const labels = () =>
        source.quickPickGroups.value.flatMap((group) => [
          group.header ? `#${group.header.headerCount}` : String(group.label),
          ...group.streams.map((s) => s.value),
        ]);

      it("lists internal streams last under a header row", () => {
        expect(labels()).toEqual([
          "Recently active streams",
          "default",
          "k8s_events",
          "#2",
          "_rumdata",
          "_anomalies",
        ]);
      });

      it("collapses to the header row on Hide", async () => {
        setting.hideInternalStreams.value = true;
        await flushPromises();
        expect(labels()).toEqual(["Recently active streams", "default", "k8s_events", "#2 hidden"]);
      });

      it("fills the slots with user streams first and counts the rest", async () => {
        const users = Array.from({ length: 9 }, (_, i) =>
          stream(`app_${i}`, { stats: { doc_time_max: i } }),
        );
        seed([stream("_rumdata", { is_internal: true, stats: { doc_time_max: 100 } }), ...users]);
        searchObj.data.stream.selectedStream = [];
        await flushPromises();
        const picked = source.quickPickGroups.value.flatMap((g) => g.streams.map((s) => s.value));
        expect(picked).toHaveLength(QUICK_PICK_LIMIT);
        expect(picked).not.toContain("_rumdata");
        expect(source.quickPickMoreCount.value).toBe(2);
        expect(source.quickPickGroups.value.some((g) => g.header)).toBe(false);
      });

      it("leaves hidden streams out of the more count", async () => {
        const users = Array.from({ length: 9 }, (_, i) =>
          stream(`app_${i}`, { stats: { doc_time_max: i } }),
        );
        seed([stream("_rumdata", { is_internal: true, stats: { doc_time_max: 100 } }), ...users]);
        searchObj.data.stream.selectedStream = [];
        setting.hideInternalStreams.value = true;
        await flushPromises();
        expect(source.quickPickMoreCount.value).toBe(1);
      });
    });
  });

  describe("stream type change", () => {
    it("switches the type, reloads the list and runs the stream change for the picked stream", async () => {
      store.state.zoConfig = { ...zoConfig, query_on_stream_selection: false };
      searchObj.data.stream.streamType = "metrics";
      searchObj.data.stream.selectedStream = ["m1"];
      getStreamsMock.mockResolvedValueOnce({ list: [{ name: "app", stats: { doc_time_max: 5 } }] });
      source.backToLogs();
      await flushPromises();
      expect(searchObj.data.stream.streamType).toBe("logs");
      expect(searchObj.data.stream.selectedStream).toEqual(["app"]);
      expect(onStreamChangeMock).toHaveBeenCalledWith("", { origin: "selector" });
    });

    it("drops a delayed list that lands after a newer type switch", async () => {
      store.state.zoConfig = { ...zoConfig, query_on_stream_selection: false };
      let releaseMetrics: (value: unknown) => void = () => undefined;
      getStreamsMock.mockImplementationOnce(
        () => new Promise((resolve) => (releaseMetrics = resolve)) as never,
      );
      getStreamsMock.mockResolvedValueOnce({ list: [{ name: "t1", stats: { doc_time_max: 5 } }] });
      source.changeStreamType("metrics");
      source.changeStreamType("traces");
      await flushPromises();
      expect(searchObj.data.stream.selectedStream).toEqual(["t1"]);
      releaseMetrics({ list: [{ name: "m1", stats: { doc_time_max: 9 } }] });
      await flushPromises();
      expect(searchObj.data.stream.streamType).toBe("traces");
      expect(searchObj.data.stream.selectedStream).toEqual(["t1"]);
      expect(onStreamChangeMock).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Fields ──────────────────────────────────────────────────────

  describe("fields", () => {
    it("groups one stream by key fields, prefixes and types without semantic aliases (Q6)", async () => {
      seed([
        stream("app", {
          schema: [
            { name: "_timestamp", type: "Int64" },
            { name: "host", type: "Utf8" },
            { name: "kubernetes_pod", type: "Utf8" },
            { name: "kubernetes_ns", type: "Utf8" },
            { name: "level", type: "Utf8" },
          ],
        }),
      ]);
      await extract();
      const byName = Object.fromEntries(source.fields.value.map((row) => [row.name, row]));
      expect(byName.host.group).toBe("pinned");
      expect(byName.kubernetes_pod.group).toBe("kubernetes");
      expect(rowNames()[0]).toBe("#pinned");
      expect(source.groupingMode).toBe("semantic");
    });

    it("groups several streams into common fields, then each stream's own fields, with no empty group and no duplicate (B1, B2)", async () => {
      seed([
        stream("s1", {
          schema: [
            { name: "host", type: "Utf8" },
            { name: "a", type: "Utf8" },
            { name: "b", type: "Utf8" },
          ],
        }),
        stream("s2", {
          schema: [
            { name: "a", type: "Utf8" },
            { name: "host", type: "Utf8" },
            { name: "d", type: "Int64" },
          ],
        }),
        stream("s3", {
          schema: [
            { name: "a", type: "Utf8" },
            { name: "host", type: "Utf8" },
          ],
        }),
      ]);
      await extract();
      expect(rowNames()).toEqual(["#common", "host", "a", "#s1", "b", "#s2", "d"]);
      const common = source.fields.value.find((row) => row.name === "a");
      expect(common?.streams).toEqual(["s1", "s2", "s3"]);
      expect(source.groupingMode).toBe("common-per-stream");
      expect(source.fields.value.filter((row) => row.isGroup).map((row) => row.name)).toEqual([
        "Common fields",
        "S1",
        "S2",
      ]);
    });

    it("lists a defined schema as timestamp, the defined fields and the all-fields column, none with values", async () => {
      store.state.zoConfig = { ...zoConfig, log_page_default_field_list: "uds" };
      seed([stream("app", { settings: { defined_schema_fields: ["level"] } })]);
      await extract();
      expect(searchObj.meta.hasUserDefinedSchemas).toBe(true);
      const rows = source.fields.value.filter((row) => !row.isGroup);
      expect(rows.map((row) => row.name).sort()).toEqual(["_all", "_timestamp", "level"]);
      expect(rows.find((row) => row.name === "_timestamp")?.showValues).toBe(false);
      expect(rows.find((row) => row.name === "_all")?.showValues).toBe(false);
      expect(rows.find((row) => row.name === "level")?.showValues).toBe(true);
      expect(searchObj.data.hasSearchDataTimestampField).toBe(true);
    });

    it("forgets a defined schema once the selection moves to streams without one (F2, B5)", async () => {
      seed([stream("uds", { settings: { defined_schema_fields: ["level"] } })]);
      await extract();
      expect(searchObj.meta.hasUserDefinedSchemas).toBe(true);
      expect(source.capabilities.value.footerToggles).toContain("schema");

      seed([stream("plain_a"), stream("plain_b")]);
      await extract();
      expect(searchObj.meta.hasUserDefinedSchemas).toBe(false);
      expect(source.capabilities.value.footerToggles).not.toContain("schema");

      seed([stream("plain_a"), stream("uds", { settings: { defined_schema_fields: ["level"] } })]);
      await extract();
      expect(searchObj.meta.hasUserDefinedSchemas).toBe(true);
    });

    it("adds result-only fields from the widest hit as non-schema rows without values", async () => {
      store.state.zoConfig = { ...zoConfig, user_defined_schemas_enabled: false };
      seed([stream("app")]);
      searchObj.data.queryResults = {
        hits: [
          { _timestamp: 1, level: "info" },
          {
            _timestamp: 2,
            level: "warn",
            extra: "x",
            _o2_id: 1,
            _original: "",
            _all_values: "",
            _stream_name: "app",
          },
        ],
      };
      await extract();
      const names = source.fields.value.filter((row) => !row.isGroup).map((row) => row.name);
      expect(names).toContain("extra");
      expect(names).not.toContain("_o2_id");
      expect(names).not.toContain("_original");
      expect(names).not.toContain("_all_values");
      expect(names).not.toContain("_stream_name");
      const extra = source.fields.value.find((row) => row.name === "extra")!;
      expect(extra.isSchemaField).toBe(false);
      expect(extra.showValues).toBe(false);
      expect(searchObj.data.hasSearchDataTimestampField).toBe(true);
    });

    it("reads the full-text keys and the query range limit from the stream settings", async () => {
      seed([stream("app", { settings: { full_text_search_keys: ["level"], max_query_range: 2 } })]);
      await extract();
      expect(source.fields.value.find((row) => row.name === "level")?.ftsKey).toBe(true);
      expect(searchObj.data.datetime.queryRangeRestrictionInHour).toBe(2);
      expect(String(searchObj.data.datetime.queryRangeRestrictionMsg)).toContain("2");
    });

    it("binds the search box to the shared filter field", () => {
      source.setSearch("lev");
      expect(searchObj.data.stream.filterField).toBe("lev");
      searchObj.data.stream.filterField = "ho";
      expect(source.search.value).toBe("ho");
    });

    it("keeps collapsed groups per stream set (Q5)", async () => {
      seed([stream("s1")]);
      source.toggleGroup("pinned");
      expect(source.collapsedGroups.value.has("pinned")).toBe(true);
      searchObj.data.stream.selectedStream = ["s2"];
      await nextTick();
      expect(source.collapsedGroups.value.size).toBe(0);
      searchObj.data.stream.selectedStream = ["s1"];
      await nextTick();
      expect(source.collapsedGroups.value.has("pinned")).toBe(true);
    });

    it("shows the interesting-only list while that tab is active", async () => {
      seed([stream("app")]);
      searchObj.data.stream.selectedStreamFields = [
        { name: "Key fields", label: true, group: "pinned" },
        { name: "host", group: "pinned", isInterestingField: true, isSchemaField: true },
        { name: "String", label: true, group: "type_string" },
        { name: "level", group: "type_string", isInterestingField: false, isSchemaField: true },
      ];
      searchObj.data.stream.selectedInterestingStreamFields = [
        { name: "Key fields", label: true, group: "pinned" },
        { name: "host", group: "pinned", isInterestingField: true, isSchemaField: true },
      ];
      searchObj.meta.quickMode = true;
      store.state.zoConfig = { ...zoConfig, log_page_default_field_list: "interesting" };
      searchObj.meta.hasUserDefinedSchemas = true;
      await nextTick();
      expect(source.footerInterestingOnly!.value).toBe(true);
      expect(rowNames()).toEqual(["#pinned", "host"]);
    });
  });

  describe("loading", () => {
    it("keeps the loaded fields up while the same streams reload, and shows another stream's only once loaded", async () => {
      seed([stream("default")]);
      searchObj.data.stream.selectedStreamFields = [{ name: "level" }];
      await flushPromises();
      searchObj.loadingStream = true;
      await flushPromises();
      expect(source.loading.value).toBe(false);

      searchObj.data.stream.selectedStream = ["other"];
      await flushPromises();
      expect(source.loading.value).toBe(true);

      searchObj.data.stream.selectedStreamFields = [{ name: "msg" }];
      await flushPromises();
      expect(source.loading.value).toBe(true);

      searchObj.loadingStream = false;
      await flushPromises();
      expect(source.loading.value).toBe(false);
    });

    it("keeps the skeleton while the fields wait for their groups", async () => {
      seed([stream("cold")]);
      searchObj.data.stream.selectedStreamFields = [];
      searchObj.loadingStream = true;
      await flushPromises();
      searchObj.data.stream.selectedStreamFields = [{ name: "msg" }];
      searchObj.loadingFieldGroups = true;
      searchObj.loadingStream = false;
      await flushPromises();
      expect(source.loading.value).toBe(true);

      searchObj.loadingFieldGroups = false;
      await flushPromises();
      expect(source.loading.value).toBe(false);
    });
  });

  // ─── Columns ─────────────────────────────────────────────────────

  describe("table columns", () => {
    it("toggles a column, drops the timestamp and persists the selection per org and stream set", () => {
      seed([stream("app")]);
      searchObj.meta.isFtsDefaultColumn = true;
      source.toggleColumn(field("level"));
      expect(searchObj.data.stream.selectedFields).toEqual(["level"]);
      expect(searchObj.meta.isFtsDefaultColumn).toBe(false);
      source.toggleColumn(field("_timestamp"));
      expect(searchObj.data.stream.selectedFields).toEqual(["level"]);
      const persisted = JSON.parse(localStorage.getItem("logFilterField") ?? "{}");
      expect(persisted[`${searchObj.organizationIdentifier}_app`]).toEqual(["level"]);
      source.toggleColumn(field("level"));
      expect(searchObj.data.stream.selectedFields).toEqual([]);
      expect(source.tableColumns!.value).toEqual([]);
    });

    it("resets every column and persists the empty selection", () => {
      seed([stream("app")]);
      searchObj.data.stream.selectedFields = ["level", "method"];
      source.resetColumns!();
      expect(searchObj.data.stream.selectedFields).toEqual([]);
      const persisted = JSON.parse(localStorage.getItem("logFilterField") ?? "{}");
      expect(persisted[`${searchObj.organizationIdentifier}_app`]).toEqual([]);
    });
  });

  // ─── Interesting fields ──────────────────────────────────────────

  describe("interesting fields", () => {
    const org = () => searchObj.organizationIdentifier;
    const rows = () => searchObj.data.stream.selectedStreamFields;
    const seedRows = () => {
      seed([stream("app")]);
      searchObj.data.stream.selectedStreamFields = [
        { name: "Key fields", label: true, group: "pinned" },
        {
          name: "host",
          group: "pinned",
          isInterestingField: false,
          isSchemaField: true,
          streams: ["app"],
        },
        { name: "String", label: true, group: "type_string" },
        {
          name: "level",
          group: "type_string",
          isInterestingField: true,
          isSchemaField: true,
          streams: ["app"],
        },
      ];
      searchObj.data.stream.interestingFieldList = ["level"];
      streamSchemaFieldsIndexMapping.value = { "Key fields": 0, host: 1, String: 2, level: 3 };
    };

    it("ignores a toggle until the field index mapping exists", () => {
      seedRows();
      streamSchemaFieldsIndexMapping.value = {};
      source.toggleInteresting!(field("host", { streams: ["app"] }));
      expect(searchObj.data.stream.interestingFieldList).toEqual(["level"]);
      expect(onInterestingFieldChange).not.toHaveBeenCalled();
    });

    it("adds a field in its group's position, stores it and rewrites the SQL select list", () => {
      seedRows();
      source.toggleInteresting!(field("host", { streams: ["app"], isInterestingField: false }));
      expect(searchObj.data.stream.interestingFieldList).toEqual(["level", "host"]);
      expect(rows()[1].isInterestingField).toBe(true);
      expect(searchObj.data.stream.selectedInterestingStreamFields.map((r: any) => r.name)).toEqual(
        ["Key fields", "host", "String", "level"],
      );
      const stored = JSON.parse(localStorage.getItem("interestingFields") ?? "{}");
      expect(stored[`${org()}_app`]).toEqual(["host"]);
      expect(onInterestingFieldChange).toHaveBeenCalledWith(
        expect.objectContaining({ name: "host" }),
        false,
      );
    });

    it("never adds the star and never stores the timestamp or a default", () => {
      seedRows();
      store.state.zoConfig = { ...zoConfig, default_quick_mode_fields: ["method"] };
      source.toggleInteresting!(field("*", { streams: ["app"] }));
      expect(searchObj.data.stream.interestingFieldList).toEqual(["level"]);
      source.toggleInteresting!(field("_timestamp", { streams: ["app"] }));
      source.toggleInteresting!(field("method", { streams: ["app"] }));
      const stored = JSON.parse(localStorage.getItem("interestingFields") ?? "{}");
      expect(stored[`${org()}_app`]).toEqual([]);
      expect(searchObj.data.stream.interestingFieldList).toEqual(["level", "_timestamp", "method"]);
    });

    it("removes a field, remembers a dropped default and falls back to all fields when none remain", () => {
      seedRows();
      store.state.zoConfig = { ...zoConfig, default_quick_mode_fields: ["level"] };
      source.footerInterestingOnly!.value = true;
      source.toggleInteresting!(field("level", { streams: ["app"], isInterestingField: true }));
      expect(searchObj.data.stream.interestingFieldList).toEqual([]);
      expect(rows()[3].isInterestingField).toBe(false);
      expect(searchObj.data.stream.selectedInterestingStreamFields).toEqual([]);
      const stored = JSON.parse(localStorage.getItem("interestingFields") ?? "{}");
      expect(stored[`deselect_${org()}_app`]).toEqual(["level"]);
      expect(source.footerInterestingOnly!.value).toBe(false);
      expect(onInterestingFieldChange).toHaveBeenCalledWith(
        expect.objectContaining({ name: "level" }),
        true,
      );
    });

    it("re-adding a dropped default clears it from the deselect list", () => {
      seedRows();
      store.state.zoConfig = { ...zoConfig, default_quick_mode_fields: ["host"] };
      localStorage.setItem(
        "interestingFields",
        JSON.stringify({ [`deselect_${org()}_app`]: ["host"] }),
      );
      source.toggleInteresting!(field("host", { streams: ["app"] }));
      const stored = JSON.parse(localStorage.getItem("interestingFields") ?? "{}");
      expect(stored[`deselect_${org()}_app`]).toEqual([]);
    });
  });

  // ─── Footer ──────────────────────────────────────────────────────

  describe("footer", () => {
    it("offers the interesting action and tab in quick mode only, and the schema tabs with a defined schema only", async () => {
      expect(source.capabilities.value.actions).toEqual(["add-filter", "toggle-column"]);
      expect(source.capabilities.value.footerToggles).toEqual([]);
      searchObj.meta.quickMode = true;
      searchObj.meta.hasUserDefinedSchemas = true;
      await nextTick();
      expect(source.capabilities.value.actions).toEqual([
        "add-filter",
        "toggle-column",
        "interesting",
      ]);
      expect(source.capabilities.value.footerToggles).toEqual(["schema", "interesting"]);
      expect(source.capabilities.value).toMatchObject({
        streamPicker: "multi",
        values: true,
        drag: false,
        highlightColumns: true,
      });
    });

    it("opens the interesting tab by default in quick mode unless the config asks for the schema tab", async () => {
      store.state.zoConfig = { ...zoConfig, log_page_default_field_list: "interesting" };
      searchObj.meta.quickMode = true;
      await nextTick();
      expect(source.footerSchemaTab!.value).toBe("interesting_fields");
      expect(source.footerInterestingOnly!.value).toBe(true);

      searchObj.meta.quickMode = false;
      await nextTick();
      expect(source.footerSchemaTab!.value).toBe("user_defined_schema");
      expect(source.footerInterestingOnly!.value).toBe(false);

      store.state.zoConfig = { ...zoConfig, log_page_default_field_list: "uds" };
      searchObj.meta.quickMode = true;
      await nextTick();
      expect(source.footerSchemaTab!.value).toBe("user_defined_schema");
      expect(source.footerInterestingOnly!.value).toBe(false);
    });

    it("switches the schema tab and rebuilds the fields", async () => {
      seed([stream("app", { settings: { defined_schema_fields: ["level"] } })]);
      source.footerToggle!("schema", "all_fields");
      expect(searchObj.meta.useUserDefinedSchemas).toBe("all_fields");
      expect(source.footerInterestingOnly!.value).toBe(false);
      await flushPromises();
      expect(searchObj.loadingStream).toBe(false);
      expect(
        source.fields.value
          .filter((row) => !row.isGroup)
          .map((row) => row.name)
          .sort(),
      ).toEqual(["_timestamp", "level", "method", "service_name"]);
    });

    it("switches the interesting-only list on and off", async () => {
      seed([stream("app")]);
      source.footerToggle!("interesting", true);
      expect(source.footerInterestingOnly!.value).toBe(true);
      await flushPromises();
      source.footerToggle!("interesting", false);
      expect(source.footerInterestingOnly!.value).toBe(false);
    });
  });

  // ─── Values ──────────────────────────────────────────────────────

  describe("values", () => {
    const open = (name: string, streams: string[]) => source.openField(field(name, { streams }));

    it.each(
      Object.entries(LOGS_FIELD_VALUES_PARITY).filter(
        ([key]) => !key.startsWith("keyword") && !key.startsWith("loadMore"),
      ),
    )("sends the request body the old sidebar built: %s", (key) => {
      const scenario: Record<string, () => void> = {
        quickSingle: () => {
          seed([stream("s1")]);
          searchObj.data.query = "service_name='abc' AND level='error'";
        },
        quickSingleVrl: () => {
          seed([stream("s1")]);
          searchObj.data.query = "service_name='abc'";
          searchObj.data.tempFunctionContent = ".a = 1";
        },
        sqlSingle: () => {
          seed([stream("s1")]);
          searchObj.meta.sqlMode = true;
          searchObj.data.query = `SELECT * FROM "s1" WHERE "service_name" = 'abc' AND "level" = 'error'`;
        },
        sqlMulti: () => {
          seed([stream("s1"), stream("s2")]);
          searchObj.meta.sqlMode = true;
          searchObj.data.query = `SELECT * FROM "s1" WHERE level='error' UNION ALL BY NAME SELECT * FROM "s2" WHERE method='GET'`;
        },
        quickMulti: () => {
          seed([stream("s1"), stream("s2")]);
          searchObj.data.query = "level='error'";
        },
        enrichment: () => {
          seed(
            [
              stream("enr", {
                stats: { doc_time_min: 1700000000000000, doc_time_max: 1700003600000000 },
              }),
            ],
            "enrichment_tables",
          );
        },
      };
      scenario[key]();
      open("level", searchObj.data.stream.selectedStream);
      expect(sent).toEqual(LOGS_FIELD_VALUES_PARITY[key as keyof typeof LOGS_FIELD_VALUES_PARITY]);
    });

    // Every request still streaming ends, as the transport's completion call does.
    const settle = (hits: { zo_sql_key: string; zo_sql_num: number }[][] = []) => {
      inFlight.splice(0).forEach(({ payload, handlers }, index) => {
        if (hits[index]) {
          handlers.data(payload, {
            type: "search_response_hits",
            content: { results: { hits: [{ values: hits[index] }] } },
          });
        }
        handlers.complete(payload, payload.traceId);
      });
    };
    const hits = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ zo_sql_key: `v${i}`, zo_sql_num: 100 - i }));

    it("re-sends the keyword and then loads more with the pinned range and the keyword", () => {
      seed([stream("s1")]);
      searchObj.data.query = "service_name='abc'";
      open("level", ["s1"]);
      settle();
      sent.length = 0;
      source.searchValues("level", "err");
      expect(sent).toEqual(LOGS_FIELD_VALUES_PARITY.keyword);
      settle();
      sent.length = 0;
      searchObj.data.datetime = { type: "absolute", startTime: 1, endTime: 2 };
      source.loadMoreValues("level");
      expect(sent).toEqual(LOGS_FIELD_VALUES_PARITY.loadMoreAfterKeyword);
    });

    it("restores the unfiltered values without a request when the value search is cleared", () => {
      seed([stream("s1")]);
      open("level", ["s1"]);
      settle([[{ zo_sql_key: "error", zo_sql_num: 3 }]]);
      source.searchValues("level", "err");
      expect(source.fieldValues.value.level.values).toEqual([]);
      sent.length = 0;
      source.searchValues("level", "");
      expect(sent).toEqual([]);
      expect(source.fieldValues.value.level.values).toEqual([{ key: "error", count: 3 }]);
    });

    it("keeps an exhausted list exhausted when the value search is cleared (U1)", () => {
      seed([stream("s1")]);
      open("level", ["s1"]);
      settle([hits(10)]);
      expect(source.fieldValues.value.level.hasMore).toBe(true);
      source.loadMoreValues("level");
      settle([hits(17)]);
      expect(source.fieldValues.value.level).toMatchObject({ hasMore: false });
      expect(source.fieldValues.value.level.values).toHaveLength(17);
      source.searchValues("level", "v1");
      settle([hits(2)]);
      source.searchValues("level", "");
      expect(source.fieldValues.value.level.values).toHaveLength(17);
      expect(source.fieldValues.value.level.hasMore).toBe(false);
    });

    it("continues paging after a cleared search from the page it had reached", () => {
      seed([stream("s1")]);
      open("level", ["s1"]);
      settle([hits(10)]);
      source.loadMoreValues("level");
      settle([hits(20)]);
      source.searchValues("level", "v1");
      settle([hits(2)]);
      source.searchValues("level", "");
      sent.length = 0;
      source.loadMoreValues("level");
      expect(sent.map((request) => request.size)).toEqual([30]);
    });

    it("asks for the same page again after a failed load more, then moves on one page (F2)", () => {
      seed([stream("s1")]);
      open("level", ["s1"]);
      settle([hits(10)]);
      sent.length = 0;
      source.loadMoreValues("level");
      inFlight
        .splice(0)
        .forEach(({ payload, handlers }) => handlers.error(payload, new Error("boom")));
      expect(source.fieldValues.value.level).toMatchObject({ hasMore: true });
      source.loadMoreValues("level");
      settle([hits(20)]);
      source.loadMoreValues("level");
      expect(sent.map((request) => request.size)).toEqual([20, 20, 30]);
    });

    it("asks for the next page only once the current fetch has settled (U4)", () => {
      seed([stream("s1")]);
      open("level", ["s1"]);
      sent.length = 0;
      source.loadMoreValues("level");
      expect(sent).toEqual([]);
      settle([hits(10)]);
      source.loadMoreValues("level");
      source.loadMoreValues("level");
      expect(sent.map((request) => request.size)).toEqual([20]);
    });

    it("drops the field's own condition in quick mode and in SQL mode", () => {
      seed([stream("s1")]);
      searchObj.data.query = "service_name='abc' AND level='error' AND method='GET'";
      open("service_name", ["s1"]);
      expect(decodeSql()[0][1]).toBe(
        `SELECT * FROM "s1" WHERE "level" = 'error' AND "method" = 'GET'`,
      );
      sent.length = 0;
      searchObj.meta.sqlMode = true;
      searchObj.data.query = `SELECT * FROM "s1" s1 INNER JOIN "s2" s2 ON s1.id = s2.id WHERE "service_name" = 'abc' AND "level" = 'error'`;
      open("service_name", ["s1"]);
      const sql = decodeSql()[0][1];
      expect(sql).not.toContain("service_name");
      expect(sql).toContain("level");
      expect(sql.toUpperCase()).toContain("JOIN");
      expect(searchObj.data.query).toContain("service_name");
    });

    it("sends a plain select for a UNION the parser rejects", () => {
      seed([stream("s1")]);
      searchObj.meta.sqlMode = true;
      searchObj.data.query = "SELECT * UNION ALL BY NAME -- unsupported syntax";
      open("level", ["s1"]);
      expect(decodeSql()).toEqual([["s1", `SELECT * FROM "s1"`]]);
    });

    it("keeps a quoted pipe inside a term in the WHERE clause", () => {
      seed([stream("s1")]);
      searchObj.data.query = "match_all('text | error')";
      open("level", ["s1"]);
      const sql = decodeSql()[0][1];
      expect(sql.startsWith("SELECT *")).toBe(true);
      expect(sql).toContain("match_all('text | error')");
    });

    it("validates a multi-stream filter and asks only the streams that have its field (B4)", async () => {
      seed([
        stream("s1", { schema: [{ name: "level", type: "Utf8" }] }),
        stream("s2", {
          schema: [
            { name: "level", type: "Utf8" },
            { name: "d", type: "Utf8" },
          ],
        }),
      ]);
      await extract();
      searchObj.data.query = "d='x'";
      open("level", ["s1", "s2"]);
      expect(searchObj.data.stream.missingStreamMultiStreamFilter).toEqual(["s1"]);
      expect(sent.map((p) => p.stream_name)).toEqual(["s2"]);
    });

    it.each(["status=500 -404 AND is_error", "status=500 -debug AND is_error"])(
      "settles a held filter with the invalid-query message instead of running it: %s",
      (query) => {
        seed([
          stream("fts_a", {
            schema: [
              { name: "body", type: "Utf8" },
              { name: "level", type: "Utf8" },
              { name: "status", type: "Int64" },
              { name: "is_error", type: "Boolean" },
            ],
            settings: { full_text_search_keys: ["body"] },
          }),
        ]);
        searchObj.data.query = query;
        open("level", ["fts_a"]);
        expect(sent).toEqual([]);
        expect(source.fieldValues.value.level.isLoading).toBe(false);
        expect(source.fieldValues.value.level.errMsg).toBe("Search query is empty or invalid.");
      },
    );

    it("renders a free-text filter as match_all and asks only streams that can search it", () => {
      const fts = stream("fts_a", {
        schema: [
          { name: "body", type: "Utf8" },
          { name: "level", type: "Utf8" },
        ],
        settings: { full_text_search_keys: ["body"] },
      });
      const noFts = stream("nofts_b", {
        schema: [
          { name: "msg_text", type: "Utf8" },
          { name: "level", type: "Utf8" },
        ],
      });
      seed([fts, noFts]);
      searchObj.data.query = "timeout";
      open("level", ["fts_a", "nofts_b"]);
      expect(decodeSql()).toEqual([["fts_a", `SELECT * FROM "fts_a" WHERE match_all('timeout')`]]);
      expect(searchObj.data.filterErrMsg).toBe("");

      sent.length = 0;
      open("msg_text", ["nofts_b"]);
      expect(sent).toEqual([]);
      expect(source.fieldValues.value.msg_text.isLoading).toBe(false);
      expect(source.fieldValues.value.msg_text.errMsg).toBe(
        "nofts_b was skipped because it has no full-text search fields configured.",
      );
    });

    it("never opens a field without values or a full-text field while the config hides its values", () => {
      seed([stream("s1")]);
      source.openField(field("_timestamp", { showValues: false }));
      source.openField(field("body", { ftsKey: true }));
      expect(source.expandedFields.value).toEqual([]);
      store.state.zoConfig = { ...zoConfig, show_fts_field_values: true };
      source.openField(field("body", { ftsKey: true }));
      expect(source.expandedFields.value).toEqual(["body"]);
    });

    it("closes a field and forgets its values, and drops every open field on a stream change", async () => {
      seed([stream("s1")]);
      open("level", ["s1"]);
      open("method", ["s1"]);
      source.closeField("level");
      expect(source.expandedFields.value).toEqual(["method"]);
      expect(source.fieldValues.value.level.values).toEqual([]);
      searchObj.data.stream.selectedStream = ["s2"];
      await nextTick();
      expect(source.expandedFields.value).toEqual([]);
      expect(source.fieldValues.value).toEqual({});
    });

    it("describes the pinned range and stream of an open field", () => {
      seed([stream("s1")]);
      open("level", ["s1"]);
      expect(source.valuesRequest(field("level"))).toMatchObject({
        streamName: "s1",
        streamType: "logs",
        startTime: 1700000000000000,
        endTime: 1700003600000000,
      });
    });
  });

  // ─── Filters ─────────────────────────────────────────────────────

  describe("filters", () => {
    it("writes the add-filter expression, quoting a reserved name in SQL mode only", () => {
      source.addFilter("user='alice'");
      expect(searchObj.data.stream.addToFilter).toBe("user='alice'");
      searchObj.meta.sqlMode = true;
      source.addFilter("user='alice'");
      expect(searchObj.data.stream.addToFilter).toBe(`"user"='alice'`);
      source.addFilter("level=''");
      expect(searchObj.data.stream.addToFilter).toBe("level=''");
    });

    it("builds the value filter by data type: numbers bare, the null row as missing or empty, strings quoted", () => {
      seed([
        stream("s1", {
          schema: [
            { name: "code", type: "Int64" },
            { name: "ok", type: "Boolean" },
            { name: "level", type: "Utf8" },
          ],
        }),
      ]);
      source.addValueFilters("code", ["500"], []);
      expect(searchObj.data.stream.addToFilter).toBe("code = 500");
      source.addValueFilters("ok", [], ["true"]);
      expect(searchObj.data.stream.addToFilter).toBe("ok is not true");
      source.addValueFilters("level", [MISSING_VALUE_KEY], []);
      expect(searchObj.data.stream.addToFilter).toBe("(level is null OR level = '')");
      source.addValueFilters("level", [], [MISSING_VALUE_KEY]);
      expect(searchObj.data.stream.addToFilter).toBe("(level is not null AND level != '')");
      source.addValueFilters("level", ["null"], []);
      expect(searchObj.data.stream.addToFilter).toBe("level = 'null'");
      source.addValueFilters("code", [MISSING_VALUE_KEY], []);
      expect(searchObj.data.stream.addToFilter).toBe("code is null");
      source.addValueFilters("level", ["a", "b"], []);
      expect(searchObj.data.stream.addToFilter).toBe("(level = 'a' OR level = 'b')");
      source.addValueFilters("level", [], ["a", "b"]);
      expect(searchObj.data.stream.addToFilter).toBe("(level != 'a' AND level != 'b')");
      source.addValueFilters("level", ["a", "b"], ["c", "d"]);
      expect(searchObj.data.stream.addToFilter).toBe(
        "((level = 'a' OR level = 'b') AND level != 'c' AND level != 'd')",
      );
      source.addValueFilters("level", ["a", MISSING_VALUE_KEY], ["c"]);
      expect(searchObj.data.stream.addToFilter).toBe(
        "((level = 'a' OR level is null OR level = '') AND (level != 'c' OR level is null))",
      );
      source.addValueFilters("code", [MISSING_VALUE_KEY], ["500"]);
      expect(searchObj.data.stream.addToFilter).toBe(
        "(code is null AND (code != 500 OR code is null))",
      );
      searchObj.meta.sqlMode = true;
      source.addValueFilters("user", ["x"], []);
      expect(searchObj.data.stream.addToFilter).toBe(`"user" = 'x'`);
    });

    it("matches the null row with a value, and checks only null when another stream types the field as a number", () => {
      seed([stream("s1", { schema: [{ name: "k", type: "Utf8" }] })]);
      source.addValueFilters("k", [MISSING_VALUE_KEY, "x"], []);
      expect(searchObj.data.stream.addToFilter).toBe("(k is null OR k = '' OR k = 'x')");
      source.addValueFilters("k", [], [MISSING_VALUE_KEY, "x"]);
      expect(searchObj.data.stream.addToFilter).toBe("(k is not null AND k != '' AND k != 'x')");
      seed([
        stream("s1", { schema: [{ name: "k", type: "Utf8" }] }),
        stream("s2", { schema: [{ name: "k", type: "Int64" }] }),
      ]);
      source.addValueFilters("k", [MISSING_VALUE_KEY], []);
      expect(searchObj.data.stream.addToFilter).toBe("k is null");
      source.addValueFilters("k", [], [MISSING_VALUE_KEY]);
      expect(searchObj.data.stream.addToFilter).toBe("k is not null");
    });

    it.each(["order", "group"])(
      "reads values next to a field named like the SQL keyword %s",
      async (keyword) => {
        seed([
          stream("s1", {
            schema: [keyword, "msg"].map((name) => ({ name, type: "Utf8" })),
          }),
        ]);
        searchObj.data.stream.selectedStreamFields = [keyword, "msg"].map((name) => field(name));
        searchObj.data.query = `(${keyword} = 'x1') AND msg = 'A'`;
        await nextTick();
        expect(source.activeIncludeValues.value).toEqual({ [keyword]: ["x1"], msg: ["A"] });
        searchObj.data.query = `${keyword} = 'g1' AND msg != 'A'`;
        await nextTick();
        expect(source.activeIncludeValues.value).toEqual({ [keyword]: ["g1"] });
        expect(source.activeExcludeValues.value).toEqual({ msg: ["A"] });
      },
    );

    it("asks the search bar to drop a field's filter when its last value is unticked", () => {
      source.removeFieldFilter("level");
      expect(searchObj.data.stream.removeFilterField).toBe("level");
    });

    it("pre-checks the values the query holds, with embedded quotes undoubled", async () => {
      seed([stream("s1")]);
      searchObj.data.query = "level='it''s' or level='b'";
      await nextTick();
      expect(source.activeIncludeValues.value).toEqual({ level: ["it's", "b"] });
      searchObj.data.query = "level!='it''s'";
      await nextTick();
      expect(source.activeExcludeValues.value).toEqual({ level: ["it's"] });
      searchObj.data.query = "level='' AND code IS NULL";
      await nextTick();
      expect(source.activeIncludeValues.value).toEqual({ code: [MISSING_VALUE_KEY] });
      expect(source.activeExcludeValues.value).toEqual({});
      searchObj.data.query = "(level is null AND (level != 'c' OR level is null))";
      await nextTick();
      expect(source.activeIncludeValues.value).toEqual({ level: [MISSING_VALUE_KEY] });
      expect(source.activeExcludeValues.value).toEqual({ level: ["c"] });
      searchObj.data.query = "level = 'null' AND ok is not true";
      await nextTick();
      expect(source.activeIncludeValues.value).toEqual({ level: ["null"] });
      expect(source.activeExcludeValues.value).toEqual({ ok: ["true"] });
      searchObj.data.query = "match_all('timeout') and level='error'";
      await nextTick();
      expect(source.activeIncludeValues.value).toEqual({ level: ["error"] });
      searchObj.data.query = "timeout";
      await nextTick();
      expect(source.activeIncludeValues.value).toEqual({});
    });
  });

  describe("in the panel", () => {
    const VALUES = {
      values: [{ key: "a", count: 2 }],
      isLoading: false,
      hasMore: false,
      errMsg: "",
    };

    const openRows = (names: string[]) => {
      for (const name of names) {
        const row = source.fields.value.find((item) => !item.isGroup && item.name === name);
        source.openField(row as PanelField);
        source.fieldValues.value[name] = { ...VALUES };
      }
    };

    const mountPanel = () =>
      mount(StreamFieldPanel, {
        props: { capabilities: source.capabilities.value, source },
        global: { provide: { store }, plugins: [i18n, router, store] },
      });

    const checkboxesOf = (panel: ReturnType<typeof mount>, name: string) =>
      panel.findAll(`[data-test="o-field-list-expansion-${name}"] [role="checkbox"]`);

    it("offers value checkboxes on one stream and writes the clicked value as a filter", async () => {
      seed([stream("s1")]);
      await extract();
      openRows(["level"]);
      const panel = mountPanel();
      await flushPromises();
      expect(checkboxesOf(panel, "level")).toHaveLength(1);
      await checkboxesOf(panel, "level")[0].trigger("click");
      expect(searchObj.data.stream.addToFilter).toBe("level = 'a'");
      panel.unmount();
    });

    it("offers value checkboxes on several streams only for a field every stream has", async () => {
      seed([
        stream("s1", {
          schema: [
            { name: "level", type: "Utf8" },
            { name: "method", type: "Utf8" },
          ],
        }),
        stream("s2", { schema: [{ name: "level", type: "Utf8" }] }),
      ]);
      await extract();
      openRows(["level", "method"]);
      const panel = mountPanel();
      await flushPromises();
      expect(checkboxesOf(panel, "level")).toHaveLength(1);
      expect(panel.find('[data-test="logs-search-subfield-add-method-a"]').exists()).toBe(true);
      expect(checkboxesOf(panel, "method")).toHaveLength(0);
      panel.unmount();
    });
  });

  describe("quoteSchemaFieldsInWhere", () => {
    it("quotes the schema fields typed bare and spaces the operators", () => {
      expect(quoteSchemaFieldsInWhere("level='a' and user=1", ["level", "user"])).toBe(
        `"level" = 'a' and "user" = 1`,
      );
    });
  });
});
