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

import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

const promptForConsent = vi.hoisted(() => vi.fn());
vi.mock("@/composables/usePaidOverageConsent", () => ({
  usePaidOverageConsent: () => ({ promptForConsent }),
}));

import type { PaidOverageStatus } from "@/services/paidOverage";

import { fakeRuntime } from "./__tests__/fakeRuntime";
import { createTurnConsent, isMeteredCredit, orgDisplayName } from "./consent";

const status = {
  feature: "ai_credits",
  organization: { org_id: "org1", enabled: false, can_manage: true },
  payer: null,
  effective: false,
  billing_status: "eligible",
} as PaidOverageStatus;

function setup(answer: Promise<boolean>) {
  promptForConsent.mockReset().mockReturnValue(answer);
  const { store } = fakeRuntime();
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    thread: "new",
  });
  const session = store.state.sessions[sid];
  session.turn = { state: "awaiting_consent" };
  session.turnMeta.turnId = "turn-1";
  const deps = { state: () => store.state, send: vi.fn(), stop: vi.fn() };
  createTurnConsent(deps)(sid, { org: "org1", status, turnId: "turn-1" });
  return { sid, session, deps };
}

describe("createTurnConsent", () => {
  it("asks the shared chat prompt and resends the same turn on accept", async () => {
    const { sid, deps } = setup(Promise.resolve(true));
    expect(promptForConsent).toHaveBeenCalledWith(
      "org1",
      "ai_credits",
      status,
      expect.any(AbortSignal),
      "chat",
    );
    await Promise.resolve();
    expect(deps.send).toHaveBeenCalledWith(sid, "turn-1");
    expect(deps.stop).not.toHaveBeenCalled();
  });

  it("stops the waiting turn on decline", async () => {
    const { sid, deps } = setup(Promise.resolve(false));
    await Promise.resolve();
    expect(deps.stop).toHaveBeenCalledWith(sid);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("withdraws the prompt once the turn stops waiting, and does nothing on its answer", async () => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const { session, deps } = setup(promise);
    const signal: AbortSignal = promptForConsent.mock.calls[0][3];
    session.turn = { state: "idle" };
    await nextTick();
    expect(signal.aborted).toBe(true);
    resolve(false);
    await Promise.resolve();
    expect(deps.stop).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });
});

describe("consent helpers", () => {
  it("meters only where a turn can cost money", () => {
    expect(isMeteredCredit("consent_required")).toBe(true);
    expect(isMeteredCredit("pay_as_you_go")).toBe(true);
    expect(isMeteredCredit(undefined)).toBe(false);
  });

  it("names the selected org by its label, any other by its id", () => {
    expect(orgDisplayName("o1", { identifier: "o1", label: "Acme" })).toBe("Acme");
    expect(orgDisplayName("o2", { identifier: "o1", label: "Acme" })).toBe("o2");
  });
});
