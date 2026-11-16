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

const env = vi.hoisted(() => ({ open: vi.fn(), gate: { value: "available" } }));

vi.mock("@/composables/assistant", () => ({ openAssistant: env.open }));
vi.mock("@/composables/assistant/pure", async () => {
  const { computed } = await import("vue");
  return {
    runtimeHandle: () => ({ value: null }),
    useAssistantGate: () => computed(() => env.gate.value),
  };
});

import { addDoorToChat, useAssistantDoorShown, type ChatDoor } from "./logsDoors";
import { closeLockedPanel, useLockedPanel } from "@/components/ai-assistant/shell/lockedPanel";

const chip = { kind: "log_row", ref: { org: "org-b" }, sizeBytes: 1 };
const door = (chips: unknown[] = [chip]): ChatDoor => ({
  entryKind: "object_verb",
  objectKind: "log_row",
  boundOrg: "org-a",
  build: () => ({ text: "explain", chips }) as never,
});

beforeEach(() => {
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
