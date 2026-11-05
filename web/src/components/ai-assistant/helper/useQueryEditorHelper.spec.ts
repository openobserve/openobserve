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

import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

import { useEditorProposal } from "@/composables/assistant";
import type { QueryEditorAssistant } from "@/composables/assistant/pure";

const { gate, focusCard, focusDock, dockOpen, propose, track } = vi.hoisted(() => ({
  gate: { value: "available" as string },
  focusCard: vi.fn(() => false),
  focusDock: vi.fn(() => false),
  dockOpen: vi.fn(() => false),
  propose: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@/composables/assistant", async () => {
  const { computed: c, ref: r } = await import("vue");
  const code = r(gate.value);
  return {
    assistantFocusCard: focusCard,
    focusDockComposer: focusDock,
    isDockOpen: dockOpen,
    useAssistantCapability: () =>
      Object.assign(
        c(() => ({ gate: code.value })),
        { gate: c(() => (code.value = gate.value)) },
      ),
    useEditorProposal: vi.fn(() => ({
      propose,
      pending: r(null),
      label: r(null),
      revert: vi.fn(),
      clear: vi.fn(),
      discard: vi.fn(),
      annotate: vi.fn(),
    })),
  };
});
vi.mock("@/services/assistantAnalytics", () => ({ trackAssistant: track }));

import { useQueryEditorHelper } from "./useQueryEditorHelper";

function setup(
  assistant: QueryEditorAssistant = { id: "logs", stream: "default" },
  extra: { enabled?: () => boolean; query?: () => string | undefined } = {},
) {
  const focusPrompt = vi.fn();
  const write = vi.fn();
  const editor = { getValue: () => "SELECT 1", replaceValue: vi.fn(), focus: vi.fn() };
  const current = ref<QueryEditorAssistant>(assistant);
  const scope = effectScope();
  const helper = scope.run(() =>
    useQueryEditorHelper({
      assistant: () => current.value,
      language: () => "sql",
      editor: () => editor,
      area: () => null,
      write,
      focusPrompt,
      ...extra,
    }),
  )!;
  return { helper, focusPrompt, write, editor, current, scope };
}

afterEach(() => {
  gate.value = "available";
  vi.clearAllMocks();
});

describe("useQueryEditorHelper", () => {
  it("gives the chord to a pending card first, then this editor's open dock, then the row", async () => {
    focusCard.mockReturnValueOnce(true);
    const { helper, focusPrompt } = setup();
    expect(helper.onChord()).toBe(true);
    expect(helper.open.value).toBe(false);
    focusDock.mockReturnValueOnce(true);
    expect(helper.onChord()).toBe(true);
    expect(focusDock).toHaveBeenCalledWith("logs");
    expect(helper.open.value).toBe(false);
    expect(helper.onChord()).toBe(true);
    expect(helper.open.value).toBe(true);
    await nextTick();
    expect(focusPrompt).toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(
      "ai_entry_clicked",
      expect.objectContaining({ entry_kind: "shortcut", entry_verb: "generate_query" }),
    );
  });

  it("presses the chord again to focus the prompt, never to close", () => {
    const { helper, focusPrompt } = setup();
    helper.onChord();
    helper.onChord();
    expect(helper.open.value).toBe(true);
    expect(focusPrompt).toHaveBeenCalled();
  });

  it("returns the key to Monaco where the door does not render", () => {
    gate.value = "not_entitled";
    const { helper } = setup();
    expect(helper.visible.value).toBe(false);
    expect(helper.onChord()).toBe(false);
  });

  it("does nothing for a locked door, and says why for a host with no stream", () => {
    gate.value = "no_permission";
    expect(setup().helper.onChord()).toBe(true);
    gate.value = "available";
    const { helper } = setup({ id: "logs", stream: "" });
    helper.onChord();
    expect(helper.open.value).toBe(false);
    expect(String(helper.status.value)).toBe("Select a stream to ask the assistant");
  });

  it("owns the proposal for an inline host and writes Accept through the editor and the host", () => {
    const { helper, editor, write } = setup();
    expect(helper.proposal).not.toBeNull();
    const binding = vi.mocked(useEditorProposal).mock.calls[0][1];
    binding.write("SELECT 2");
    expect(editor.replaceValue).toHaveBeenCalledWith("SELECT 2");
    expect(write).toHaveBeenCalledWith("SELECT 2");
    const docked = setup({ id: "function", proposal: {} as never });
    expect(docked.helper.proposal).toBeNull();
    expect(docked.helper.label.value).toBeNull();
  });

  it("opens from the hint with the sentence as a replace prompt", () => {
    const { helper } = setup();
    helper.openFrom("hint", { text: "errors per service", mode: "replace" });
    expect(helper.prefill.value).toEqual({ text: "errors per service", mode: "replace" });
    expect(helper.entryKind.value).toBe("hint");
  });

  it("counts user keystrokes only", () => {
    const { helper } = setup();
    helper.onUserEdit();
    helper.onUserEdit();
    expect(helper.editTick.value).toBe(2);
  });

  it("reads the host's adapter at use time, so a swapped adapter's stream and range are followed", () => {
    const { helper, current } = setup();
    expect(helper.host.stream).toBe("default");
    current.value = { id: "logs", stream: "k8s_logs", timeRange: { from: 1, to: 2 } };
    expect(helper.host.stream).toBe("k8s_logs");
    expect(helper.host.timeRange).toEqual({ from: 1, to: 2 });
    expect(helper.host.id).toBe("logs");
    expect(helper.host.language).toBe("sql");
  });

  it("hides the helper when the host turns it off and discards an open proposal", async () => {
    const on = ref(true);
    const { helper } = setup(undefined, { enabled: () => on.value });
    expect(helper.visible.value).toBe(true);
    helper.open.value = true;
    on.value = false;
    await nextTick();
    expect(helper.visible.value).toBe(false);
    expect(helper.open.value).toBe(false);
    expect(helper.proposal?.discard).toHaveBeenCalled();
  });
});
