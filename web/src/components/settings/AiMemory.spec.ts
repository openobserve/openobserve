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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import aiMemory from "@/services/ai_memory";
import AiMemory from "./AiMemory.vue";

vi.mock("@/services/ai_memory", () => ({
  default: {
    get: vi.fn(),
    update: vi.fn(),
    pending: vi.fn(),
    accept: vi.fn(() => Promise.resolve({ data: { results: [] } })),
    discard: vi.fn(() => Promise.resolve({ data: { results: [] } })),
    revisions: vi.fn(),
    revision: vi.fn(),
    revert: vi.fn(() => Promise.resolve({})),
  },
}));
vi.mock("@/services/ai_toolsets", () => ({
  default: {
    list: vi.fn(() =>
      Promise.resolve({ data: { toolsets: [{ id: "ts1", name: "grafana", kind: "mcp" }] } }),
    ),
  },
}));

// A light OTable: rows through cell slots, selection, row actions, loading and error states.
const OTableStub = defineComponent({
  props: [
    "data",
    "columns",
    "loading",
    "error",
    "selection",
    "selectedIds",
    "rowActions",
    "rowKey",
  ],
  inheritAttrs: false,
  emits: ["row-click", "update:selectedIds", "retry"],
  setup(props, { slots, emit }) {
    return () => {
      if (props.loading) return h("div", { "data-test": "table-loading" });
      if (props.error)
        return h("div", { "data-test": "table-error" }, [
          props.error,
          h("button", { "data-test": "table-retry", onClick: () => emit("retry") }),
        ]);
      if (!props.data.length) return h("div", { "data-test": "table-empty" }, slots.empty?.());
      return h("div", [
        slots["toolbar"]?.(),
        slots["toolbar-trailing"]?.(),
        props.selectedIds?.length ? h("div", slots["selection-actions"]?.()) : null,
        ...props.data.map((row: any) =>
          h("div", { "data-test": "row", onClick: () => emit("row-click", row) }, [
            props.selection === "multiple"
              ? h("input", {
                  type: "checkbox",
                  "data-test": "row-select",
                  onClick: (e: Event) => e.stopPropagation(),
                  onChange: () =>
                    emit("update:selectedIds", [...props.selectedIds, row[props.rowKey]]),
                })
              : null,
            ...props.columns
              .filter((c: any) => !c.isAction)
              .map((c: any) =>
                slots[`cell-${c.id}`]
                  ? h("span", slots[`cell-${c.id}`]!({ row }))
                  : h("span", String(row[c.accessorKey] ?? "")),
              ),
            ...(props.rowActions ?? [])
              .filter((a: any) => a.visible?.(row) ?? true)
              .map((a: any) =>
                h("button", {
                  "data-test": a.dataTest(row),
                  onClick: (e: Event) => {
                    e.stopPropagation();
                    a.onSelect(row);
                  },
                }),
              ),
          ]),
        ),
      ]);
    };
  },
});

const ODialogStub = defineComponent({
  props: ["open", "title", "primaryButtonLabel", "secondaryButtonLabel", "primaryButtonDataTest"],
  emits: ["click:primary", "click:secondary", "update:open"],
  setup(props, { slots, emit, attrs }) {
    return () =>
      props.open
        ? h("div", { "data-test": attrs["data-test"] }, [
            h("h2", props.title),
            slots["header-right"]?.(),
            slots.default?.(),
            slots.footer?.(),
            props.secondaryButtonLabel
              ? h("button", {
                  "data-test": "dlg-secondary",
                  onClick: () => emit("click:secondary"),
                })
              : null,
            props.primaryButtonLabel
              ? h("button", {
                  "data-test": props.primaryButtonDataTest ?? "dlg-primary",
                  onClick: () => emit("click:primary"),
                })
              : null,
          ])
        : null;
  },
});

const editorStub = defineComponent({
  props: ["target", "title", "embedded", "formId"],
  expose: [],
  emits: ["saved"],
  setup:
    (_p, { emit }) =>
    () =>
      h("button", { "data-test": "editor", onClick: () => emit("saved") }),
});

const pendingEdit = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  rev: null,
  state: "pending",
  base_rev: 1,
  edits: [{ op: "replace", old: "a", new: "b" }],
  updated_by: "agent:s/t",
  reason: "seen in RCA",
  evidence: null,
  origin_region: "",
  op_id: id,
  created_at: 1_700_000_000_000_000,
  flags: [],
  scope: "org",
  scope_key: "",
  ...extra,
});

const memory = (extra: Record<string, unknown> = {}) => ({
  scope: "org",
  content: "old text",
  rev: 2,
  size_bytes: 2048,
  max_bytes: 16384,
  agent_memory_writes: null,
  agent_memory_writes_effective: "review",
  pending_count: 3,
  updated_at: 1_700_000_000_000_000,
  can_apply: true,
  ...extra,
});

const setup = (canApply = true) => {
  vi.mocked(aiMemory.get).mockResolvedValue({ data: memory({ can_apply: canApply }) } as any);
  vi.mocked(aiMemory.pending).mockResolvedValue({
    data: {
      pending: [
        pendingEdit("p1", { flags: ["states_absence"] }),
        pendingEdit("p2", { flags: ["suppression_text"] }),
        pendingEdit("p3", { scope: "toolset", scope_key: "ts1" }),
      ],
    },
  } as any);
  vi.mocked(aiMemory.revisions).mockResolvedValue({
    data: {
      revisions: [
        { ...pendingEdit("r2"), state: "applied", rev: 2, edits: null, content: "new" },
        { ...pendingEdit("r1"), state: "applied", rev: 1, edits: null, content: "old" },
      ],
    },
  } as any);
  vi.mocked(aiMemory.revision).mockImplementation(
    (_o, _t, id) =>
      Promise.resolve({
        data: {
          ...pendingEdit(id),
          state: "applied",
          rev: id === "r2" ? 2 : 1,
          edits: null,
          content: id === "r2" ? "new" : "old",
        },
      }) as any,
  );
};

const mountPage = async () => {
  const w = mount(AiMemory, {
    global: {
      plugins: [i18n, store, router],
      provide: { store },
      stubs: {
        OPageLayout: { template: "<div><slot name='actions' /><slot /></div>" },
        OTable: OTableStub,
        ODialog: ODialogStub,
        ODrawer: ODialogStub,
        AiMemoryEditor: editorStub,
        ConfirmDialog: {
          props: ["modelValue"],
          emits: ["update:ok", "update:cancel"],
          template:
            "<div v-if='modelValue' data-test='confirm'><button data-test='confirm-ok' @click=\"$emit('update:ok')\" /></div>",
        },
        DiffViewer: {
          props: ["original", "modified"],
          template: "<div data-test='diff'>{{ original }}>{{ modified }}</div>",
        },
        ODropdown: {
          template: "<div><slot name='trigger' /><div data-test='menu'><slot /></div></div>",
        },
        ODropdownItem: {
          emits: ["select"],
          template: "<div role='option' @click=\"$emit('select')\"><slot /></div>",
        },
        ORefreshButton: true,
        OTimeCell: true,
      },
    },
  });
  await flushPromises();
  return w;
};

const openPending = async (w: any) => {
  await w.find('[data-test="ai-memory-review-pending-btn"]').trigger("click");
  await flushPromises();
};
const pendingRowEls = (w: any) =>
  w.findAll('[data-test="ai-memory-pending-drawer"] [data-test="row"]');
const openHistory = async (w: any, idx = 0) => {
  await w
    .findAll('[data-test="row"]')
    [idx].find(idx ? '[data-test="ai-memory-ts1-history"]' : '[data-test="ai-memory-org-history"]')
    .trigger("click");
  await flushPromises();
};

describe("AiMemory page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the org memory and each toolset memory and opens one in the drawer", async () => {
    setup();
    const w = await mountPage();
    const rows = w.findAll('[data-test="row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("2.0 KiB / 16.0 KiB");
    expect(rows[1].text()).toContain("grafana");
    await rows[1].trigger("click");
    expect(w.find('[data-test="ai-memory-drawer"] h2').text()).toBe("grafana");
    expect(w.find('[data-test="editor"]').exists()).toBe(true);
    await w.find('[data-test="editor"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="ai-memory-drawer"]').exists()).toBe(false);
    expect(aiMemory.get).toHaveBeenCalledTimes(4);
  });

  it("shows Used in, keeps org first and offers row actions", async () => {
    setup();
    vi.mocked(aiMemory.get).mockImplementation(((_o: string, target: any) =>
      Promise.resolve({
        data: memory(
          target.scope === "org"
            ? {}
            : { rev: 0, pending_count: 0, updated_at: 1_700_000_000_000_000 },
        ),
      })) as any);
    const w = await mountPage();
    const rows = w.findAll('[data-test="row"]');
    expect(rows[0].find('[data-test="ai-memory-org-edit"]').exists()).toBe(true);
    expect(rows[0].find('[data-test="ai-memory-org-review-pending"]').exists()).toBe(true);
    expect(rows[1].find('[data-test="ai-memory-ts1-history"]').exists()).toBe(true);
    expect(rows[1].find('[data-test="ai-memory-ts1-review-pending"]').exists()).toBe(false);
    const rowsVm = (w.vm as any).$.setupState.memoryRows;
    expect(rowsVm[0].updated).not.toBeNull();
    expect(rowsVm[1].updated).toBeNull();
  });

  it("has no tabs and shows the pending count on the header button", async () => {
    setup();
    const w = await mountPage();
    expect(w.find('[data-test="ai-memory-tabs"]').exists()).toBe(false);
    expect(w.find('[data-test="ai-memory-review-pending-btn"]').text()).toContain("2");
    expect(w.find('[data-test="ai-memory-pending-drawer"]').exists()).toBe(false);
  });

  it("hides the header button when nothing is pending", async () => {
    setup();
    vi.mocked(aiMemory.pending).mockResolvedValue({ data: { pending: [] } } as any);
    const w = await mountPage();
    expect(w.find('[data-test="ai-memory-review-pending-btn"]').exists()).toBe(false);
  });

  it("View history opens the drawer on the newest revision with its diff against the previous", async () => {
    setup();
    const w = await mountPage();
    await openHistory(w, 1);
    const drawer = w.find('[data-test="ai-memory-history-drawer"]');
    expect(drawer.find("h2").text()).toBe("History · grafana");
    expect(aiMemory.revisions).toHaveBeenCalledWith(expect.any(String), {
      scope: "toolset",
      toolsetId: "ts1",
    });
    expect(drawer.find('[data-test="ai-memory-history-selector"]').text()).toContain("Revision 2");
    expect(drawer.find('[data-test="ai-memory-history-selector"]').text()).not.toContain("Current");
    expect(drawer.find('[data-test="ai-memory-history-current"]').exists()).toBe(true);
    expect(drawer.find('[data-test="ai-memory-history-meta"]').text()).toContain(
      "Reason: seen in RCA",
    );
    expect(drawer.find('[data-test="ai-memory-history-compare"]').text()).toBe(
      "Changes from revision 1",
    );
    expect(drawer.find('[data-test="ai-memory-diff"]').text()).toBe("old>new");
    expect(drawer.find('[data-test="ai-memory-revert"]').exists()).toBe(false);
  });

  it("choosing an older revision updates the meta and diff, and reverts after confirming", async () => {
    setup();
    const w = await mountPage();
    await openHistory(w);
    await w.find('[data-test="ai-memory-history-option-1"]').trigger("click");
    await flushPromises();
    const drawer = w.find('[data-test="ai-memory-history-drawer"]');
    expect(drawer.find('[data-test="ai-memory-history-selector"]').text()).toContain("Revision 1");
    expect(drawer.find('[data-test="ai-memory-history-compare"]').text()).toBe("First version");
    expect(drawer.find('[data-test="ai-memory-history-current"]').exists()).toBe(false);
    expect(drawer.find('[data-test="ai-memory-diff"]').text()).toBe(">old");
    expect(drawer.find('[data-test="ai-memory-revert"]').text()).toBe("Revert to revision 1");
    await drawer.find('[data-test="ai-memory-revert"]').trigger("click");
    expect(aiMemory.revert).not.toHaveBeenCalled();
    vi.mocked(aiMemory.revisions).mockClear();
    vi.mocked(aiMemory.get).mockClear();
    await w.find('[data-test="confirm-ok"]').trigger("click");
    await flushPromises();
    expect(aiMemory.revert).toHaveBeenCalledWith(expect.any(String), { scope: "org" }, 1);
    expect(aiMemory.revisions).toHaveBeenCalledTimes(1);
    expect(aiMemory.get).toHaveBeenCalled();
    expect(drawer.find('[data-test="ai-memory-history-selector"]').text()).toContain("Revision 2");
  });

  it("shows skeletons while the revisions load", async () => {
    setup();
    vi.mocked(aiMemory.revisions).mockReturnValue(new Promise(() => {}) as any);
    const w = await mountPage();
    await openHistory(w);
    expect(w.find('[data-test="ai-memory-history-loading"]').exists()).toBe(true);
  });

  it("View history on a memory that was never saved shows the empty state", async () => {
    setup();
    vi.mocked(aiMemory.get).mockResolvedValue({ data: memory({ rev: 0 }) } as any);
    vi.mocked(aiMemory.revisions).mockResolvedValue({ data: { revisions: [] } } as any);
    const w = await mountPage();
    await openHistory(w);
    const drawer = w.find('[data-test="ai-memory-history-drawer"]');
    expect(drawer.text()).toContain("No history yet");
    expect(drawer.find('[data-test="ai-memory-history-selector"]').exists()).toBe(false);
  });

  it("row Review pending opens the pending drawer filtered to the memory", async () => {
    setup();
    const w = await mountPage();
    await w.find('[data-test="ai-memory-org-review-pending"]').trigger("click");
    await flushPromises();
    const st = (w.vm as any).$.setupState;
    expect(w.find('[data-test="ai-memory-pending-drawer"]').exists()).toBe(true);
    expect(st.pendingFilter).toBe("Org memory");
    expect(w.findAll('[data-test="ai-memory-pending-drawer"] [data-test="row"]')).toHaveLength(1);
  });

  it("shows pending changes as rows with flags and accepts one from its row action", async () => {
    setup();
    const w = await mountPage();
    await openPending(w);
    const rows = pendingRowEls(w);
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("proposed 2 times");
    expect(rows[0].find('[data-test="ai-memory-flag-states_absence"]').exists()).toBe(true);
    expect(rows[0].find('[data-test="ai-memory-flag-suppression_text"]').exists()).toBe(true);
    expect(w.text()).not.toContain("Accept all");
    await rows[0].find('[data-test^="ai-memory-accept-"]').trigger("click");
    await flushPromises();
    expect(aiMemory.accept).toHaveBeenCalledWith(expect.any(String), ["p1", "p2"]);
  });

  it("accepts the selection and asks before discarding it", async () => {
    setup();
    const w = await mountPage();
    await openPending(w);
    const boxes = w.findAll('[data-test="row-select"]');
    await boxes[0].trigger("change");
    (w.vm as any).$.setupState.selectedIds = (w.vm as any).$.setupState.pendingRows.map(
      (r: any) => r.id,
    );
    await flushPromises();
    await w.find('[data-test="ai-memory-accept-selected"]').trigger("click");
    await flushPromises();
    expect(aiMemory.accept).toHaveBeenCalledWith(expect.any(String), ["p1", "p2", "p3"]);

    (w.vm as any).$.setupState.selectedIds = (w.vm as any).$.setupState.pendingRows.map(
      (r: any) => r.id,
    );
    await flushPromises();
    await w.find('[data-test="ai-memory-discard-selected"]').trigger("click");
    expect(aiMemory.discard).not.toHaveBeenCalled();
    await w.find('[data-test="confirm-ok"]').trigger("click");
    await flushPromises();
    expect(aiMemory.discard).toHaveBeenCalledWith(expect.any(String), ["p1", "p2", "p3"]);
  });

  it("names a failed change only when one failed and keeps it with its reason", async () => {
    setup();
    vi.mocked(aiMemory.accept).mockResolvedValueOnce({
      data: {
        results: [
          { id: "p3", status: 409, code: "edit_conflict", message: "text to replace not found" },
        ],
      },
    } as any);
    const w = await mountPage();
    await openPending(w);
    await pendingRowEls(w)[1].find('[data-test^="ai-memory-accept-"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="ai-memory-pending-failure"]').text()).toContain(
      "text to replace not found",
    );
  });

  it("opens a review dialog with the diff and accepts from it", async () => {
    setup();
    const w = await mountPage();
    await openPending(w);
    await pendingRowEls(w)[0].trigger("click");
    const dialog = w.find('[data-test="ai-memory-review-dialog"]');
    expect(dialog.find('[data-test="ai-memory-diff"]').text()).toBe("a>b");
    await dialog.find('[data-test="ai-memory-review-accept"]').trigger("click");
    await flushPromises();
    expect(aiMemory.accept).toHaveBeenCalledWith(expect.any(String), ["p1", "p2"]);
  });

  it("hides the decision controls from a reader without the write grant", async () => {
    setup(false);
    const w = await mountPage();
    await openPending(w);
    expect(w.find('[data-test="row-select"]').exists()).toBe(false);
    expect(w.find('[data-test^="ai-memory-accept-"]').exists()).toBe(false);
  });

  it("shows the empty state in the history drawer when there are no revisions", async () => {
    setup();
    vi.mocked(aiMemory.revisions).mockResolvedValue({ data: { revisions: [] } } as any);
    const w = await mountPage();
    await openHistory(w);
    expect(w.find('[data-test="ai-memory-history-drawer"]').text()).toContain("No history yet");
  });

  it("shows an error with Retry in the history drawer", async () => {
    setup();
    vi.mocked(aiMemory.revisions).mockRejectedValueOnce({
      response: { data: { message: "nope" } },
    });
    const w = await mountPage();
    await openHistory(w);
    const drawer = w.find('[data-test="ai-memory-history-drawer"]');
    expect(drawer.find('[data-test="ai-memory-history-error"]').text()).toContain("nope");
    await drawer.find('[data-test="ai-memory-history-retry"]').trigger("click");
    await flushPromises();
    expect(drawer.find('[data-test="ai-memory-history-selector"]').exists()).toBe(true);
  });

  it("shows an error with Retry, not an empty state, when a load fails", async () => {
    setup();
    vi.mocked(aiMemory.pending).mockRejectedValueOnce({ response: { data: { message: "boom" } } });
    const w = await mountPage();
    await openPending(w);
    const drawer = w.find('[data-test="ai-memory-pending-drawer"]');
    expect(drawer.find('[data-test="table-error"]').text()).toContain("boom");
    expect(drawer.find('[data-test="table-empty"]').exists()).toBe(false);
    await drawer.find('[data-test="table-retry"]').trigger("click");
    await flushPromises();
    expect(drawer.findAll('[data-test="row"]')).toHaveLength(2);
  });

  it("shows a skeleton while the first load is in flight", async () => {
    setup();
    vi.mocked(aiMemory.get).mockReturnValue(new Promise(() => {}) as any);
    const w = mount(AiMemory, {
      global: {
        plugins: [i18n, store, router],
        provide: { store },
        stubs: { OPageLayout: { template: "<div><slot /></div>" }, OTable: OTableStub },
      },
    });
    await flushPromises();
    expect(w.find('[data-test="table-loading"]').exists()).toBe(true);
  });
});
