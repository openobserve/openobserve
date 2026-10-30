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

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

import { fakeRuntime } from "./__tests__/fakeRuntime";
import type { AssistantHostAdapter } from "./assistantStore.types";
import { diffCounts, diffLines } from "./lineDiff";
import { setRuntimeHandle } from "./runtimeHandle";
import {
  MAX_PROPOSAL_CHARS,
  discardProposals,
  proposalFor,
  resetEditorProposalsForTests,
  useEditorProposal,
  withProvenance,
} from "./useEditorProposal";

const { runtime, lg, track, toast } = vi.hoisted(() => ({
  runtime: { current: null as any },
  lg: { value: true },
  track: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));

vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: track,
}));
vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return { default: () => ({ lgUp: computed(() => lg.value), mdUp: computed(() => lg.value) }) };
});

function editor(initial = 'SELECT * FROM "default"') {
  const text = ref(initial);
  const language = ref<"sql" | "promql">("sql");
  const writes: string[] = [];
  const host = {
    id: "alert_query",
    language: "sql",
    getBuffer: () => text.value,
    run: vi.fn(),
    focusEditor: vi.fn(),
  } as unknown as AssistantHostAdapter;
  const scope = effectScope();
  const proposal = scope.run(() =>
    useEditorProposal(host, {
      write(next) {
        writes.push(next);
        text.value = next;
      },
      language: () => language.value,
      now: () => 1_700_000_000_000,
    }),
  )!;
  return { text, language, writes, host, proposal, scope };
}

const PROVENANCE = { prompt: "add p95 latency" };

beforeEach(() => {
  sessionStorage.clear();
  runtime.current = fakeRuntime();
  setRuntimeHandle(runtime.current);
  lg.value = true;
  track.mockClear();
});

afterEach(() => resetEditorProposalsForTests());

describe("useEditorProposal", () => {
  it("shows the diff without touching the editor, and Reject leaves it byte-identical", async () => {
    const { text, writes, proposal } = editor();
    const before = text.value;
    const handle = await proposal.propose('SELECT count(*) FROM "default"', {
      mode: "replace",
      provenance: PROVENANCE,
      canRun: true,
    });
    expect(proposal.pending.value?.before).toBe(before);
    expect(text.value).toBe(before);
    handle.reject();
    expect(await handle.decision).toBe("rejected");
    expect(text.value).toBe(before);
    expect(writes).toEqual([]);
    expect(proposal.pending.value).toBeNull();
  });

  it("lands an Accept as one write with the provenance line first, then labels it", async () => {
    const { text, writes, proposal } = editor();
    const handle = await proposal.propose("SELECT 1", {
      mode: "replace",
      provenance: PROVENANCE,
      canRun: false,
    });
    handle.accept();
    expect(await handle.decision).toBe("accepted");
    expect(writes).toEqual(["-- add p95 latency\nSELECT 1"]);
    expect(text.value).toBe("-- add p95 latency\nSELECT 1");
    expect(proposal.label.value).toMatchObject({
      status: "written",
      originalText: 'SELECT * FROM "default"',
      acceptedAt: 1_700_000_000_000,
    });
  });

  it("runs the host's action once on Accept and run, never on Accept", async () => {
    const { host, proposal } = editor();
    const first = await proposal.propose("SELECT 1", {
      mode: "replace",
      provenance: PROVENANCE,
      canRun: true,
    });
    first.accept();
    expect(host.run).not.toHaveBeenCalled();
    const second = await proposal.propose("SELECT 2", {
      mode: "replace",
      provenance: PROVENANCE,
      canRun: true,
    });
    second.acceptAndRun();
    second.acceptAndRun();
    expect(host.run).toHaveBeenCalledTimes(1);
  });

  it("treats typing in the editor as a Reject, so the chat's Insert settles as discarded", async () => {
    const { text, writes, proposal } = editor();
    const handle = await proposal.propose("SELECT 1", {
      mode: "replace",
      provenance: PROVENANCE,
      canRun: false,
    });
    text.value = 'SELECT * FROM "default" WHERE x';
    await nextTick();
    expect(await handle.decision).toBe("discarded");
    expect(writes).toEqual([]);
  });

  it("shows no diff when the proposal equals the buffer", async () => {
    const { proposal } = editor("SELECT 1");
    const handle = await proposal.propose("  SELECT 1\n", {
      mode: "replace",
      provenance: PROVENANCE,
      canRun: false,
    });
    expect(await handle.decision).toBe("no_change");
    expect(proposal.pending.value).toBeNull();
  });

  it("reads the same query inserted twice as no change, though the first Accept added its provenance line", async () => {
    const { proposal } = editor("SELECT 0");
    const first = await proposal.propose("SELECT 1", {
      mode: "replace",
      provenance: PROVENANCE,
      canRun: false,
    });
    first.accept();
    const again = await proposal.propose("SELECT 1", {
      mode: "replace",
      provenance: PROVENANCE,
      canRun: false,
    });
    expect(await again.decision).toBe("no_change");
    expect(proposal.pending.value).toBeNull();
  });

  it("drops what belonged to the other tab: a tab switch discards the diff and the label", async () => {
    const { language, writes, proposal } = editor("SELECT 0");
    const accepted = await proposal.propose("SELECT 1", {
      mode: "replace",
      provenance: PROVENANCE,
      canRun: false,
    });
    accepted.accept();
    expect(proposal.label.value?.language).toBe("sql");
    const pending = await proposal.propose("SELECT 2", {
      mode: "replace",
      provenance: PROVENANCE,
      canRun: false,
    });
    language.value = "promql";
    await nextTick();
    expect(await pending.decision).toBe("discarded");
    expect(proposal.label.value).toBeNull();
    proposal.revert("original");
    expect(writes).toHaveLength(1);
  });

  it("settles an open proposal as discarded when the host closes, so the chat's Insert never hangs", async () => {
    const { proposal } = editor();
    const handle = await proposal.propose("SELECT 1", {
      mode: "replace",
      provenance: PROVENANCE,
      canRun: false,
    });
    proposal.clear();
    expect(await handle.decision).toBe("discarded");
    expect(proposal.pending.value).toBeNull();
  });

  it("reverts two ways after an edit: to the assistant's version, or to my original", async () => {
    const { text, host, proposal } = editor("SELECT a");
    const handle = await proposal.propose("SELECT b", {
      mode: "replace",
      provenance: { prompt: "" },
      canRun: false,
    });
    handle.accept();
    text.value = "SELECT b, c";
    await nextTick();
    expect(proposal.label.value?.status).toBe("edited");
    proposal.revert("assistant");
    expect(text.value).toBe("SELECT b");
    expect(proposal.label.value?.status).toBe("written");
    proposal.revert("original");
    expect(text.value).toBe("SELECT a");
    expect(proposal.label.value).toBeNull();
    await nextTick();
    // The label's button is gone, so focus lands in the editor and the change is said.
    expect(host.focusEditor).toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith({
      variant: "default",
      message: "Restored your original.",
    });
    expect(track).toHaveBeenCalledWith("ai_nl_decided", {
      decision: "revert",
      validated: "skipped",
    });
  });

  it("keeps the first original across two Accepts in one editor session", async () => {
    const { text, proposal } = editor("SELECT a");
    (
      await proposal.propose("SELECT b", {
        mode: "replace",
        provenance: { prompt: "" },
        canRun: false,
      })
    ).accept();
    (
      await proposal.propose("SELECT c", {
        mode: "replace",
        provenance: { prompt: "" },
        canRun: false,
      })
    ).accept();
    expect(proposal.label.value?.originalText).toBe("SELECT a");
    proposal.revert("original");
    expect(text.value).toBe("SELECT a");
  });

  it("appends after the buffer on a new line in append mode", async () => {
    const { text, proposal } = editor("a");
    (
      await proposal.propose("b", { mode: "append", provenance: { prompt: "" }, canRun: false })
    ).accept();
    expect(text.value).toBe("a\nb");
  });

  it("caps a proposal's size, so model output cannot grow the editor without bound", async () => {
    const { text, proposal } = editor("");
    const huge = "x".repeat(MAX_PROPOSAL_CHARS + 50);
    (
      await proposal.propose(huge, { mode: "replace", provenance: { prompt: "" }, canRun: false })
    ).accept();
    expect(text.value.length).toBe(MAX_PROPOSAL_CHARS);
  });

  it("peeks the docked sheet on a phone and returns it to half after the decision", async () => {
    lg.value = false;
    const rt = runtime.current as ReturnType<typeof fakeRuntime>;
    rt.hosts.register({
      id: "alert_query",
      dockSlot: ref(null),
    } as unknown as AssistantHostAdapter);
    rt.store.open({ kind: "docked", hostId: "alert_query" }, { focus: "none" });
    const { proposal, host } = editor();
    const handle = await proposal.propose("SELECT 1", {
      mode: "replace",
      provenance: PROVENANCE,
      canRun: false,
    });
    expect(rt.store.state.shell.sheetSnap).toBe("peek");
    handle.reject();
    await flushPromises();
    expect(rt.store.state.shell.sheetSnap).toBe("half");
    expect(host.focusEditor).toHaveBeenCalled();
  });

  it("registers per host for the applier, discards on an org switch and on unmount", async () => {
    const { proposal, scope } = editor();
    expect(proposalFor("alert_query")).toBe(proposal);
    const handle = await proposal.propose("SELECT 1", {
      mode: "replace",
      provenance: PROVENANCE,
      canRun: false,
    });
    discardProposals();
    expect(await handle.decision).toBe("discarded");
    scope.stop();
    expect(proposalFor("alert_query")).toBeNull();
  });

  it("clears the label on save without touching the text", async () => {
    const { text, proposal } = editor("SELECT a");
    (
      await proposal.propose("SELECT b", {
        mode: "replace",
        provenance: { prompt: "" },
        canRun: false,
      })
    ).accept();
    proposal.clear();
    expect(proposal.label.value).toBeNull();
    expect(text.value).toBe("SELECT b");
  });
});

describe("withProvenance", () => {
  it("comments the prompt in the host's language, on one line, and never for JSON or regex", () => {
    expect(withProvenance("x", "sql", { prompt: "a\nb" })).toBe("-- a b\nx");
    expect(withProvenance("x", "vrl", { prompt: "a" })).toBe("# a\nx");
    expect(withProvenance("x", "promql", { prompt: "a" })).toBe("# a\nx");
    expect(withProvenance("x", "js", { prompt: "a" })).toBe("// a\nx");
    expect(withProvenance("x", "json", { prompt: "a" })).toBe("x");
    expect(withProvenance("x", "regex", { prompt: "a" })).toBe("x");
    expect(withProvenance("x", "sql", { prompt: "" })).toBe("x");
  });
});

describe("line diff", () => {
  it("counts added and removed lines, and an empty side has no lines", () => {
    expect(diffCounts("a\nb\nc", "a\nB\nc\nd")).toEqual({ added: 2, removed: 1 });
    expect(diffCounts("", "a\nb")).toEqual({ added: 2, removed: 0 });
    expect(diffLines("a", "a")).toEqual([{ kind: "same", text: "a" }]);
  });

  it("refuses to count a side over the line cap", () => {
    expect(diffLines("x\n".repeat(1_001), "y")).toBeNull();
  });
});
