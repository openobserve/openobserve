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
import aiMemory from "@/services/ai_memory";
import { toast } from "@/lib/feedback/Toast/useToast";
import AiMemoryEditor from "./AiMemoryEditor.vue";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

vi.mock("@/services/ai_memory", () => ({
  default: { get: vi.fn(), update: vi.fn() },
}));

const memory = (extra: Record<string, unknown> = {}) => ({
  scope: "org",
  scope_key: "",
  content: "old",
  rev: 3,
  size_bytes: 3,
  max_bytes: 16384,
  user_max_bytes: 4096,
  agent_memory_writes: "review",
  agent_memory_writes_effective: "review",
  updated_by: null,
  updated_at: null,
  pending_count: 0,
  can_apply: true,
  ...extra,
});

const mountEditor = async (props: Record<string, unknown> = {}) => {
  const w = mount(AiMemoryEditor, {
    props: { target: { scope: "org" }, title: "Org memory", ...props },
    global: { plugins: [i18n, store], provide: { store } },
  });
  await flushPromises();
  return w;
};

const text = (w: any) => w.find('[data-test="ai-memory-text-field"]');
const submit = async (w: any) => {
  await w.find("form").trigger("submit");
  await flushPromises();
  await new Promise((r) => setTimeout(r, 20));
  await flushPromises();
};
const lastBody = () => vi.mocked(aiMemory.update).mock.calls.at(-1)![2];
const pickMode = (w: any, value: string) =>
  w.findComponent('[data-test="ai-memory-agent-writes"]').vm.$emit("update:modelValue", value);

describe("AiMemoryEditor", () => {
  beforeEach(() => {
    vi.mocked(aiMemory.get)
      .mockReset()
      .mockResolvedValue({ data: memory() } as any);
    vi.mocked(aiMemory.update)
      .mockReset()
      .mockResolvedValue({ status: 200, data: { rev: 4 } } as any);
    vi.mocked(toast).mockReset();
  });

  it("shows a skeleton while loading, then the fields bound by name", async () => {
    let done: (v: unknown) => void = () => {};
    vi.mocked(aiMemory.get).mockReturnValueOnce(new Promise((r) => (done = r)) as any);
    const w = await mountEditor();
    expect(w.find('[data-test="ai-memory-loading"]').exists()).toBe(true);
    done({ data: memory() });
    await flushPromises();
    expect(w.find('[data-test="ai-memory-loading"]').exists()).toBe(false);
    expect((text(w).element as HTMLTextAreaElement).value).toBe("old");
    expect(w.find('[data-test="ai-memory-rev"]').text()).toContain("3");
  });

  it("shows an error with Retry when the load fails", async () => {
    vi.mocked(aiMemory.get).mockRejectedValueOnce(new Error("boom"));
    const w = await mountEditor();
    expect(w.find('[data-test="ai-memory-load-error"]').exists()).toBe(true);
    await w.find('[data-test="ai-memory-retry"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="ai-memory-load-error"]').exists()).toBe(false);
    expect(text(w).exists()).toBe(true);
  });

  it("saves the text and every changed setting in one request, then toasts", async () => {
    const w = await mountEditor();
    await text(w).setValue("new");
    pickMode(w, "auto");
    await w.find('[data-test="ai-memory-cap-field"]').setValue("32");
    await flushPromises();
    await submit(w);
    expect(aiMemory.update).toHaveBeenCalledTimes(1);
    expect(lastBody()).toEqual({
      content: "new",
      base_rev: 3,
      agent_memory_writes: "auto",
      max_bytes: 32768,
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("shows the current text on a rev conflict and reapplies the user's text on the new rev", async () => {
    const w = await mountEditor();
    await text(w).setValue("mine");
    vi.mocked(aiMemory.update).mockRejectedValueOnce({
      response: { status: 409, data: { code: "rev_conflict", rev: 5, content: "theirs" } },
    });
    await submit(w);
    expect(w.find('[data-test="ai-memory-conflict"]').text()).toContain("theirs");
    await w.find('[data-test="ai-memory-reapply"]').trigger("click");
    await submit(w);
    expect(lastBody()).toEqual({ content: "mine", base_rev: 5 });
  });

  it("takes the current text when asked", async () => {
    const w = await mountEditor();
    await text(w).setValue("mine");
    vi.mocked(aiMemory.update).mockRejectedValueOnce({
      response: { status: 409, data: { code: "rev_conflict", rev: 5, content: "theirs" } },
    });
    await submit(w);
    await w.find('[data-test="ai-memory-take-current"]').trigger("click");
    await flushPromises();
    expect((text(w).element as HTMLTextAreaElement).value).toBe("theirs");
  });

  it("gives memory admins the settings and caps", async () => {
    const w = await mountEditor();
    expect(w.find('[data-test="ai-memory-agent-writes"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-memory-cap-field"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-memory-user-cap-field"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-memory-save"]').text()).toBe("Save");
  });

  it("keeps settings read-only for others, whose saves are sent for approval", async () => {
    vi.mocked(aiMemory.get).mockResolvedValue({ data: memory({ can_apply: false }) } as any);
    const w = await mountEditor();
    expect(w.findComponent('[data-test="ai-memory-agent-writes"]').props("disabled")).toBe(true);
    expect(w.find('[data-test="ai-memory-cap-field"]').exists()).toBe(false);
    expect(w.find('[data-test="ai-memory-save"]').text()).toBe("Submit for approval");
    await text(w).setValue("new");
    vi.mocked(aiMemory.update).mockResolvedValueOnce({
      status: 202,
      data: { state: "pending" },
    } as any);
    await submit(w);
    expect(lastBody()).toEqual({ content: "new", base_rev: 3 });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("turns the AI's writes to my notes on and off with the switch", async () => {
    vi.mocked(aiMemory.get).mockResolvedValue({
      data: memory({ scope: "user", agent_memory_writes_effective: "on", can_apply: true }),
    } as any);
    const w = await mountEditor({ target: { scope: "user" }, title: "My notes" });
    expect(w.find('[data-test="ai-memory-agent-writes"]').exists()).toBe(false);
    w.findComponent({ name: "OSwitch" }).vm.$emit("update:modelValue", false);
    await flushPromises();
    expect(aiMemory.update).not.toHaveBeenCalled();
    await submit(w);
    expect(lastBody()).toEqual({ agent_memory_writes: "off" });
  });

  it("sends inherit to clear a toolset's own agent-write setting", async () => {
    vi.mocked(aiMemory.get).mockResolvedValue({
      data: memory({ scope: "toolset", agent_memory_writes: "off" }),
    } as any);
    const w = await mountEditor({
      target: { scope: "toolset", toolsetId: "ts1" },
      title: "grafana",
    });
    pickMode(w, "inherit");
    await flushPromises();
    await submit(w);
    expect(lastBody()).toEqual({ agent_memory_writes: "inherit" });
  });

  it("renders no Save of its own when embedded and exposes the form id", async () => {
    const w = await mountEditor({ embedded: true, formId: "host-form" });
    expect(w.find('[data-test="ai-memory-save"]').exists()).toBe(false);
    expect(w.find("form").attributes("id")).toBe("host-form");
  });

  it("shows only the text when read-only", async () => {
    const w = await mountEditor({ readonly: true });
    expect(w.find('[data-test="ai-memory-view"]').text()).toBe("old");
    expect(text(w).exists()).toBe(false);
  });
});
