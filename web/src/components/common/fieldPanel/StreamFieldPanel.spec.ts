// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { ref } from "vue";
import { createStore } from "vuex";
import StreamFieldPanel from "./StreamFieldPanel.vue";
import type { FieldPanelCapabilities, FieldPanelSource, PanelField } from "./fieldPanel.types";

const field = (name: string, extra: Partial<PanelField> = {}): PanelField => ({
  name,
  dataType: "Utf8",
  ftsKey: false,
  isSchemaField: true,
  showValues: true,
  group: "g",
  ...extra,
});

const header = (group: string, name = group): PanelField => ({
  name,
  dataType: "",
  ftsKey: false,
  isSchemaField: false,
  showValues: false,
  isGroup: true,
  groupName: name,
  group,
});

const FIELDS: PanelField[] = [
  header("g"),
  field("alpha"),
  field("beta", { showValues: false }),
  field("gamma", { ftsKey: true }),
  field("delta", { isSchemaField: false }),
];

const CAPS: FieldPanelCapabilities = {
  streamPicker: "none",
  values: true,
  drag: false,
  actions: ["add-filter"],
  footerToggles: [],
  highlightColumns: false,
};

function makeSource(fields: PanelField[] = FIELDS, selected: string[] = ["s1"]) {
  const expandedFields = ref<string[]>([]);
  const search = ref("");
  const collapsedGroups = ref(new Set<string>());
  const source: FieldPanelSource = {
    streams: ref([{ label: "s1" as never, value: "s1" }]),
    selectedStreams: ref(selected),
    streamType: ref("logs"),
    fields: ref(fields),
    loading: ref(false),
    groupingMode: "semantic",
    search,
    collapsedGroups,
    expandedFields,
    setSearch: vi.fn((value: string) => {
      search.value = value;
    }),
    toggleGroup: vi.fn((group: string) => {
      const next = new Set(collapsedGroups.value);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      collapsedGroups.value = next;
    }),
    fieldValues: ref({}),
    activeIncludeValues: ref({}),
    activeExcludeValues: ref({}),
    valuesRequest: vi.fn(() => ({
      streamName: "s1",
      streamType: "logs",
      startTime: 0,
      endTime: 1,
      whereClause: "",
    })),
    selectStreams: vi.fn(),
    changeStreamType: vi.fn(),
    openField: vi.fn((row: PanelField) => {
      expandedFields.value = [...expandedFields.value, row.name];
    }),
    closeField: vi.fn((name: string) => {
      expandedFields.value = expandedFields.value.filter((id) => id !== name);
    }),
    searchValues: vi.fn(),
    loadMoreValues: vi.fn(),
    addFilter: vi.fn(),
    addValueFilters: vi.fn(),
    removeFieldFilter: vi.fn(),
  };
  return source;
}

function makeStore(zoConfig: Record<string, unknown> = {}) {
  return createStore({
    state: {
      selectedOrganization: { identifier: "org" },
      zoConfig: {
        timestamp_column: "_timestamp",
        query_values_default_num: 10,
        show_fts_field_values: false,
        ...zoConfig,
      },
    },
  });
}

function mountPanel(
  capabilities: FieldPanelCapabilities = CAPS,
  source: FieldPanelSource = makeSource(),
  zoConfig: Record<string, unknown> = {},
) {
  return mount(StreamFieldPanel, {
    props: { capabilities, source },
    global: { plugins: [makeStore(zoConfig)] },
    attachTo: document.body,
  });
}

describe("StreamFieldPanel", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const rows = () => wrapper.findAll(".o-field-list__row");
  const chevron = (name: string) => wrapper.find(`[data-test="field-panel-row-chevron-${name}"]`);

  it("renders the same DOM for the same capability object regardless of adapter", () => {
    wrapper = mountPanel(CAPS, makeSource());
    const first = wrapper.html();
    wrapper.unmount();
    const other = makeSource();
    other.valuesRequest = vi.fn(() => ({
      streamName: "other",
      streamType: "traces",
      startTime: 5,
      endTime: 6,
      whereClause: "x=1",
    }));
    wrapper = mountPanel(CAPS, other);
    expect(wrapper.html()).toBe(first);
  });

  it("omits the picker zone entirely when the page fixes the stream", () => {
    wrapper = mountPanel();
    expect(wrapper.find('[data-test="stream-picker"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="o-field-list-search"]').exists()).toBe(true);
  });

  it("renders the picker with the stream-type select only when the capability asks for it", () => {
    wrapper = mountPanel({ ...CAPS, streamPicker: "single", streamType: "select" });
    expect(wrapper.find('[data-test="stream-picker"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="stream-picker-stream-type"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="log-search-index-list-select-stream"]').exists()).toBe(true);
    wrapper.unmount();
    wrapper = mountPanel({ ...CAPS, streamPicker: "single", streamType: "hidden" });
    expect(wrapper.find('[data-test="stream-picker-stream-type"]').exists()).toBe(false);
  });

  it("shows the no-stream state instead of the list until a stream is picked", () => {
    wrapper = mountPanel({ ...CAPS, streamPicker: "single" }, makeSource(FIELDS, []));
    expect(wrapper.find('[data-test="stream-field-panel-no-stream"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="o-field-list"]').exists()).toBe(false);
  });

  it("draws the chevron only on rows that pass the one expandability rule", () => {
    wrapper = mountPanel();
    expect(chevron("alpha").exists()).toBe(true);
    expect(chevron("beta").exists()).toBe(false);
    expect(chevron("gamma").exists()).toBe(false);
    expect(chevron("delta").exists()).toBe(false);
  });

  it("lets a full-text field expand once the config allows its values", () => {
    wrapper = mountPanel(CAPS, makeSource(), { show_fts_field_values: true });
    expect(chevron("gamma").exists()).toBe(true);
  });

  it("draws no chevron at all when the page has no values capability", () => {
    wrapper = mountPanel({ ...CAPS, values: false });
    expect(chevron("alpha").exists()).toBe(false);
  });

  it("shows the type icon on every row", () => {
    wrapper = mountPanel();
    expect(
      wrapper.find('[data-test="logs-field-list-item-alpha"] .text-field-list-label-icon').exists(),
    ).toBe(true);
  });

  it("opens a field through the source when its row is clicked", async () => {
    const source = makeSource();
    wrapper = mountPanel(CAPS, source);
    await wrapper.find('[data-test="o-field-list-row-alpha"]').trigger("click");
    expect(source.openField).toHaveBeenCalledWith(expect.objectContaining({ name: "alpha" }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="field-values-panel-container"]').exists()).toBe(true);
    await wrapper.find('[data-test="o-field-list-row-alpha"]').trigger("click");
    expect(source.closeField).toHaveBeenCalledWith("alpha");
  });

  it("shows top values read-only when the page offers no value filters", async () => {
    const source = makeSource();
    source.fieldValues.value = {
      alpha: { values: [{ key: "a", count: 3 }], isLoading: false, hasMore: false, errMsg: "" },
    };
    source.expandedFields.value = ["alpha"];
    wrapper = mountPanel({ ...CAPS, valueFilters: false }, source);
    expect(wrapper.find('[data-test="logs-search-subfield-add-alpha-a"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="field-values-panel-filter-mode-bar"]').exists()).toBe(false);
    expect(wrapper.findAll('[role="checkbox"]')).toHaveLength(0);
    wrapper.unmount();
    wrapper = mountPanel(CAPS, source);
    expect(wrapper.find('[data-test="field-values-panel-filter-mode-bar"]').exists()).toBe(true);
    expect(wrapper.findAll('[role="checkbox"]')).toHaveLength(1);
  });

  it("ignores a click on a row that cannot expand", async () => {
    const source = makeSource();
    wrapper = mountPanel(CAPS, source);
    await wrapper.find('[data-test="o-field-list-row-beta"]').trigger("click");
    expect(source.openField).not.toHaveBeenCalled();
  });

  it("makes rows focusable and toggles expansion with Enter", async () => {
    const source = makeSource();
    wrapper = mountPanel(CAPS, source);
    const alpha = wrapper.find('[data-test="o-field-list-row-alpha"]');
    expect(alpha.attributes("tabindex")).toBe("0");
    await alpha.trigger("keydown", { key: "Enter" });
    expect(source.openField).toHaveBeenCalledWith(expect.objectContaining({ name: "alpha" }));
  });

  it("expands and collapses a focused row with Enter as well as Space (U3)", async () => {
    const source = makeSource();
    wrapper = mountPanel(CAPS, source);
    const alpha = () => wrapper.find('[data-test="o-field-list-row-alpha"]');
    (alpha().element as HTMLElement).focus();
    await alpha().trigger("keydown", { key: "Enter" });
    expect(source.expandedFields.value).toEqual(["alpha"]);
    await alpha().trigger("keydown", { key: "Enter" });
    expect(source.closeField).toHaveBeenCalledWith("alpha");
    expect(source.expandedFields.value).toEqual([]);
    await alpha().trigger("keydown", { key: " " });
    expect(source.expandedFields.value).toEqual(["alpha"]);
    await alpha().trigger("keydown", { key: "Tab" });
    expect(source.expandedFields.value).toEqual(["alpha"]);
  });

  it("expands a dashboard row with its drag grip by Enter and Space too (M2)", async () => {
    const source = makeSource();
    source.dragEnabled = vi.fn(() => true);
    wrapper = mountPanel({ ...CAPS, drag: true, actions: ["chips"] }, source);
    const alpha = () => wrapper.find('[data-test="o-field-list-row-alpha"]');
    expect(alpha().find('[data-test="o-field-list-drag-indicator"]').exists()).toBe(true);
    (alpha().element as HTMLElement).focus();
    await alpha().trigger("keydown", { key: "Enter" });
    expect(source.expandedFields.value).toEqual(["alpha"]);
    await alpha().trigger("keydown", { key: " " });
    expect(source.expandedFields.value).toEqual([]);
  });

  it("moves focus between rows with the arrow keys", async () => {
    wrapper = mountPanel();
    (rows()[0].element as HTMLElement).focus();
    await rows()[0].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows()[1].element);
  });

  it("writes field='' through the add-filter intent", async () => {
    const source = makeSource();
    wrapper = mountPanel(CAPS, source);
    await wrapper
      .find('[data-test="log-search-index-list-filter-alpha-field-btn"]')
      .trigger("click");
    expect(source.addFilter).toHaveBeenCalledWith("alpha=''");
  });

  it("offers the eye toggle on every column except a locked one", () => {
    const source = makeSource([header("g"), field("alpha"), field("beta", { columnLocked: true })]);
    source.tableColumns = ref(["beta"]);
    wrapper = mountPanel({ ...CAPS, actions: ["toggle-column"], highlightColumns: true }, source);
    expect(wrapper.find('[data-test="log-search-index-list-add-alpha-field-btn"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="log-search-index-list-remove-beta-field-btn"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="o-field-list-row-beta"]').html()).toContain(
      "bg-field-list-row-hover-bg!",
    );
  });

  it("shows a locked column's eye disabled, with its reason, when the source gives one", () => {
    const reason = "Always shown" as never;
    const source = makeSource([
      header("g"),
      field("alpha"),
      field("_timestamp", { columnLocked: true, columnLockedReason: reason }),
      field("beta", { columnLocked: true }),
    ]);
    wrapper = mountPanel({ ...CAPS, actions: ["toggle-column"] }, source);
    const eye = wrapper.find('[data-test="log-search-index-list-locked-_timestamp-field-btn"]');
    expect(eye.exists()).toBe(true);
    expect(eye.attributes("aria-disabled")).toBe("true");
    expect(eye.attributes("aria-label")).toBe("Always shown");
    expect(eye.text()).toContain("Always shown");
    expect(wrapper.find('[data-test="log-search-index-list-locked-beta-field-btn"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-test="log-search-index-list-add-_timestamp-field-btn"]').exists(),
    ).toBe(false);
  });

  it("renders the source's caption above the values of an open field, and none where it gives none", () => {
    const source = makeSource([header("g"), field("alpha"), field("omega")]);
    source.expandedFields.value = ["alpha", "omega"];
    source.valuesCaption = (row) =>
      row.name === "alpha" ? { text: "spans" as never, testId: "caption" } : null;
    wrapper = mountPanel(CAPS, source);
    const alpha = wrapper.find('[data-test="o-field-list-expansion-alpha"]');
    expect(alpha.find('[data-test="caption"]').text()).toBe("spans");
    expect(alpha.find('[data-test="field-values-panel-container"]').exists()).toBe(true);
    const omega = wrapper.find('[data-test="o-field-list-expansion-omega"]');
    expect(omega.find('[data-test="caption"]').exists()).toBe(false);
  });

  it("groups flat rows with the source's groupFn in custom mode, with counts and no empty group", async () => {
    const source = makeSource([field("zeek_uid"), field("severity_id"), field("_timestamp")]);
    source.groupingMode = "custom";
    source.groupFn = (rows) => [
      { key: "event", label: "Event" as never, fields: rows.filter((r) => r.name !== "zeek_uid") },
      { key: "actor", label: "Actor" as never, fields: [] },
      { key: "other", label: "Other" as never, fields: rows.filter((r) => r.name === "zeek_uid") },
    ];
    wrapper = mountPanel(CAPS, source);
    expect(wrapper.find('[data-test="o-field-list-group-Event"]').text()).toContain("Event (2)");
    expect(wrapper.find('[data-test="o-field-list-group-Other"]').text()).toContain("Other (1)");
    expect(wrapper.find('[data-test="o-field-list-group-Actor"]').exists()).toBe(false);
    expect(rows().map((row) => row.attributes("data-test"))).toEqual([
      "o-field-list-row-severity_id",
      "o-field-list-row-_timestamp",
      "o-field-list-row-zeek_uid",
    ]);
    await wrapper.find('[data-test="o-field-list-group-Event"] > div').trigger("click");
    expect(source.toggleGroup).toHaveBeenCalledWith("event");
  });

  it("ignores groupFn unless the grouping mode is custom", () => {
    const source = makeSource();
    source.groupFn = vi.fn(() => []);
    wrapper = mountPanel(CAPS, source);
    expect(source.groupFn).not.toHaveBeenCalled();
    expect(rows().length).toBeGreaterThan(0);
  });

  it("renders the before-list slot between the search and the rows, outside their scroll", () => {
    wrapper = mount(StreamFieldPanel, {
      props: { capabilities: CAPS, source: makeSource() },
      slots: { "before-list": '<div data-test="sources">sources</div>' },
      global: { plugins: [makeStore()] },
      attachTo: document.body,
    });
    const block = wrapper.find('[data-test="sources"]').element;
    const searchBox = wrapper.find('[data-test="o-field-list-search"]').element;
    const firstRow = rows()[0].element;
    expect(searchBox.compareDocumentPosition(block)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(block.compareDocumentPosition(firstRow)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(block.closest(".overflow-y-auto")).toBeNull();
  });

  describe("empty-state texts from the source", () => {
    const texts = {
      noStream: "Pick a source" as never,
      noFields: "Nothing in the schema" as never,
      noMatch: "Nothing matches" as never,
    };
    const emptyText = () => wrapper.find('[data-test="stream-field-panel-empty"]').text();

    it("keeps the list, search and slot when a page without a picker has no stream", () => {
      const source = makeSource([], []);
      source.emptyState = ref(texts);
      wrapper = mount(StreamFieldPanel, {
        props: { capabilities: CAPS, source },
        slots: { "before-list": '<div data-test="sources">sources</div>' },
        global: { plugins: [makeStore()] },
        attachTo: document.body,
      });
      expect(emptyText()).toBe("Pick a source");
      expect(wrapper.find('[data-test="sources"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o-field-list-search"]').exists()).toBe(true);
    });

    it("tells an empty schema from a search that matches nothing", async () => {
      const source = makeSource([]);
      source.emptyState = ref(texts);
      wrapper = mountPanel(CAPS, source);
      expect(emptyText()).toBe("Nothing in the schema");
      source.fields.value = [header("g"), field("alpha")];
      await wrapper.find('[data-test="o-field-list-search"] input').setValue("zzz");
      expect(emptyText()).toBe("Nothing matches");
    });

    it("falls back to the panel's own texts for the ones the source leaves out", async () => {
      const source = makeSource([], []);
      source.emptyState = ref({ noMatch: texts.noMatch });
      wrapper = mountPanel(CAPS, source);
      expect(emptyText()).toBe("No fields found for the selected stream");
      wrapper.unmount();
      wrapper = mountPanel({ ...CAPS, streamPicker: "single" }, source);
      expect(wrapper.find('[data-test="stream-field-panel-no-stream"]').text()).toBe(
        "Select a stream to get started",
      );
    });

    it("uses the source's no-stream text in the picker's no-stream state", () => {
      const source = makeSource(FIELDS, []);
      source.emptyState = ref(texts);
      wrapper = mountPanel({ ...CAPS, streamPicker: "single" }, source);
      expect(wrapper.find('[data-test="stream-field-panel-no-stream"]').text()).toBe(
        "Pick a source",
      );
    });

    it("shows the skeleton, not an empty text, while the source loads", () => {
      const source = makeSource([], []);
      source.emptyState = ref(texts);
      source.loading.value = true;
      wrapper = mountPanel(CAPS, source);
      expect(wrapper.find('[data-test="stream-field-panel-skeleton"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="stream-field-panel-empty"]').exists()).toBe(false);
    });
  });

  it("shows the field count on a single page, with no footer controls (X2)", () => {
    wrapper = mountPanel(CAPS, makeSource([header("g"), field("alpha"), field("beta")]));
    expect(wrapper.find('[data-test="logs-page-fields-list-pagination-range"]').text()).toBe(
      "2 fields",
    );
  });

  it("offers the footer's reset only to a page that can reset its columns", () => {
    const source = makeSource();
    wrapper = mountPanel({ ...CAPS, actions: ["toggle-column"] }, source);
    expect(wrapper.find('[data-test="logs-page-fields-list-reset-icon"]').exists()).toBe(false);
    wrapper.unmount();
    source.resetColumns = vi.fn();
    wrapper = mountPanel({ ...CAPS, actions: ["toggle-column"] }, source);
    expect(wrapper.find('[data-test="logs-page-fields-list-reset-icon"]').exists()).toBe(true);
  });

  it("renders no action strip when the page offers no action", () => {
    wrapper = mountPanel({ ...CAPS, actions: [] });
    expect(
      wrapper.find('[data-test="log-search-index-list-filter-alpha-field-btn"]').exists(),
    ).toBe(false);
  });

  it("does not page header rows", async () => {
    const many: PanelField[] = [header("a")];
    for (let i = 0; i < 30; i++) many.push(field(`a${i}`, { group: "a" }));
    many.push(header("b"));
    for (let i = 0; i < 30; i++) many.push(field(`b${i}`, { group: "b" }));
    wrapper = mountPanel(CAPS, makeSource(many));
    expect(rows()).toHaveLength(50);
    expect(wrapper.findAll('[data-test^="o-field-list-group-"]')).toHaveLength(2);
    await wrapper
      .find('[data-test="logs-page-fields-list-pagination-page-2-button"]')
      .trigger("click");
    expect(rows()).toHaveLength(10);
    expect(wrapper.findAll('[data-test^="o-field-list-group-"]')).toHaveLength(1);
  });

  it("shows the skeleton while the source is loading", () => {
    const source = makeSource();
    source.loading.value = true;
    wrapper = mountPanel(CAPS, source);
    expect(wrapper.find('[data-test="stream-field-panel-skeleton"]').exists()).toBe(true);
    expect(rows()).toHaveLength(0);
  });

  it("counts matches over the group's fields in its header while a search is active (U9)", async () => {
    const source = makeSource([header("g", "Body"), field("alpha"), field("alps"), field("beta")]);
    wrapper = mountPanel(CAPS, source);
    const headerText = () => wrapper.find('[data-test="o-field-list-group-Body"]').text();
    expect(headerText()).toContain("Body (3)");
    await wrapper.find('[data-test="o-field-list-search"] input').setValue("alp");
    expect(headerText()).toContain("Body (2 of 3)");
    await wrapper.find('[data-test="o-field-list-search"] input').setValue("");
    expect(headerText()).toContain("Body (3)");
  });

  it("labels the field range next to the pager, counting field rows only (U8)", () => {
    const many = Array.from({ length: 102 }, (_, i) => field(`f${String(i).padStart(3, "0")}`));
    wrapper = mountPanel(CAPS, makeSource([header("g"), ...many]));
    expect(wrapper.find('[data-test="logs-page-fields-list-pagination-range"]').text()).toBe(
      "1–50 of 102 fields",
    );
  });

  it("keeps the field total when a group is collapsed; the range follows the shown pages (P2)", async () => {
    const make = (group: string, count: number) =>
      Array.from({ length: count }, (_, i) =>
        field(`${group}${String(i).padStart(3, "0")}`, { group }),
      );
    const source = makeSource([header("a"), ...make("a", 70), header("b"), ...make("b", 40)]);
    wrapper = mountPanel(CAPS, source);
    const range = () => wrapper.find('[data-test="logs-page-fields-list-pagination-range"]').text();
    expect(range()).toBe("1–50 of 110 fields");
    source.collapsedGroups.value = new Set(["b"]);
    await flushPromises();
    expect(range()).toBe("1–50 of 110 fields");
    await wrapper
      .find('[data-test="logs-page-fields-list-pagination-page-2-button"]')
      .trigger("click");
    expect(range()).toBe("51–70 of 110 fields");
  });

  it("writes the search text back to the source", async () => {
    const source = makeSource();
    wrapper = mountPanel(CAPS, source);
    await wrapper.find('[data-test="o-field-list-search"] input').setValue("alp");
    expect(source.search.value).toBe("alp");
    expect(rows()).toHaveLength(1);
  });

  it("passes the picker hooks through and renders the page's slot beside the select", async () => {
    const source = makeSource();
    const announcement = ref<string>("Internal streams hidden");
    const closeSignal = ref(0);
    source.picker = {
      announcement: announcement as never,
      searchDebounce: 150,
      closeSignal,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onSearch: vi.fn(),
      onHeaderAction: vi.fn(),
    };
    source.refreshStreams = vi.fn();
    wrapper = mount(StreamFieldPanel, {
      props: { capabilities: { ...CAPS, streamPicker: "multi" }, source },
      slots: { "picker-before": '<button data-test="back">back</button>' },
      global: { plugins: [makeStore()] },
      attachTo: document.body,
    });
    const picker = wrapper.find('[data-test="stream-picker"]');
    expect(picker.find('[data-test="back"]').exists()).toBe(true);
    expect(
      picker.find('[data-test="log-search-index-list-stream-picker-announcement"]').text(),
    ).toBe("Internal streams hidden");
    const select = wrapper.findComponent({ name: "OSelect" });
    expect(select.props("searchDebounce")).toBe(150);
    expect(select.props("rowClickSingleSelect")).toBe(true);
    expect(select.props("pinSelectedInGroups")).toBe(true);
    select.vm.$emit("open");
    select.vm.$emit("search", "_r");
    select.vm.$emit("header-action", { value: "internal-streams:hide" });
    select.vm.$emit("close");
    expect(source.picker.onOpen).toHaveBeenCalled();
    expect(source.refreshStreams).toHaveBeenCalled();
    expect(source.picker.onSearch).toHaveBeenCalledWith("_r");
    expect(source.picker.onHeaderAction).toHaveBeenCalledWith({ value: "internal-streams:hide" });
    expect(source.picker.onClose).toHaveBeenCalled();
    const trigger = wrapper.find('[data-test="log-search-index-list-select-stream-trigger"]');
    await trigger.trigger("click");
    await vi.waitFor(() => expect(trigger.attributes("aria-expanded")).toBe("true"));
    closeSignal.value += 1;
    await vi.waitFor(() => expect(trigger.attributes("aria-expanded")).toBe("false"));
  });

  it("fills the no-stream state with the page's slot", () => {
    const source = makeSource(FIELDS, []);
    wrapper = mount(StreamFieldPanel, {
      props: { capabilities: { ...CAPS, streamPicker: "multi" }, source },
      slots: { "no-stream": '<div data-test="picks">picks</div>' },
      global: { plugins: [makeStore()] },
      attachTo: document.body,
    });
    expect(
      wrapper.find('[data-test="stream-field-panel-no-stream"] [data-test="picks"]').exists(),
    ).toBe(true);
  });

  it("renders the footer schema tabs from the source state and reports a change", async () => {
    const source = makeSource();
    source.footerSchemaTab = ref("all_fields");
    source.footerInterestingOnly = ref(false);
    source.footerToggle = vi.fn();
    wrapper = mountPanel({ ...CAPS, footerToggles: ["schema", "interesting"] }, source);
    expect(wrapper.find('[data-test="logs-page-user-defined-fields-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="logs-page-interesting-fields-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="logs-page-all-fields-btn"]').attributes("data-state")).toBe(
      "on",
    );
    await wrapper.find('[data-test="logs-page-interesting-fields-btn"]').trigger("click");
    expect(source.footerToggle).toHaveBeenCalledWith("schema", "interesting_fields");
    wrapper.unmount();
    wrapper = mountPanel({ ...CAPS, footerToggles: ["interesting"] }, source);
    expect(wrapper.find('[data-test="logs-page-user-defined-fields-btn"]').exists()).toBe(false);
    await wrapper.find('[data-test="logs-page-interesting-fields-btn"]').trigger("click");
    expect(source.footerToggle).toHaveBeenCalledWith("interesting", true);
  });

  it("starts paging over when the footer tab changes", async () => {
    const source = makeSource();
    const many: PanelField[] = [header("a")];
    for (let i = 0; i < 60; i++) many.push(field(`a${i}`, { group: "a" }));
    source.fields.value = many;
    source.footerInterestingOnly = ref(false);
    wrapper = mountPanel(CAPS, source);
    await wrapper
      .find('[data-test="logs-page-fields-list-pagination-page-2-button"]')
      .trigger("click");
    expect(rows()).toHaveLength(10);
    source.footerInterestingOnly.value = true;
    await wrapper.vm.$nextTick();
    expect(rows()).toHaveLength(50);
  });

  it("uses the page's skeleton and empty-state ids and text", () => {
    const source = makeSource([]);
    wrapper = mount(StreamFieldPanel, {
      props: {
        capabilities: CAPS,
        source,
        skeletonTestId: "logs-indexlist-fieldlist-loading-skeleton",
        emptyTestId: "logs-search-no-field-found-text",
        emptyText: "Nothing here" as never,
      },
      global: { plugins: [makeStore()] },
      attachTo: document.body,
    });
    expect(wrapper.find('[data-test="logs-search-no-field-found-text"]').text()).toBe(
      "Nothing here",
    );
    source.loading.value = true;
    return wrapper.vm.$nextTick().then(() => {
      expect(wrapper.find('[data-test="logs-indexlist-fieldlist-loading-skeleton"]').exists()).toBe(
        true,
      );
    });
  });

  it("stores the collapsed groups on the source", async () => {
    const source = makeSource();
    wrapper = mountPanel(CAPS, source);
    await wrapper.find('[data-test="o-field-list-group-g"] > div').trigger("click");
    expect(source.collapsedGroups.value.has("g")).toBe(true);
  });

  it("shows the skeleton, not the no-stream state, while a page with no stream yet is loading", () => {
    const source = makeSource(FIELDS, []);
    source.loading.value = true;
    wrapper = mountPanel({ ...CAPS, streamPicker: "single" }, source);
    expect(wrapper.find('[data-test="stream-field-panel-no-stream"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="stream-field-panel-skeleton"]').exists()).toBe(true);
  });

  it("renders a page's chips with their ids, tooltips and intent", async () => {
    const source = makeSource();
    source.chips = vi.fn(() => [
      { label: "+X" as never, testId: "chip-x", target: "x", tooltip: "X-Axis" as never },
      { label: "+F" as never, testId: "chip-f", target: "f", disabled: true },
    ]);
    source.chip = vi.fn();
    wrapper = mountPanel({ ...CAPS, actions: ["chips"] }, source);
    const chip = wrapper.find('[data-test="chip-x"]');
    expect(chip.findComponent({ name: "OTooltip" }).props("content")).toBe("X-Axis");
    expect(wrapper.find('[data-test="chip-f"]').attributes("aria-disabled")).toBe("true");
    await chip.trigger("click");
    expect(source.chip).toHaveBeenCalledWith(expect.objectContaining({ name: "alpha" }), "x");
  });

  it("keeps a full chip disabled but hoverable and focusable, with its reason as the tooltip", async () => {
    const source = makeSource([header("g"), field("alpha")]);
    source.chips = vi.fn(() => [
      {
        label: "+B" as never,
        testId: "chip-b",
        target: "breakdown",
        tooltip: "Breakdown" as never,
        disabled: true,
        reason: "Breakdown is full for this chart" as never,
      },
    ]);
    source.chip = vi.fn();
    wrapper = mountPanel({ ...CAPS, actions: ["chips"] }, source);
    const chip = wrapper.find('[data-test="chip-b"]');
    expect(chip.attributes("disabled")).toBeUndefined();
    expect(chip.attributes("aria-disabled")).toBe("true");
    expect(chip.classes()).toContain("text-text-disabled");
    expect(chip.findComponent({ name: "OTooltip" }).props("content")).toBe(
      "Breakdown is full for this chart",
    );
    const reasonId = chip.attributes("aria-describedby");
    expect(document.getElementById(String(reasonId))?.textContent).toBe(
      "Breakdown is full for this chart",
    );
    (chip.element as HTMLElement).focus();
    expect(document.activeElement).toBe(chip.element);
    await chip.trigger("click");
    expect(source.chip).not.toHaveBeenCalled();
    expect(source.openField).not.toHaveBeenCalled();
  });

  describe("value selection", () => {
    const VALUES = {
      values: [{ key: "a", count: 3 }],
      isLoading: false,
      hasMore: false,
      errMsg: "",
    };

    const openWithValues = (fields: PanelField[], selected: string[]) => {
      const source = makeSource([header("g"), ...fields], selected);
      source.expandedFields.value = fields.map((row) => row.name);
      source.fieldValues.value = Object.fromEntries(fields.map((row) => [row.name, VALUES]));
      return source;
    };

    const checkboxesOf = (name: string) =>
      wrapper.findAll(`[data-test="o-field-list-expansion-${name}"] [role="checkbox"]`);

    it("offers checkboxes with one selected stream although the field lists no stream", async () => {
      const source = openWithValues([field("alpha", { streams: [] })], ["s1"]);
      wrapper = mountPanel(CAPS, source);
      expect(checkboxesOf("alpha")).toHaveLength(1);
      await checkboxesOf("alpha")[0].trigger("click");
      expect(source.addValueFilters).toHaveBeenCalledWith("alpha", ["a"], []);
    });

    it("offers checkboxes on a page with no picker and no selected stream", () => {
      const source = openWithValues([field("alpha", { streams: [] })], []);
      wrapper = mountPanel(CAPS, source);
      expect(checkboxesOf("alpha")).toHaveLength(1);
    });

    it("offers checkboxes with several streams only on fields every selected stream has", () => {
      const source = openWithValues(
        [field("alpha", { streams: ["s1", "s2"] }), field("beta", { streams: ["s1"] })],
        ["s1", "s2"],
      );
      wrapper = mountPanel(CAPS, source);
      expect(checkboxesOf("alpha")).toHaveLength(1);
      expect(checkboxesOf("beta")).toHaveLength(0);
    });
  });

  describe("interesting action", () => {
    const LOGS_ACTIONS: FieldPanelCapabilities = {
      ...CAPS,
      actions: ["add-filter", "toggle-column", "interesting"],
    };

    const mountLogsRow = () => {
      const source = makeSource([header("g"), field("alpha", { isInterestingField: true })]);
      source.toggleColumn = vi.fn();
      source.toggleInteresting = vi.fn();
      wrapper = mountPanel(LOGS_ACTIONS, source);
      return source;
    };

    it("renders the interesting button once, as the strip's last action after filter and column", () => {
      mountLogsRow();
      const row = wrapper.find('[data-test="o-field-list-row-alpha"]');
      expect(
        row.findAll('[data-test="log-search-index-list-interesting-alpha-field-btn"]'),
      ).toHaveLength(1);
      const strips = row.findAll(".o-field-row__actions");
      expect(strips).toHaveLength(1);
      expect(strips[0].findAll("button").map((button) => button.attributes("data-test"))).toEqual([
        "log-search-index-list-filter-alpha-field-btn",
        "log-search-index-list-add-alpha-field-btn",
        "log-search-index-list-interesting-alpha-field-btn",
      ]);
    });

    const interestingWrap = () =>
      wrapper.find('[data-test="log-search-index-list-interesting-alpha-field-btn"]').element
        .parentElement as HTMLElement;

    it("shows a filled interesting mark at rest only on an interesting field (U13)", () => {
      mountLogsRow();
      const strip = wrapper.find('[data-test="o-field-list-row-alpha"] .o-field-row__actions');
      const hoverOnly = strip.find("span.sr-only");
      expect(hoverOnly.classes()).toEqual(
        expect.arrayContaining([
          "group-hover:contents",
          "group-focus-visible:contents",
          "group-has-[:focus-visible]:contents",
        ]),
      );
      expect(hoverOnly.findAll("button")).toHaveLength(2);
      expect(interestingWrap().className).toBe("contents");
      expect(interestingWrap().parentElement).toBe(strip.element);
    });

    it("keeps the outline toggle of a plain field in the hover and focus strip only (U13)", () => {
      const source = makeSource([header("g"), field("alpha")]);
      source.toggleInteresting = vi.fn();
      wrapper = mountPanel(LOGS_ACTIONS, source);
      expect(interestingWrap().classList).toContain("sr-only");
      expect([...interestingWrap().classList]).toEqual(
        expect.arrayContaining([
          "group-hover:contents",
          "group-focus-visible:contents",
          "group-has-[:focus-visible]:contents",
          "max-md:contents",
        ]),
      );
    });

    it("offers no interesting toggle when the page leaves it out, as logs does outside quick mode (U13)", () => {
      wrapper = mountPanel(
        { ...CAPS, actions: ["add-filter", "toggle-column"] },
        makeSource([header("g"), field("alpha", { isInterestingField: true })]),
      );
      expect(
        wrapper.find('[data-test="log-search-index-list-interesting-alpha-field-btn"]').exists(),
      ).toBe(false);
    });

    it("shows the action strip on hover and keyboard focus, never on focus a mouse click left (P3)", () => {
      mountLogsRow();
      const strip = wrapper.find('[data-test="o-field-list-row-alpha"] .o-field-row__actions');
      const classes = [...strip.element.classList, ...strip.find("span.sr-only").classes()];
      expect(classes.some((name) => name.startsWith("group-focus-within:"))).toBe(false);
      expect(classes).toEqual(
        expect.arrayContaining([
          "group-hover:absolute",
          "group-focus-visible:absolute",
          "group-has-[:focus-visible]:absolute",
        ]),
      );
    });

    it("keeps every row action in the tab order, right after its row and in visual order (K1)", () => {
      const source = makeSource([
        header("g"),
        field("alpha", { isInterestingField: true }),
        field("beta"),
      ]);
      source.toggleColumn = vi.fn();
      source.toggleInteresting = vi.fn();
      wrapper = mountPanel(LOGS_ACTIONS, source);
      const row = wrapper.find('[data-test="o-field-list-row-alpha"]').element;
      const strip = wrapper.find('[data-test="o-field-list-row-alpha"] .o-field-row__actions');
      for (const el of [strip.element, ...strip.findAll("span, button").map((w) => w.element)]) {
        expect([...el.classList]).not.toContain("hidden");
        expect([...el.classList]).not.toContain("invisible");
      }
      const focusable = [
        ...wrapper.element.querySelectorAll<HTMLElement>('[tabindex="0"], button:not([disabled])'),
      ];
      const start = focusable.indexOf(row as HTMLElement);
      expect(focusable.slice(start, start + 5).map((el) => el.getAttribute("data-test"))).toEqual([
        "o-field-list-row-alpha",
        "log-search-index-list-filter-alpha-field-btn",
        "log-search-index-list-add-alpha-field-btn",
        "log-search-index-list-interesting-alpha-field-btn",
        "o-field-list-row-beta",
      ]);
    });

    it("hides a strip with no trailing action by opacity, so its buttons stay focusable (K1)", () => {
      wrapper = mountPanel({ ...CAPS, actions: ["add-filter", "toggle-column"] });
      const strip = wrapper.find('[data-test="o-field-list-row-alpha"] .o-field-row__actions');
      expect(strip.classes()).toEqual(
        expect.arrayContaining([
          "opacity-0",
          "pointer-events-none",
          "group-focus-visible:opacity-100",
          "group-has-[:focus-visible]:opacity-100",
          "group-has-[:focus-visible]:pointer-events-auto",
        ]),
      );
      expect(strip.classes()).not.toContain("hidden");
      expect(strip.classes().some((name) => name.startsWith("group-focus-within:"))).toBe(false);
    });

    it("gives every icon-only row action a tooltip with its label (U11)", () => {
      mountLogsRow();
      const strip = wrapper.find('[data-test="o-field-list-row-alpha"] .o-field-row__actions');
      const buttons = strip.findAll("button");
      expect(buttons).toHaveLength(3);
      for (const button of buttons) {
        const tooltip = button.findComponent({ name: "OTooltip" });
        expect(tooltip.exists()).toBe(true);
        expect(tooltip.props("content")).toBe(button.attributes("aria-label"));
      }
    });

    it("toggles interesting, not the column, from the interesting button", async () => {
      const source = mountLogsRow();
      await wrapper
        .find('[data-test="log-search-index-list-interesting-alpha-field-btn"]')
        .trigger("click");
      expect(source.toggleInteresting).toHaveBeenCalledWith(
        expect.objectContaining({ name: "alpha" }),
      );
      expect(source.toggleColumn).not.toHaveBeenCalled();
    });
  });

  it("drags only rows the source allows and reports start and end", async () => {
    const source = makeSource();
    source.dragEnabled = vi.fn((row: PanelField) => row.name !== "beta");
    source.dragStart = vi.fn();
    source.dragEnd = vi.fn();
    wrapper = mountPanel({ ...CAPS, drag: true }, source);
    const row = (name: string) => wrapper.find(`[data-test="o-field-list-row-${name}"]`);
    const grip = (name: string) => row(name).find('[data-test="o-field-list-drag-indicator"]');
    expect(grip("beta").classes()).toContain("cursor-not-allowed");
    expect(grip("alpha").findComponent({ name: "OTooltip" }).props("content")).toBe(
      "Drag to an axis",
    );
    expect(grip("beta").findComponent({ name: "OTooltip" }).exists()).toBe(false);
    await grip("alpha").trigger("mousedown");
    expect(row("alpha").attributes("draggable")).toBe("true");
    await row("alpha").trigger("dragstart");
    await row("alpha").trigger("dragend");
    expect(source.dragStart).toHaveBeenCalledWith(
      expect.objectContaining({ name: "alpha" }),
      expect.anything(),
    );
    expect(source.dragEnd).toHaveBeenCalledWith(
      expect.objectContaining({ name: "alpha" }),
      expect.anything(),
    );
  });

  it("keys expansion, values and filters by the source's row key when names repeat", async () => {
    const twin = (uid: string, group: string) => field("status", { _uid: uid, group });
    const source = makeSource([
      header("a"),
      twin("a:status", "a"),
      header("b"),
      twin("b:status", "b"),
    ]);
    source.rowKey = "_uid";
    source.openField = vi.fn((row: PanelField) => {
      source.expandedFields.value = [String(row._uid)];
    });
    source.fieldValues.value = {
      "b:status": {
        values: [{ key: "x", count: 1 }],
        isLoading: false,
        hasMore: false,
        errMsg: "",
      },
    };
    wrapper = mountPanel(CAPS, source);
    await wrapper.findAll('[data-test="o-field-list-row-status"]')[1].trigger("click");
    expect(source.openField).toHaveBeenCalledWith(expect.objectContaining({ _uid: "b:status" }));
    expect(wrapper.findAll('[data-test="o-field-list-expansion-status"]')).toHaveLength(1);
    wrapper
      .findComponent({ name: "FieldValuesPanel" })
      .vm.$emit("set-value-filters", "status", ["x"], ["y"]);
    wrapper.findComponent({ name: "FieldValuesPanel" }).vm.$emit("load-more-values", "status");
    expect(source.addValueFilters).toHaveBeenCalledWith("b:status", ["x"], ["y"]);
    expect(source.loadMoreValues).toHaveBeenCalledWith("b:status");
  });
});
