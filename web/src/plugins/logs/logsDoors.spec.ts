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

import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  open: vi.fn(),
  queueDockStage: vi.fn(),
  gate: { value: "available" },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  openAssistant: env.open,
  queueDockStage: env.queueDockStage,
}));
vi.mock("@/composables/assistant/pure", async (importOriginal) => {
  const { computed } = await import("vue");
  return {
    ...(await importOriginal<typeof import("@/composables/assistant/pure")>()),
    runtimeHandle: () => ({ value: null }),
    useAssistantGate: () => computed(() => env.gate.value),
  };
});

import {
  addDoorToChat,
  regexFieldHandoff,
  rowKeyOf,
  useAssistantDoorShown,
  type ChatDoor,
  type LogsDoorBase,
} from "./logsDoors";
import { closeLockedPanel, useLockedPanel } from "@/components/ai-assistant/shell/shellHelpers";

const chip = { kind: "log_row", ref: { org: "org-b" }, sizeBytes: 1 };
const door = (chips: unknown[] = [chip]): ChatDoor => ({
  entryKind: "object_verb",
  objectKind: "log_row",
  boundOrg: "org-a",
  build: () => ({ text: "explain", chips }) as never,
});

beforeEach(() => {
  env.queueDockStage.mockClear();
  env.open.mockReset();
  env.open.mockResolvedValue({ ok: true });
});

describe("addDoorToChat", () => {
  it("stages only the chips, stamped with the bound org, in the current chat and reveals it", async () => {
    await addDoorToChat(door(), "u|org-a");
    expect(env.open).toHaveBeenCalledWith(
      expect.objectContaining({
        entryVerb: "add_to_chat",
        intent: "stage",
        thread: "current",
        reveal: true,
        payload: { chips: [{ ...chip, ref: { org: "org-a" } }] },
        userOrgKey: "u|org-a",
      }),
    );
  });

  it("opens the chat without staging when the builder gives no chips, and sends no key it was not given", async () => {
    await addDoorToChat(door([]), null);
    const args = env.open.mock.calls[0][0];
    expect(args.intent).toBe("open");
    expect(args).not.toHaveProperty("userOrgKey");
  });

  it("returns openAssistant's result so the drawer can close only on ok", async () => {
    env.open.mockResolvedValueOnce({ ok: false, reason: "org_changed" });
    await expect(addDoorToChat(door())).resolves.toEqual({ ok: false, reason: "org_changed" });
    expect(useLockedPanel().value).toBeNull();
  });

  it("opens the locked panel for a locked gate, returning focus to the toolbar's cell", async () => {
    const cell = document.createElement("td");
    env.open.mockResolvedValueOnce({ ok: false, reason: "no_permission" });
    await addDoorToChat(door(), "u|org-a", cell);
    expect(env.open.mock.calls[0][0].invoker).toBe(cell);
    expect(useLockedPanel().value).toEqual({ invoker: cell });
    closeLockedPanel();
  });
});

describe("useAssistantDoorShown", () => {
  it.each([
    ["available", true],
    ["off_for_org", true],
    ["loading", false],
    ["not_entitled", false],
    ["not_configured", false],
  ])("gate %s shows the button: %s", (gate, shown) => {
    env.gate.value = gate;
    expect(useAssistantDoorShown().value).toBe(shown);
  });
});

const base = {
  org: "default",
  stream: "checkout",
  streamType: "logs",
  range: { from: 1_000, to: 2_000 },
} as unknown as LogsDoorBase;

describe("regexFieldHandoff", () => {
  it("queues the prompt for the regex dock and hands the bounded sample to the drawer", async () => {
    const go = vi.fn();
    await regexFieldHandoff(base, "card", "4111 1111 1111 1111", go);
    const [host, payload] = env.queueDockStage.mock.calls[0];
    expect(host).toBe("regex");
    expect(payload.text).toContain("in field `card`");
    expect(payload.text).not.toContain("4111");
    expect(go).toHaveBeenCalledWith({ prompt: payload.text, sample: "4111 1111 1111 1111" });
  });

  it("redacts a secret-named field's value in the chip and in the drawer's test value", async () => {
    const go = vi.fn();
    await regexFieldHandoff(base, "password", "hunter2", go);
    const [, payload] = env.queueDockStage.mock.calls[0];
    expect(JSON.stringify(payload.chips)).not.toContain("hunter2");
    expect(go.mock.calls[0][0].sample).not.toContain("hunter2");
  });
});

describe("rowKeyOf", () => {
  it("keys different rows with the same stream and timestamp apart, and the same row alike", () => {
    const first = { _stream_name: "checkout", _timestamp: 1_000, message: "first log" };
    const second = { _stream_name: "checkout", _timestamp: 1_000, message: "different log" };
    expect(rowKeyOf(first)).not.toBe(rowKeyOf(second));
    expect(rowKeyOf({ message: "first log", _timestamp: 1_000, _stream_name: "checkout" })).toBe(
      rowKeyOf(first),
    );
  });

  it("keeps the record id as the key when the row has one", () => {
    expect(rowKeyOf({ _o2_id: "abc", _timestamp: 1, message: "x" })).toBe("abc");
  });
});
