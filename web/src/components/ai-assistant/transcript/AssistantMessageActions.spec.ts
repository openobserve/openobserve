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
import { computed, ref } from "vue";

import { setRuntimeHandle } from "@/composables/assistant/runtimeHandle";

import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { fakeAssistant } from "../__tests__/fakeAssistant";
import AssistantMessageActions, { answerMarkdown } from "./AssistantMessageActions.vue";
import { setMarkdownParserForTests, syncMarkdownParserForTests } from "./markdown";

const { fake, copy, track, mdUp } = vi.hoisted(() => ({
  fake: { current: null as any },
  copy: vi.fn(),
  track: vi.fn(),
  mdUp: { value: true },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
}));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: (...args: unknown[]) => copy(...args) }));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: (...args: unknown[]) => track(...args),
}));
vi.mock("@/composables/useBreakpoint", () => ({ default: () => ({ mdUp: ref(mdUp.value) }) }));

const prompt: ChatMessage = {
  role: "user",
  content: raw("why 5xx?"),
  sentAt: 0,
  turnId: "t1",
  chips: [
    {
      id: "c1",
      kind: "log_row",
      label: raw("Log row"),
      sizeBytes: 3,
      provenance: "door",
      sent: "serialized",
    },
  ],
};
const answer: ChatMessage = {
  role: "assistant",
  content: raw(""),
  contentBlocks: [
    {
      type: "tool_call",
      tool: "SearchSQL",
      message: raw("Querying default"),
      context: { stream_name: "default" },
      stepState: "done",
    },
    { type: "text", text: "## Checkout 5xx spike\n\nThe **cart** failed." },
  ],
};

function mountActions(props: Record<string, unknown>) {
  return mount(AssistantMessageActions, {
    props: { sid: fake.current.sid, turnId: "t1", isLast: true, promptNumber: 1, ...props },
    attachTo: document.body,
  });
}

describe("AssistantMessageActions", () => {
  beforeEach(() => {
    setMarkdownParserForTests(syncMarkdownParserForTests);
    fake.current = fakeAssistant();
    fake.current.sid = fake.current.store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    copy.mockReset().mockResolvedValue(true);
    track.mockReset();
    mdUp.value = true;
    document.body.innerHTML = "";
  });

  it("offers Edit and resend and Copy on a prompt", async () => {
    const wrapper = mountActions({ message: prompt });
    await wrapper.get('[data-test="assistant-msg-edit"]').trigger("click");
    expect(wrapper.emitted("edit")).toHaveLength(1);
    await wrapper.get('[data-test="assistant-msg-copy-prompt"]').trigger("click");
    await flushPromises();
    expect(copy).toHaveBeenCalledWith("why 5xx?", expect.anything(), { silent: true });
  });

  it("offers Regenerate, Copy answer and Copy as Markdown on the latest answer (EB-09 AC 1)", async () => {
    const regenerate = vi
      .spyOn(fake.current.store, "regenerate")
      .mockResolvedValue({ state: "done", saved: "server" });
    const wrapper = mountActions({ message: answer, prompt });
    await wrapper.get('[data-test="assistant-msg-copy-answer"]').trigger("click");
    await flushPromises();
    expect(copy.mock.calls[0][0]).toBe("Checkout 5xx spike\n\nThe cart failed.");
    expect(wrapper.get('[data-test="assistant-msg-copy-answer"]').attributes("aria-label")).toBe(
      "Copied",
    );
    await wrapper.get('[data-test="assistant-msg-copy-md"]').trigger("click");
    await flushPromises();
    expect(copy.mock.calls[1][0]).toBe(
      "- Querying default\n\n## Checkout 5xx spike\n\nThe **cart** failed.",
    );
    await wrapper.get('[data-test="assistant-msg-regenerate"]').trigger("click");
    expect(regenerate).toHaveBeenCalledWith(fake.current.sid);
    expect(track).toHaveBeenCalledWith("ai_thread_action", { action: "regenerate" });
    expect(
      mountActions({ message: answer, prompt, isLast: false })
        .find('[data-test="assistant-msg-regenerate"]')
        .exists(),
    ).toBe(false);
  });

  it("disables Regenerate and Edit with the credits reason, Copy still works (EB-09 AC 8)", () => {
    fake.current.capability.value = { ...fake.current.capability.value, creditMode: "exhausted" };
    const bar = mountActions({ message: answer, prompt });
    const regen = bar.get('[data-test="assistant-msg-regenerate"]');
    expect(regen.attributes("aria-disabled")).toBe("true");
    expect(bar.text()).toContain("AI credits are used up for this organization");
    expect(
      bar.get('[data-test="assistant-msg-copy-answer"]').attributes("aria-disabled"),
    ).toBeUndefined();
  });

  it("disables Regenerate while another tab signed out, saying why", () => {
    setRuntimeHandle({
      lifecycle: { signedOutElsewhere: computed(() => true), turnLock: () => "signed_out" },
    } as never);
    const bar = mountActions({ message: answer, prompt });
    expect(bar.get('[data-test="assistant-msg-regenerate"]').attributes("aria-disabled")).toBe(
      "true",
    );
    expect(bar.text()).toContain("You signed out in another tab.");
    setRuntimeHandle(null);
  });

  it("hides the bar of an older message until hover or focus, never on a coarse pointer (`30` §8)", () => {
    const older = mountActions({ message: answer, prompt, isLast: false });
    expect(older.get('[data-test="assistant-msg-actions"]').classes()).toEqual(
      expect.arrayContaining([
        "opacity-0",
        "group-focus-within/message:opacity-100",
        "pointer-coarse:opacity-100",
      ]),
    );
    expect(
      mountActions({ message: answer, prompt })
        .get('[data-test="assistant-msg-actions"]')
        .classes(),
    ).not.toContain("opacity-0");
  });

  it("is a kebab below md (EB-09 AC 10)", () => {
    mdUp.value = false;
    const wrapper = mountActions({ message: answer, prompt });
    expect(wrapper.find('[data-test="assistant-msg-more"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-msg-actions"]').exists()).toBe(false);
  });

  it("edits inline: Escape cancels with nothing sent, Send starts a new turn with the chips (EB-09 AC 4)", async () => {
    const edit = vi
      .spyOn(fake.current.store, "editResend")
      .mockResolvedValue({ state: "done", saved: "server" });
    const editor = mountActions({ message: prompt, mode: "editor", promptNumber: 3 });
    await flushPromises();
    const field = editor.get("textarea");
    expect(document.activeElement).toBe(field.element);
    await field.trigger("keydown", { key: "Escape", isComposing: true });
    expect(editor.emitted("done")).toBeUndefined();
    await field.trigger("keydown", { key: "Escape" });
    expect(editor.emitted("done")).toHaveLength(1);
    expect(edit).not.toHaveBeenCalled();
    const again = mountActions({ message: prompt, mode: "editor", promptNumber: 3 });
    await again.get("textarea").setValue("why 5xx in the last hour?");
    await again.get('[data-test="assistant-msg-edit-send"]').trigger("click");
    expect(edit).toHaveBeenCalledWith(fake.current.sid, {
      text: "why 5xx in the last hour?",
      chips: [expect.objectContaining({ id: "c1" })],
      images: [],
      editedFrom: 3,
    });
    expect(track).toHaveBeenCalledWith("ai_thread_action", { action: "edit_resend" });
  });

  it("holds the open editor's Send and Enter once another tab's lock arrives", async () => {
    const edit = vi.spyOn(fake.current.store, "editResend");
    const lock = ref<string | null>(null);
    setRuntimeHandle({
      lifecycle: {
        signedOutElsewhere: computed(() => false),
        turnLock: () => lock.value,
      },
    } as never);
    const editor = mountActions({ message: prompt, mode: "editor" });
    await flushPromises();
    await editor.get("textarea").setValue("why 5xx now?");
    lock.value = "approval_elsewhere";
    await flushPromises();
    const send = editor.get('[data-test="assistant-msg-edit-send"]');
    expect(send.attributes("aria-disabled")).toBe("true");
    expect(editor.text()).toContain("Another tab is waiting for your approval on this chat.");
    await editor.get("textarea").trigger("keydown", { key: "Enter" });
    await send.trigger("click");
    expect(edit).not.toHaveBeenCalled();
    setRuntimeHandle(null);
  });

  it("holds the editor's Send while a turn runs, so the edit is never dropped (S8)", async () => {
    const edit = vi.spyOn(fake.current.store, "editResend");
    fake.current.store.state.sessions[fake.current.sid].turn = { state: "connecting" };
    const editor = mountActions({ message: prompt, mode: "editor" });
    await flushPromises();
    const send = editor.get('[data-test="assistant-msg-edit-send"]');
    expect(send.attributes("aria-disabled")).toBe("true");
    await send.trigger("click");
    expect(edit).not.toHaveBeenCalled();
    expect(editor.emitted("done")).toBeUndefined();
  });

  it("drops a chip from the edit before it is sent", async () => {
    const edit = vi
      .spyOn(fake.current.store, "editResend")
      .mockResolvedValue({ state: "done", saved: "server" });
    const editor = mountActions({ message: prompt, mode: "editor" });
    await editor.get('[data-test="assistant-context-chip-remove"]').trigger("click");
    await editor.get('[data-test="assistant-msg-edit-send"]').trigger("click");
    expect(edit.mock.calls[0][1].chips).toEqual([]);
  });

  it("copies claim chips as [n] with one footnote per cited step, never the raw marker", () => {
    const copy = {
      step: () => "",
      fenceSource: () => null,
      stamp: null,
      claim: (id: string) => (id === "call_3" ? "Queried default · 13:43–13:58 IST" : null),
    };
    const text =
      "Reset by peer [^call_3]. Again [^call_3], and [^gone].\n\n```bash\necho [^call_3]\n```";
    expect(answerMarkdown([{ type: "text", text }], copy)).toBe(
      "Reset by peer [1]. Again [1], and [2].\n\n```bash\necho [^call_3]\n```\n\n1. Queried default · 13:43–13:58 IST\n2. gone",
    );
  });

  it("serialises steps as a list then the text as written", () => {
    const copy = {
      step: (block: ContentBlock) => String(block.message),
      fenceSource: () => null,
      stamp: null,
    };
    expect(answerMarkdown(answer.contentBlocks!, copy)).toBe(
      "- Querying default\n\n## Checkout 5xx spike\n\nThe **cart** failed.",
    );
  });

  it.each([
    ["two fences", "```sql\nSELECT 1\n```\n\n~~~promql\nup\n~~~"],
    ["a closer right after the opener", "```sql\n```\nSELECT 2\n```"],
    ["an unclosed fence before a closed one", "```sql\nSELECT 3\n\n~~~sql\nSELECT 4\n~~~"],
    ["a closer of the other kind", "```sql\nSELECT 5\n~~~\n```"],
    ["CRLF lines and trailing blanks", "```sqlite x\r\nSELECT 6\r\n``` \t\r\nafter"],
    ["a fence without a source", "```sql\nother\n```\n```sql\nSELECT 7\n```"],
    ["an empty fence body", "```sql\n\n```"],
  ])("sources %s exactly as the one-pattern version did (Y4)", (_name, text) => {
    const copy = {
      step: () => "",
      fenceSource: (code: string) => (code.includes("SELECT") ? `src ${code.length}` : null),
      stamp: null,
    };
    const prefix: Record<string, string> = { sql: "--", promql: "#" };
    const before = text.replace(
      /^((```|~~~)(sql|promql)[^\n]*)\n([\s\S]*?)\n\2[ \t]*$/gm,
      (all, open: string, fence: string, lang: string, code: string) => {
        const source = copy.fenceSource(code);
        return source ? `${open}\n${prefix[lang]} ${source}\n${code}\n${fence}` : all;
      },
    );
    expect(answerMarkdown([{ type: "text", text }], copy)).toBe(before);
  });

  it("sources thousands of unclosed query fences in linear time (Y4)", () => {
    const text = "```sql\nx\n".repeat(20_000);
    const started = performance.now();
    const out = answerMarkdown([{ type: "text", text }], {
      step: () => "",
      fenceSource: () => "s",
      stamp: null,
    });
    expect(performance.now() - started).toBeLessThan(500);
    expect(out).toBe(text.trim());
  });

  it("precedes a query fence with its stream and range and ends with the stamp (EB-09 AC 6)", async () => {
    const sql = "SELECT count(*) FROM default";
    const message: ChatMessage = {
      role: "assistant",
      content: raw(""),
      contentBlocks: [
        {
          type: "tool_call",
          tool: "SearchSQL",
          message: raw("Querying logs"),
          context: {
            stream_name: "default",
            request_body: {
              query: { sql, start_time: 1_700_000_000_000_000, end_time: 1_700_000_900_000_000 },
            },
          },
        },
        { type: "text", text: `Ran:\n\n\`\`\`sql\n${sql}\n\`\`\`` },
      ],
    };
    const bar = mountActions({ message });
    await bar.get('[data-test="assistant-msg-copy-md"]').trigger("click");
    const text = copy.mock.calls.at(-1)?.[0] as string;
    expect(text.startsWith("- Querying default\n\n")).toBe(true);
    expect(text).toMatch(
      /```sql\n-- stream default · \d\d:\d\d–\d\d:\d\d .+\nSELECT count\(\*\) FROM default\n```/,
    );
    expect(text).toMatch(/\n\nEvaluated \d\d:\d\d–\d\d:\d\d .+ · 1 query$/);
  });

  it("sources a fence the model wrote by the stream it reads, and leaves an unrelated one alone", async () => {
    const message: ChatMessage = {
      role: "assistant",
      content: raw(""),
      contentBlocks: [
        {
          type: "tool_call",
          tool: "SearchSQL",
          context: {
            stream_name: "default",
            sql: "SELECT 1",
            start_time: 1_700_000_000_000_000,
            end_time: 1_700_000_900_000_000,
          },
        },
        {
          type: "text",
          text: '```sql\nSELECT a FROM "default"\n```\n\n```sql\nSELECT b FROM other\n```',
        },
      ],
    };
    const bar = mountActions({ message });
    await bar.get('[data-test="assistant-msg-copy-md"]').trigger("click");
    const text = copy.mock.calls.at(-1)?.[0] as string;
    expect(text).toMatch(/```sql\n-- stream default · [^\n]+\nSELECT a FROM "default"/);
    expect(text).toContain("```sql\nSELECT b FROM other\n```");
  });
});
