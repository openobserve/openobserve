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
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";

import { makeEnv } from "../__tests__/actionEnv";
import type { AssistantHostAdapter } from "../../assistantStore.types";
import { setRuntimeHandle } from "../../runtimeHandle";
import { resetEditorProposalsForTests, useEditorProposal } from "../../useEditorProposal";
import { applyAction, createActionDispatcher, registerApplier } from "../registry";
import type { AssistantAction } from "../types";
import { editorApplier } from "./editor";

type Insert = Extract<AssistantAction, { kind: "insert_into_editor" }>;

const insert = (over: Partial<Insert> = {}): Insert => ({
  kind: "insert_into_editor",
  text: "SELECT 2",
  language: "sql",
  hostId: "alert_query",
  mode: "replace",
  provenance: { prompt: "count the rows" },
  ...over,
});

function host(over: Partial<AssistantHostAdapter> = {}, initial = "SELECT 1") {
  const text = ref(initial);
  const adapter = {
    id: "alert_query",
    language: "sql",
    getBuffer: () => text.value,
    run: vi.fn(),
    focusEditor: vi.fn(),
    dockSlot: ref(null),
    ...over,
  } as unknown as AssistantHostAdapter;
  return { adapter, text };
}

function setup(over: Partial<AssistantHostAdapter> = {}, write?: (text: string) => unknown) {
  const made = makeEnv();
  setRuntimeHandle({ store: made.store, hosts: made.env.hosts } as never);
  const { adapter, text } = host(over);
  const save = vi.fn();
  const proposal = effectScope().run(() =>
    useEditorProposal(adapter, {
      write: (next) => (write ? (write(next) as never) : void (text.value = next)),
    }),
  )!;
  vi.mocked(made.env.hosts.get).mockImplementation((id) =>
    id === adapter.id ? adapter : undefined,
  );
  const announce = vi.spyOn(made.store, "announce");
  return { ...made, adapter, text, proposal, save, announce };
}

afterEach(() => resetEditorProposalsForTests());

describe("editor applier", () => {
  it("needs a mounted host whose language matches the block", async () => {
    const { env, sid } = makeEnv();
    setRuntimeHandle({ store: env.store(), hosts: env.hosts } as never);
    await expect(editorApplier(sid, insert(), env)).resolves.toEqual({
      ok: false,
      reason: "needs_host",
    });
    const vrl = setup({ language: "vrl" });
    await expect(editorApplier(vrl.sid, insert(), vrl.env)).resolves.toEqual({
      ok: false,
      reason: "needs_host",
    });
  });

  it("shows the diff, announces its counts once, and lands only on Accept", async () => {
    const { env, sid, text, proposal, announce } = setup();
    const result = editorApplier(sid, insert(), env);
    await flushPromises();
    expect(text.value).toBe("SELECT 1");
    expect(announce).toHaveBeenCalledWith(sid, "assistant.diff.announce", {
      language: "SQL",
      added: 2,
      removed: 1,
    });
    proposal.pending.value!.accept();
    await expect(result).resolves.toEqual({
      ok: true,
      detail: { decision: "accepted", note: null },
    });
    expect(text.value).toBe("-- count the rows\nSELECT 2");
    expect(announce).toHaveBeenLastCalledWith(sid, "assistant.diff.applied");
  });

  it("never saves or runs: Reject restores and Accept runs nothing", async () => {
    const { env, sid, adapter, text, proposal } = setup();
    const rejected = editorApplier(sid, insert(), env);
    await flushPromises();
    proposal.pending.value!.reject();
    await expect(rejected).resolves.toMatchObject({ detail: { decision: "rejected" } });
    expect(text.value).toBe("SELECT 1");
    const accepted = editorApplier(sid, insert(), env);
    await flushPromises();
    proposal.pending.value!.accept();
    await accepted;
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it("reports the JSON editor's protected-field merge", async () => {
    const write = vi.fn(() => ({
      text: '{"name":"kept"}',
      note: "assistant.editor.protectedFields",
    }));
    const { env, sid, proposal } = setup({ language: "sql" }, write);
    const result = editorApplier(sid, insert({ text: '{"name":"changed"}' }), env);
    await flushPromises();
    proposal.pending.value!.accept();
    await expect(result).resolves.toEqual({
      ok: true,
      detail: { decision: "accepted", note: "assistant.editor.protectedFields" },
    });
    expect(proposal.label.value?.assistantText).toBe('{"name":"kept"}');
  });

  it("says when the editor already holds the proposal", async () => {
    const { env, sid, announce } = setup();
    await expect(editorApplier(sid, insert({ text: "SELECT 1" }), env)).resolves.toMatchObject({
      detail: { decision: "no_change" },
    });
    expect(announce).toHaveBeenCalledWith(sid, "assistant.helper.noChange");
  });

  it("is refused for a chat of another org before any diff shows", async () => {
    const made = setup();
    createActionDispatcher(made.env);
    registerApplier("insert_into_editor", editorApplier);
    vi.mocked(made.env.currentOrg).mockReturnValue("org2");
    await expect(applyAction(made.sid, insert())).resolves.toEqual({
      ok: false,
      reason: "other_org",
    });
    expect(made.proposal.pending.value).toBeNull();
  });
});
