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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";


vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn().mockResolvedValue({ data: { hits: [] } }),
  },
}));

vi.mock("@/composables/useQuery", () => ({
  default: () => ({
    buildQueryPayload: vi.fn().mockReturnValue({
      query: { sql: "", size: 10, sql_mode: true, query_fn: null, per_query_response: true },
    }),
  }),
}));

vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock("@/utils/alerts/alertSqlUtils", () => ({
  getParser: vi.fn().mockReturnValue(null),
}));

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "false", isCloud: "false", isAiEnabled: "false" },
}));

import QueryEditorDialog from "@/components/alerts/QueryEditorDialog.vue";

const childEditorStub = {
  template: '<div class="stub-editor"></div>',
  props: ["query", "editorId", "language", "readOnly"],
  emits: ["update:query", "blur"],
};

const unifiedEditorStub = {
  template: '<div class="stub-unified-editor"></div>',
  props: ["query", "editorId", "streamName", "streamType"],
  emits: ["update:query", "blur"],
};

async function mountComp(props: Record<string, any> = {}) {
  return mount(QueryEditorDialog, {
    props: {
      modelValue: true,
      tab: "sql",
      sqlQuery: "",
      promqlQuery: "",
      vrlFunction: "",
      streamName: "my-stream",
      streamType: "logs",
      columns: [
        { label: "host", value: "host" },
        { label: "level", value: "level" },
      ],
      period: 10,
      multiTimeRange: [],
      savedFunctions: [],
      sqlQueryErrorMsg: "",
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        CodeQueryEditor: childEditorStub,
        QueryEditor: childEditorStub,
        UnifiedQueryEditor: unifiedEditorStub,
        FullViewContainer: {
          template: '<div><slot /><slot name="right" /></div>',
          props: ["name", "label", "isExpanded"],
          emits: ["update:isExpanded"],
        },
        O2AIChat: {
          template: '<div class="stub-ai-chat"></div>',
          props: ["headerHeight", "isOpen"],
          emits: ["close"],
        },
      },
    },
  });
}

describe("QueryEditorDialog - rendering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders without errors", async () => {
    const w = await mountComp();
    await flushPromises();
    expect(w.exists()).toBe(true);
  });

  it("renders when modelValue is true", async () => {
    const w = await mountComp({ modelValue: true });
    await flushPromises();
    expect(w.html()).toBeTruthy();
  });
});

describe("QueryEditorDialog - initial state", () => {
  it("localTab defaults to sql", async () => {
    const w = await mountComp({ tab: "sql" });
    await flushPromises();
    expect((w.vm as any).localTab).toBe("sql");
  });

  it("localTab uses provided tab prop", async () => {
    const w = await mountComp({ tab: "promql" });
    await flushPromises();
    expect((w.vm as any).localTab).toBe("promql");
  });

  it("localSqlQuery initialized from props.sqlQuery", async () => {
    const w = await mountComp({ sqlQuery: "SELECT * FROM stream" });
    await flushPromises();
    expect((w.vm as any).localSqlQuery).toBe("SELECT * FROM stream");
  });

  it("localPromqlQuery initialized from props.promqlQuery", async () => {
    const w = await mountComp({ promqlQuery: "rate(metric[5m])" });
    await flushPromises();
    expect((w.vm as any).localPromqlQuery).toBe("rate(metric[5m])");
  });

  it("vrlFunctionContent initialized from props.vrlFunction", async () => {
    const w = await mountComp({ vrlFunction: ".level = upcase(.level)" });
    await flushPromises();
    expect((w.vm as any).vrlFunctionContent).toBe(".level = upcase(.level)");
  });

  it("functionOptions initialized from props.savedFunctions", async () => {
    const w = await mountComp({ savedFunctions: [{ name: "fn1" }, { name: "fn2" }] });
    await flushPromises();
    expect((w.vm as any).functionOptions).toHaveLength(2);
  });

  it("expandSqlOutput defaults to true", async () => {
    const w = await mountComp();
    expect((w.vm as any).expandSqlOutput).toBe(true);
  });

  it("expandCombinedOutput defaults to true", async () => {
    const w = await mountComp();
    expect((w.vm as any).expandCombinedOutput).toBe(true);
  });
});

describe("QueryEditorDialog - closeDialog", () => {
  it("emits update:modelValue with false", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).closeDialog();
    expect(w.emitted("update:modelValue")).toBeTruthy();
    expect((w.emitted("update:modelValue") as any[][])[0][0]).toBe(false);
  });
});

describe("QueryEditorDialog - updateSqlQuery", () => {
  it("updates localSqlQuery", async () => {
    const w = await mountComp();
    (w.vm as any).updateSqlQuery("SELECT count(*) FROM logs");
    expect((w.vm as any).localSqlQuery).toBe("SELECT count(*) FROM logs");
  });

  it("emits update:sqlQuery with new value", async () => {
    const w = await mountComp();
    (w.vm as any).updateSqlQuery("SELECT count(*) FROM logs");
    expect(w.emitted("update:sqlQuery")).toBeTruthy();
    expect((w.emitted("update:sqlQuery") as any[][])[0][0]).toBe("SELECT count(*) FROM logs");
  });
});

describe("QueryEditorDialog - updatePromqlQuery", () => {
  it("updates localPromqlQuery", async () => {
    const w = await mountComp();
    (w.vm as any).updatePromqlQuery("rate(http_requests[5m])");
    expect((w.vm as any).localPromqlQuery).toBe("rate(http_requests[5m])");
  });

  it("emits update:promqlQuery", async () => {
    const w = await mountComp();
    (w.vm as any).updatePromqlQuery("rate(http_requests[5m])");
    expect(w.emitted("update:promqlQuery")).toBeTruthy();
  });
});

describe("QueryEditorDialog - updateVrlFunction", () => {
  it("updates vrlFunctionContent", async () => {
    const w = await mountComp();
    (w.vm as any).updateVrlFunction(".level = upcase(.level)");
    expect((w.vm as any).vrlFunctionContent).toBe(".level = upcase(.level)");
  });

  it("emits update:vrlFunction", async () => {
    const w = await mountComp();
    (w.vm as any).updateVrlFunction(".level = upcase(.level)");
    expect(w.emitted("update:vrlFunction")).toBeTruthy();
  });
});

// The saved-functions OSelect is configured with valueKey="name", so it emits
// the function NAME, never the option object. These tests must pass a name —
// passing an object here is what let the "select does nothing" bug through.
describe("QueryEditorDialog - onFunctionSelect", () => {
  const FUNCS = [
    { name: "myFn", function: ".level = upcase(.level)" },
    { name: "otherFn", function: ".a = 1" },
  ];

  it("sets vrlFunctionContent from the selected function's body", async () => {
    const w = await mountComp({ savedFunctions: FUNCS });
    (w.vm as any).onFunctionSelect("myFn");
    expect((w.vm as any).vrlFunctionContent).toBe(".level = upcase(.level)");
  });

  it("emits update:vrlFunction so the parent form keeps the selection", async () => {
    const w = await mountComp({ savedFunctions: FUNCS });
    (w.vm as any).onFunctionSelect("myFn");
    expect(w.emitted("update:vrlFunction")?.at(-1)).toEqual([
      ".level = upcase(.level)",
    ]);
  });

  it("replaces the body when switching to a different function", async () => {
    const w = await mountComp({ savedFunctions: FUNCS });
    (w.vm as any).onFunctionSelect("myFn");
    (w.vm as any).onFunctionSelect("otherFn");
    expect((w.vm as any).vrlFunctionContent).toBe(".a = 1");
  });

  it("falls back to `body` when the function has no `function` field", async () => {
    const w = await mountComp({ savedFunctions: [{ name: "bodyFn", body: ".b = 2" }] });
    (w.vm as any).onFunctionSelect("bodyFn");
    expect((w.vm as any).vrlFunctionContent).toBe(".b = 2");
  });

  it("does nothing when the name matches no saved function", async () => {
    const w = await mountComp({ vrlFunction: "existing", savedFunctions: FUNCS });
    (w.vm as any).onFunctionSelect("nope");
    expect((w.vm as any).vrlFunctionContent).toBe("existing");
  });
});

describe("QueryEditorDialog - onFunctionClear", () => {
  it("clears vrlFunctionContent", async () => {
    const w = await mountComp({ vrlFunction: ".level = upcase(.level)" });
    (w.vm as any).onFunctionClear();
    expect((w.vm as any).vrlFunctionContent).toBe("");
  });

  it("clears selectedFunction", async () => {
    const w = await mountComp();
    (w.vm as any).selectedFunction = { name: "myFn" };
    (w.vm as any).onFunctionClear();
    expect((w.vm as any).selectedFunction).toBeNull();
  });
});

describe("QueryEditorDialog - buildMultiWindowQuery", () => {
  it("returns empty array when multiTimeRange is empty", async () => {
    const w = await mountComp({ multiTimeRange: [] });
    const result = (w.vm as any).buildMultiWindowQuery("SELECT * FROM logs", false, 600000000);
    expect(result).toEqual([]);
  });

  it("builds queries for each multiTimeRange entry", async () => {
    const w = await mountComp({
      multiTimeRange: [{ offSet: "1h" }, { offSet: "24h" }],
    });
    const result = (w.vm as any).buildMultiWindowQuery("SELECT * FROM logs", false, 600000000);
    expect(result).toHaveLength(2);
  });

  it("includes sql in each query", async () => {
    const w = await mountComp({
      multiTimeRange: [{ offSet: "1h" }],
    });
    const result = (w.vm as any).buildMultiWindowQuery("SELECT count(*) FROM logs", false, 600000000);
    expect(result[0].sql).toBe("SELECT count(*) FROM logs");
  });

  it("ignores entries with invalid offset format", async () => {
    const w = await mountComp({
      multiTimeRange: [{ offSet: "invalid-format" }],
    });
    const result = (w.vm as any).buildMultiWindowQuery("SELECT * FROM logs", false, 600000000);
    expect(result).toHaveLength(0);
  });
});

describe("QueryEditorDialog - prop watchers", () => {
  it("updates localTab when tab prop changes", async () => {
    const w = await mountComp({ tab: "sql" });
    await flushPromises();
    await w.setProps({ tab: "promql" });
    await flushPromises();
    expect((w.vm as any).localTab).toBe("promql");
  });

  it("updates localSqlQuery when sqlQuery prop changes", async () => {
    const w = await mountComp({ sqlQuery: "SELECT 1" });
    await flushPromises();
    await w.setProps({ sqlQuery: "SELECT count(*) FROM logs" });
    await flushPromises();
    expect((w.vm as any).localSqlQuery).toBe("SELECT count(*) FROM logs");
  });

  it("updates localPromqlQuery when promqlQuery prop changes", async () => {
    const w = await mountComp({ promqlQuery: "" });
    await flushPromises();
    await w.setProps({ promqlQuery: "rate(http[5m])" });
    await flushPromises();
    expect((w.vm as any).localPromqlQuery).toBe("rate(http[5m])");
  });

  it("updates vrlFunctionContent when vrlFunction prop changes", async () => {
    const w = await mountComp({ vrlFunction: "" });
    await flushPromises();
    await w.setProps({ vrlFunction: ".level = downcase(.level)" });
    await flushPromises();
    expect((w.vm as any).vrlFunctionContent).toBe(".level = downcase(.level)");
  });

  it("updates functionOptions when savedFunctions prop changes", async () => {
    const w = await mountComp({ savedFunctions: [] });
    await flushPromises();
    await w.setProps({ savedFunctions: [{ name: "newFn" }] });
    await flushPromises();
    expect((w.vm as any).functionOptions).toHaveLength(1);
    expect((w.vm as any).functionOptions[0].name).toBe("newFn");
  });
});

describe("QueryEditorDialog - onBlurFunctionEditor", () => {
  it("sets functionEditorPlaceholderFlag to true when vrl is empty", async () => {
    const w = await mountComp({ vrlFunction: "" });
    (w.vm as any).onBlurFunctionEditor();
    expect((w.vm as any).functionEditorPlaceholderFlag).toBe(true);
  });

  it("sets functionEditorPlaceholderFlag to false when vrl is not empty", async () => {
    const w = await mountComp({ vrlFunction: ".level = upcase(.level)" });
    (w.vm as any).onBlurFunctionEditor();
    expect((w.vm as any).functionEditorPlaceholderFlag).toBe(false);
  });
});

// Coverage for the dialog → ODrawer migration. The template now renders
// <ODrawer v-model:open="isOpen" size="full" :show-close="false"> where
// isOpen is a computed get/set bound to the modelValue prop.
describe("QueryEditorDialog - ODrawer Migration", () => {
  // Lightweight stub mirroring ODrawer's migrated prop surface so we can
  // assert the open/size/showClose contract without pulling in reka-ui.
  const ODrawerStub = {
    name: "ODrawer",
    props: {
      open: { type: Boolean, default: false },
      size: { type: String, default: undefined },
      showClose: { type: Boolean, default: true },
      title: { type: String, default: undefined },
      persistent: { type: Boolean, default: false },
      width: { type: [String, Number], default: undefined },
    },
    emits: ["update:open"],
    template: `
      <div
        data-test="o-drawer-stub"
        :data-open="String(open)"
        :data-size="size"
        :data-show-close="String(!!showClose)"
      >
        <slot name="header" />
        <slot name="header-left" />
        <slot name="header-right" />
        <slot />
        <slot name="footer" />
        <button
          data-test="o-drawer-stub-close"
          @click="$emit('update:open', false)"
        >close</button>
      </div>
    `,
  };

  async function mountWithDrawerStub(props: Record<string, any> = {}) {
    return mount(QueryEditorDialog, {
      props: {
        modelValue: true,
        tab: "sql",
        sqlQuery: "",
        promqlQuery: "",
        vrlFunction: "",
        streamName: "my-stream",
        streamType: "logs",
        columns: [],
        period: 10,
        multiTimeRange: [],
        savedFunctions: [],
        sqlQueryErrorMsg: "",
        ...props,
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          ODrawer: ODrawerStub,
          CodeQueryEditor: childEditorStub,
          QueryEditor: childEditorStub,
          UnifiedQueryEditor: unifiedEditorStub,
          FullViewContainer: {
            template: '<div><slot /><slot name="right" /></div>',
            props: ["name", "label", "isExpanded"],
            emits: ["update:isExpanded"],
          },
          O2AIChat: {
            template: '<div class="stub-ai-chat"></div>',
            props: ["headerHeight", "isOpen"],
            emits: ["close"],
          },
        },
      },
    });
  }

  beforeEach(() => vi.clearAllMocks());

  it("renders exactly one ODrawer at the root of the template", async () => {
    const w = await mountWithDrawerStub();
    await flushPromises();
    const drawers = w.findAllComponents(ODrawerStub);
    expect(drawers.length).toBe(1);
  });

  it("forwards modelValue=true to ODrawer's open prop", async () => {
    const w = await mountWithDrawerStub({ modelValue: true });
    await flushPromises();
    const drawer = w.findComponent(ODrawerStub);
    expect(drawer.props("open")).toBe(true);
  });

  it("forwards modelValue=false to ODrawer's open prop", async () => {
    const w = await mountWithDrawerStub({ modelValue: false });
    await flushPromises();
    const drawer = w.findComponent(ODrawerStub);
    expect(drawer.props("open")).toBe(false);
  });

  it("reflects modelValue prop changes onto ODrawer's open prop", async () => {
    const w = await mountWithDrawerStub({ modelValue: true });
    await flushPromises();
    let drawer = w.findComponent(ODrawerStub);
    expect(drawer.props("open")).toBe(true);

    await w.setProps({ modelValue: false });
    await flushPromises();
    drawer = w.findComponent(ODrawerStub);
    expect(drawer.props("open")).toBe(false);
  });

  it('renders ODrawer with size="full"', async () => {
    const w = await mountWithDrawerStub();
    await flushPromises();
    const drawer = w.findComponent(ODrawerStub);
    expect(drawer.props("size")).toBe("full");
  });

  it("renders ODrawer with :show-close=\"false\"", async () => {
    const w = await mountWithDrawerStub();
    await flushPromises();
    const drawer = w.findComponent(ODrawerStub);
    expect(drawer.props("showClose")).toBe(false);
  });

  it("emits update:modelValue=false when ODrawer emits update:open=false", async () => {
    const w = await mountWithDrawerStub({ modelValue: true });
    await flushPromises();
    const drawer = w.findComponent(ODrawerStub);
    await drawer.vm.$emit("update:open", false);
    await flushPromises();
    const emitted = w.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1]).toEqual([false]);
  });

  it("emits update:modelValue=true when ODrawer emits update:open=true", async () => {
    const w = await mountWithDrawerStub({ modelValue: false });
    await flushPromises();
    const drawer = w.findComponent(ODrawerStub);
    await drawer.vm.$emit("update:open", true);
    await flushPromises();
    const emitted = w.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1]).toEqual([true]);
  });

  it("emits update:modelValue=false when the back button inside the drawer is clicked (closeDialog path)", async () => {
    const w = await mountWithDrawerStub({ modelValue: true });
    await flushPromises();
    const backBtn = w.find('[data-test="add-alert-back-btn"]');
    expect(backBtn.exists()).toBe(true);
    await backBtn.trigger("click");
    await flushPromises();
    const emitted = w.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1]).toEqual([false]);
  });

  it("renders the dialog body content (drawer default slot) inside the ODrawer", async () => {
    const w = await mountWithDrawerStub();
    await flushPromises();
    const drawer = w.findComponent(ODrawerStub);
    // the dialog card lives inside the drawer's default slot
    expect(
      drawer.find('[data-test="query-editor-dialog-card"]').exists(),
    ).toBe(true);
  });

  it("renders ODrawer as the migration wrapper (migration completed)", async () => {
    const w = await mountWithDrawerStub();
    await flushPromises();
    expect(w.findComponent(ODrawerStub).exists()).toBe(true);
  });
});
