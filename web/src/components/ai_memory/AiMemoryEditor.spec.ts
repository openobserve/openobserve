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
import AiMemoryEditor from "./AiMemoryEditor.vue";

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

describe("AiMemoryEditor", () => {
  beforeEach(() => {
    vi.mocked(aiMemory.get)
      .mockReset()
      .mockResolvedValue({ data: memory() } as any);
    vi.mocked(aiMemory.update).mockReset();
  });

  it("shows the current text on a rev conflict and reapplies the user's text on the new rev", async () => {
    const w = await mountEditor();
    await w.find('[data-test="ai-memory-text"]').setValue("mine");
    vi.mocked(aiMemory.update).mockRejectedValueOnce({
      response: { status: 409, data: { code: "rev_conflict", rev: 5, content: "theirs" } },
    });
    await w.find('[data-test="ai-memory-save"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="ai-memory-conflict"]').text()).toContain("theirs");
    await w.find('[data-test="ai-memory-reapply"]').trigger("click");
    vi.mocked(aiMemory.update).mockResolvedValueOnce({ status: 200, data: { rev: 6 } } as any);
    await w.find('[data-test="ai-memory-save"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(aiMemory.update).mock.calls.at(-1)![2]).toEqual({
      content: "mine",
      base_rev: 5,
    });
  });

  it("takes the current text when asked", async () => {
    const w = await mountEditor();
    await w.find('[data-test="ai-memory-text"]').setValue("mine");
    vi.mocked(aiMemory.update).mockRejectedValueOnce({
      response: { status: 409, data: { code: "rev_conflict", rev: 5, content: "theirs" } },
    });
    await w.find('[data-test="ai-memory-save"]').trigger("click");
    await flushPromises();
    await w.find('[data-test="ai-memory-take-current"]').trigger("click");
    expect((w.find('[data-test="ai-memory-text"]').element as HTMLTextAreaElement).value).toBe(
      "theirs",
    );
  });

  it("gives memory admins the settings and caps", async () => {
    const w = await mountEditor();
    expect(w.find('[data-test="ai-memory-agent-writes"]').attributes("disabled")).toBeUndefined();
    expect(w.find('[data-test="ai-memory-cap"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-memory-user-cap"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-memory-save"]').text()).toBe("Save");
  });

  it("keeps settings read-only for others, whose saves are sent for approval", async () => {
    vi.mocked(aiMemory.get).mockResolvedValue({ data: memory({ can_apply: false }) } as any);
    const w = await mountEditor();
    expect(w.find('[data-test="ai-memory-agent-writes"]').attributes("disabled")).toBeDefined();
    expect(w.find('[data-test="ai-memory-cap"]').exists()).toBe(false);
    const save = w.find('[data-test="ai-memory-save"]');
    expect(save.text()).toBe("Submit for approval");
    await w.find('[data-test="ai-memory-text"]').setValue("new");
    vi.mocked(aiMemory.update).mockResolvedValueOnce({
      status: 202,
      data: { state: "pending" },
    } as any);
    await save.trigger("click");
    await flushPromises();
    expect(w.find('[data-test="ai-memory-notice"]').text()).toBe("Sent for approval");
  });

  it("turns the AI's writes to my notes on and off", async () => {
    vi.mocked(aiMemory.get).mockResolvedValue({
      data: memory({ scope: "user", agent_memory_writes_effective: "on", can_apply: true }),
    } as any);
    vi.mocked(aiMemory.update).mockResolvedValue({ status: 200, data: {} } as any);
    const w = await mountEditor({ target: { scope: "user" }, title: "My notes" });
    expect(w.find('[data-test="ai-memory-agent-writes"]').exists()).toBe(false);
    w.findComponent({ name: "OSwitch" }).vm.$emit("update:modelValue", false);
    await flushPromises();
    expect(aiMemory.update).toHaveBeenCalledWith(
      expect.any(String),
      { scope: "user" },
      {
        agent_memory_writes: "off",
      },
    );
  });

  it("keeps an unsaved draft when a setting is saved", async () => {
    vi.mocked(aiMemory.update).mockResolvedValue({ status: 200, data: {} } as any);
    const w = await mountEditor();
    await w.find('[data-test="ai-memory-text"]').setValue("unsaved");
    vi.mocked(aiMemory.get).mockResolvedValue({
      data: memory({ content: "changed elsewhere", rev: 4, agent_memory_writes: "auto" }),
    } as any);
    await w.find('[data-test="ai-memory-agent-writes"]').setValue("auto");
    await flushPromises();
    expect((w.find('[data-test="ai-memory-text"]').element as HTMLTextAreaElement).value).toBe(
      "unsaved",
    );
    expect(w.find('[data-test="ai-memory-rev"]').text()).toBe("rev 3");
    await w.find('[data-test="ai-memory-save"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(aiMemory.update).mock.calls.at(-1)![2]).toEqual({
      content: "unsaved",
      base_rev: 3,
    });
  });

  it("sends inherit to clear a toolset's own agent-write setting", async () => {
    vi.mocked(aiMemory.get).mockResolvedValue({
      data: memory({ scope: "toolset", agent_memory_writes: "off" }),
    } as any);
    vi.mocked(aiMemory.update).mockResolvedValue({ status: 200, data: {} } as any);
    const target = { scope: "toolset", toolsetId: "ts1" };
    const w = await mountEditor({ target, title: "grafana" });
    await w.find('[data-test="ai-memory-agent-writes"]').setValue("");
    await flushPromises();
    expect(aiMemory.update).toHaveBeenCalledWith(expect.any(String), target, {
      agent_memory_writes: "inherit",
    });
  });

  it("shows only the text when read-only", async () => {
    const w = await mountEditor({ readonly: true });
    expect(w.find('[data-test="ai-memory-view"]').text()).toBe("old");
    expect(w.find('[data-test="ai-memory-text"]').exists()).toBe(false);
  });
});
