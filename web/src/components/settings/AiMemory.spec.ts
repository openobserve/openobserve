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
    accept: vi.fn(() => Promise.resolve({})),
    discard: vi.fn(() => Promise.resolve({})),
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

const setup = (canApply: boolean) => {
  vi.mocked(aiMemory.get).mockResolvedValue({
    data: {
      scope: "org",
      content: "",
      rev: 1,
      size_bytes: 0,
      max_bytes: 16384,
      agent_memory_writes: null,
      agent_memory_writes_effective: "review",
      pending_count: 3,
      can_apply: canApply,
    },
  } as any);
  vi.mocked(aiMemory.pending).mockResolvedValue({
    data: {
      pending: [
        pendingEdit("p1", { flags: ["states_absence"] }),
        pendingEdit("p2", { flags: ["suppression_text"] }),
        pendingEdit("p3", { scope: "toolset", scope_key: "ts1" }),
      ],
    },
  } as any);
};

const mountPage = async (tab: string) => {
  const w = mount(AiMemory, {
    global: {
      plugins: [i18n, store, router],
      provide: { store },
      stubs: { OPageLayout: { template: "<div><slot name='header-tabs' /><slot /></div>" } },
    },
  });
  await flushPromises();
  (w.vm as any).$.setupState.tab = tab;
  await flushPromises();
  return w;
};

describe("AiMemory page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("groups pending edits, shows their flags and accepts a group or the selection", async () => {
    setup(true);
    const w = await mountPage("pending");
    const groups = w.findAll('[data-test="ai-memory-pending-group"]');
    expect(groups).toHaveLength(2);
    expect(groups[0].text()).toContain("proposed 2 times");
    expect(groups[0].find('[data-test="ai-memory-flag-states_absence"]').exists()).toBe(true);
    expect(groups[0].find('[data-test="ai-memory-flag-suppression_text"]').exists()).toBe(true);
    expect(groups[1].text()).toContain("grafana");

    await groups[0].find('[data-test="ai-memory-accept"]').trigger("click");
    await flushPromises();
    expect(aiMemory.accept).toHaveBeenCalledWith(expect.any(String), ["p1", "p2"]);

    const boxes = w.findAll('[data-test="ai-memory-pending-select"]');
    await boxes[0].trigger("change");
    await boxes[1].trigger("change");
    await w.find('[data-test="ai-memory-discard-selected"]').trigger("click");
    await flushPromises();
    expect(aiMemory.discard).toHaveBeenCalledWith(expect.any(String), ["p1", "p2", "p3"]);
  });

  it("reports each id's result and keeps a failed one with its reason", async () => {
    setup(true);
    vi.mocked(aiMemory.accept).mockResolvedValueOnce({
      data: {
        results: [
          { id: "p1", status: 200 },
          { id: "p2", status: 200 },
          { id: "p3", status: 409, code: "edit_conflict", message: "text to replace not found" },
        ],
      },
    } as any);
    const w = await mountPage("pending");
    vi.mocked(aiMemory.pending).mockResolvedValueOnce({
      data: { pending: [pendingEdit("p3", { scope: "toolset", scope_key: "ts1" })] },
    } as any);
    await w.find('[data-test="ai-memory-accept-all"]').trigger("click");
    await flushPromises();
    expect(aiMemory.accept).toHaveBeenCalledWith(expect.any(String), ["p1", "p2", "p3"]);
    expect(w.findAll('[data-test="ai-memory-pending-group"]')).toHaveLength(1);
    expect(w.find('[data-test="ai-memory-pending-failure"]').text()).toContain(
      "text to replace not found",
    );
  });

  it("discards everything shown with Discard all", async () => {
    setup(true);
    const w = await mountPage("pending");
    await w.find('[data-test="ai-memory-discard-all"]').trigger("click");
    await flushPromises();
    expect(aiMemory.discard).toHaveBeenCalledWith(expect.any(String), ["p1", "p2", "p3"]);
  });

  it("shows pending edits read-only to people who can't approve", async () => {
    setup(false);
    const w = await mountPage("pending");
    expect(w.findAll('[data-test="ai-memory-pending-group"]')).toHaveLength(2);
    expect(w.find('[data-test="ai-memory-accept"]').exists()).toBe(false);
    expect(w.find('[data-test="ai-memory-accept-selected"]').exists()).toBe(false);
    expect(w.find('[data-test="ai-memory-accept-all"]').exists()).toBe(false);
    expect(w.find('[data-test="ai-memory-pending-select"]').exists()).toBe(false);
  });

  it("opens a revision with its diff, author, reason and evidence, and reverts to it", async () => {
    setup(true);
    const rev = {
      ...pendingEdit("r4"),
      rev: 4,
      state: "applied",
      updated_by: "user:ann@example.com",
      evidence: [{ call_ref: "abc123", tool: "search_logs" }],
    };
    vi.mocked(aiMemory.revisions).mockResolvedValue({ data: { revisions: [rev] } } as any);
    vi.mocked(aiMemory.revision).mockResolvedValue({ data: rev } as any);
    const w = await mountPage("history");
    await w.find('[data-test="ai-memory-revision"]').trigger("click");
    await flushPromises();
    const dialog = document.body.querySelector('[data-test="ai-memory-revision-dialog"]')!;
    expect(dialog.textContent).toContain("ann@example.com");
    expect(dialog.textContent).toContain("seen in RCA");
    expect(dialog.textContent).toContain("- a");
    expect(dialog.textContent).toContain("+ b");
    expect(dialog.querySelector('[data-test="ai-memory-evidence"]')!.textContent).toContain(
      "abc123",
    );
    (document.body.querySelector('[data-test="ai-memory-revert"]') as HTMLElement).click();
    await flushPromises();
    expect(aiMemory.revert).toHaveBeenCalledWith(expect.any(String), { scope: "org" }, 4);
    w.unmount();
  });

  it("diffs a saved snapshot against the applied text before it", async () => {
    setup(true);
    const snap = (id: string, rev: number, content?: string) => ({
      ...pendingEdit(id),
      rev,
      state: "applied",
      edits: null,
      content,
    });
    vi.mocked(aiMemory.revisions).mockResolvedValue({
      data: { revisions: [snap("r5", 5), snap("r4", 4), snap("r3", 3)] },
    } as any);
    vi.mocked(aiMemory.revision).mockImplementation(
      (_o, _t, id) =>
        Promise.resolve({
          data: id === "r5" ? snap("r5", 5, "keep\nnew") : snap("r4", 4, "keep\nold"),
        }) as any,
    );
    const w = await mountPage("history");
    await w.findAll('[data-test="ai-memory-revision"]')[0].trigger("click");
    await flushPromises();
    expect(vi.mocked(aiMemory.revision).mock.calls.map((c) => c[2])).toEqual(["r5", "r4"]);
    const diff = document.body.querySelector('[data-test="ai-memory-diff"]')!.textContent!;
    expect(diff).toContain("- old");
    expect(diff).toContain("+ new");
    w.unmount();
  });

  it("drops a revision that arrives after the selection changed, and reverts the memory it opened", async () => {
    setup(true);
    const rev = { ...pendingEdit("r4"), rev: 4, state: "applied" };
    vi.mocked(aiMemory.revisions).mockResolvedValue({ data: { revisions: [rev] } } as any);
    let resolve!: (v: any) => void;
    vi.mocked(aiMemory.revision).mockImplementationOnce(
      () => new Promise((r) => (resolve = r)) as any,
    );
    const w = await mountPage("history");
    await w.find('[data-test="ai-memory-revision"]').trigger("click");
    (w.vm as any).$.setupState.historyKey = "ts1";
    await flushPromises();
    resolve({ data: rev });
    await flushPromises();
    expect(document.body.querySelector('[data-test="ai-memory-revision-dialog"]')).toBeNull();

    vi.mocked(aiMemory.revision).mockResolvedValue({ data: rev } as any);
    await w.find('[data-test="ai-memory-revision"]').trigger("click");
    await flushPromises();
    (w.vm as any).$.setupState.historyKey = "org";
    await flushPromises();
    (document.body.querySelector('[data-test="ai-memory-revert"]') as HTMLElement).click();
    await flushPromises();
    expect(aiMemory.revert).toHaveBeenCalledWith(
      expect.any(String),
      { scope: "toolset", toolsetId: "ts1" },
      4,
    );
    w.unmount();
  });

  it("hides Revert from people who can't write memory", async () => {
    setup(false);
    const rev = { ...pendingEdit("r4"), rev: 4, state: "applied" };
    vi.mocked(aiMemory.revisions).mockResolvedValue({ data: { revisions: [rev] } } as any);
    vi.mocked(aiMemory.revision).mockResolvedValue({ data: rev } as any);
    const w = await mountPage("history");
    await w.find('[data-test="ai-memory-revision"]').trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[data-test="ai-memory-revision-dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-test="ai-memory-revert"]')).toBeNull();
    w.unmount();
  });
});
