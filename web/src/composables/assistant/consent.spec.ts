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
import { nextTick } from "vue";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/services/assistantAnalytics", () => ({ trackAssistant: track }));

import type { PaidOverageStatus } from "@/services/paidOverage";
import { raw } from "@/types/i18n";

import { fakeRuntime } from "./__tests__/fakeRuntime";
import type { AssistantHint, PendingConsent } from "./assistantStore.types";
import { cancelConsentOnClose, createConsentRuntime } from "./consent";

const status = (over: Partial<PaidOverageStatus> = {}): PaidOverageStatus => ({
  feature: "ai_credits",
  organization: { org_id: "org1", enabled: false, can_manage: true },
  payer: null,
  effective: false,
  billing_status: "eligible",
  ...over,
});

function setup(initial: PaidOverageStatus = status()) {
  const { store } = fakeRuntime();
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    thread: "new",
  });
  const session = store.state.sessions[sid];
  session.messages.push({ role: "user", content: raw("why?"), turnId: "turn-1" });
  session.turn = { state: "awaiting_consent" };
  const pending: PendingConsent = {
    org: "org1",
    feature: "ai_credits",
    status: initial,
    turnId: "turn-1",
    snapshot: { text: "why?", chips: [], images: [], mentions: [], timeOverride: null },
  };
  session.pendingConsent = pending;
  const handlers = new Map<string, (hint: AssistantHint) => void>();
  let visible: () => void = () => undefined;
  const deps = {
    state: () => store.state,
    send: vi.fn(async () => undefined),
    stop: vi.fn(async () => {
      session.pendingConsent = null;
    }),
    withdraw: vi.fn(() => {
      session.pendingConsent = null;
    }),
    enable: vi.fn(async (_org: string) => undefined),
    read: vi.fn(async () => status({ effective: true })),
    hints: {
      on: (type: string, handler: (hint: AssistantHint) => void) => {
        handlers.set(type, handler);
        return () => handlers.delete(type);
      },
      postFor: vi.fn(),
    },
    announce: vi.fn(),
    currentOrg: () => "org1",
    currentUser: () => "ada@example.com",
    now: () => 42,
    delay: async () => undefined,
    onVisible: (cb: () => void) => {
      visible = cb;
      return () => undefined;
    },
  };
  const consent = createConsentRuntime(deps as never);
  consent.onConsentRequired(sid, {} as never);
  return { store, sid, session, pending, consent, deps, handlers, focus: () => visible() };
}

describe("consent", () => {
  beforeEach(() => track.mockReset());

  it("shows the card on its session and counts it once", () => {
    const { consent, sid } = setup();
    expect(consent.view(sid)).toEqual({ state: "shown" });
    expect(track).toHaveBeenCalledWith("ai_consent", {
      step: "shown",
      surface: "chat",
      org_match: true,
      plan_type: "direct",
    });
  });

  it("PUTs every missing org, member first, then reads until in effect and resends the same turn id once", async () => {
    const { consent, sid, deps, session } = setup(
      status({ payer: { org_id: "payer1", enabled: false, can_manage: true } }),
    );
    deps.read
      .mockResolvedValueOnce(status({ effective: false }))
      .mockResolvedValueOnce(status({ effective: true }));
    await consent.resolve(sid, true, true);
    expect(deps.enable.mock.calls).toEqual([
      ["org1", "ai_credits"],
      ["payer1", "ai_credits"],
    ]);
    expect(deps.read).toHaveBeenCalledTimes(2);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith(sid, "turn-1");
    expect(deps.hints.postFor).toHaveBeenCalledWith("k1", {
      v: 1,
      type: "consent_granted",
      org: "org1",
      feature: "ai_credits",
      at: 42,
    });
    expect(session.messages.at(-1)?.contentBlocks).toEqual([
      { type: "consent_note", consentNote: { org: "org1", by: "ada@example.com", at: 42 } },
    ]);
    expect(deps.announce).toHaveBeenCalledWith(sid, "assistant.consent.resolvedHere");
  });

  it("keeps the card with an inline error when a PUT fails, and writes nothing more", async () => {
    const { consent, sid, deps } = setup();
    deps.enable.mockRejectedValueOnce(new Error("500"));
    await consent.resolve(sid, true, true);
    expect(consent.view(sid)).toEqual({ state: "error", error: "failed" });
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.hints.postFor).not.toHaveBeenCalled();
  });

  it("says still required when the status never comes into effect", async () => {
    const { consent, sid, deps } = setup();
    deps.read.mockResolvedValue(status({ effective: false }));
    await consent.resolve(sid, true, true);
    expect(consent.view(sid)).toEqual({ state: "error", error: "still_required" });
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("declines through Stop: nothing written, the waiting turn gives the prompt back", async () => {
    const { consent, sid, deps } = setup();
    await consent.resolve(sid, false);
    expect(deps.stop).toHaveBeenCalledWith(sid);
    expect(deps.enable).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("ai_consent", expect.objectContaining({ step: "declined" }));
  });

  it.each(["container_closed", "org_switch", "sign_out"] as const)(
    "cancels silently on %s",
    (reason) => {
      const { consent, sid, deps } = setup();
      track.mockReset();
      consent.cancel(sid, reason);
      expect(deps.stop).toHaveBeenCalledWith(sid);
      expect(deps.enable).not.toHaveBeenCalled();
      expect(track).not.toHaveBeenCalled();
    },
  );

  it("resolves itself when another tab granted it, and resends its own turn", async () => {
    const { consent, sid, deps, handlers } = setup();
    handlers.get("consent_granted")?.({
      v: 1,
      type: "consent_granted",
      org: "org1",
      feature: "ai_credits",
      at: 1,
    });
    await vi.waitFor(() => expect(deps.send).toHaveBeenCalledWith(sid, "turn-1"));
    expect(deps.announce).toHaveBeenCalledWith(sid, "assistant.consent.resolvedElsewhere");
    expect(track).toHaveBeenCalledWith(
      "ai_consent",
      expect.objectContaining({ step: "resolved_elsewhere" }),
    );
    expect(consent.view(sid)).toMatchObject({ state: "resolved_elsewhere", via: "tab" });
  });

  it("re-reads on focus, and stays as it was while the grant is not in effect", async () => {
    const { consent, sid, deps, focus } = setup();
    deps.read.mockResolvedValueOnce(status({ effective: false }));
    focus();
    await vi.waitFor(() => expect(deps.read).toHaveBeenCalled());
    await Promise.resolve();
    expect(deps.send).not.toHaveBeenCalled();
    expect(consent.view(sid)).toEqual({ state: "shown" });
    focus();
    await vi.waitFor(() => expect(deps.send).toHaveBeenCalledWith(sid, "turn-1"));
    expect(deps.announce).toHaveBeenCalledWith(sid, "assistant.consent.resolvedElsewhereFocus");
  });

  it("ignores a hint for another org, and one that arrives after the card was cancelled", async () => {
    const { consent, sid, deps, handlers } = setup();
    handlers.get("consent_granted")?.({
      v: 1,
      type: "consent_granted",
      org: "org2",
      feature: "ai_credits",
      at: 1,
    });
    await Promise.resolve();
    expect(deps.read).not.toHaveBeenCalled();
    consent.cancel(sid, "container_closed");
    handlers.get("consent_granted")?.({
      v: 1,
      type: "consent_granted",
      org: "org1",
      feature: "ai_credits",
      at: 1,
    });
    await Promise.resolve();
    expect(deps.read).not.toHaveBeenCalled();
  });

  it("grants every card of this tab waiting on the same org with one Enable", async () => {
    const { consent, sid, deps, store, pending } = setup();
    const other = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      thread: "new",
    });
    store.state.sessions[other].pendingConsent = { ...pending, turnId: "turn-2" };
    await consent.resolve(sid, true, true);
    expect(deps.send.mock.calls).toEqual([
      [sid, "turn-1"],
      [other, "turn-2"],
    ]);
    expect(deps.enable).toHaveBeenCalledTimes(1);
  });

  it("shows the resolved line before the resend, and sends nothing if the card is cancelled meanwhile", async () => {
    const { sid, deps } = setup();
    let release: () => void = () => undefined;
    deps.delay = () => new Promise<void>((resolve) => (release = resolve));
    const runtime = createConsentRuntime(deps as never);
    runtime.onConsentRequired(sid, {} as never);
    await runtime.resolve(sid, true, true);
    expect(runtime.view(sid)).toEqual({ state: "resolved_here" });
    expect(deps.send).not.toHaveBeenCalled();
    runtime.cancel(sid, "container_closed");
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("settles a non-turn caller's prompt on its session card", async () => {
    const { consent, store, deps } = setup();
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      thread: "new",
    });
    const answer = consent.promptFor(sid, "org1", "ai_credits", status());
    expect(store.state.sessions[sid].pendingConsent).toMatchObject({ org: "org1", turnId: "" });
    await consent.resolve(sid, true, true);
    await expect(answer).resolves.toBe(true);
    expect(store.state.sessions[sid].pendingConsent).toBeNull();
    expect(deps.send).not.toHaveBeenCalledWith(sid, expect.anything());
  });

  it("cancels the card of a container that closes, never one that only moves", async () => {
    const { store, sid } = setup();
    const cancel = vi.fn();
    const stop = cancelConsentOnClose(() => store.state, { cancel });
    store.open({ kind: "sidebar", mode: "pinned" }, { sid, focus: "none" });
    await nextTick();
    store.moveTo({ kind: "full" });
    await nextTick();
    expect(cancel).not.toHaveBeenCalled();
    store.close("close");
    await nextTick();
    expect(cancel).toHaveBeenCalledWith(sid, "container_closed");
    stop();
  });

  it("keeps the card when a docked chat moves to the full view, and cancels it when the editor closes", async () => {
    const cancel = vi.fn();
    const { store } = fakeRuntime({
      consent: { onConsentRequired: vi.fn(), resolve: vi.fn(), cancel },
    });
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      thread: "new",
    });
    store.state.sessions[sid].pendingConsent = setup().pending;
    const stop = cancelConsentOnClose(() => store.state, { cancel });
    store.open({ kind: "sidebar", mode: "pinned" }, { sid, focus: "none" });
    store.moveTo({ kind: "docked", hostId: "alert-editor" } as never);
    await nextTick();
    store.moveTo({ kind: "full" });
    await nextTick();
    expect(cancel).not.toHaveBeenCalled();
    store.moveTo({ kind: "docked", hostId: "alert-editor" } as never);
    await nextTick();
    store.close("close");
    await nextTick();
    expect(cancel).toHaveBeenCalledWith(sid, "container_closed");
    stop();
  });

  it("turns paid usage on only with the tick and an admin of every missing org", async () => {
    const { consent, sid, deps } = setup();
    await consent.resolve(sid, true);
    expect(deps.enable).not.toHaveBeenCalled();
    const member = setup(
      status({ organization: { org_id: "org1", enabled: false, can_manage: false } }),
    );
    await member.consent.resolve(member.sid, true, true);
    expect(member.deps.enable).not.toHaveBeenCalled();
  });

  it("names the feature it granted, and re-reads only cards waiting on that feature", async () => {
    const { consent, sid, deps } = setup();
    await consent.resolve(sid, true, true);
    expect(deps.hints.postFor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "consent_granted", feature: "ai_credits" }),
    );
    const other = setup();
    other.deps.read.mockClear();
    other.handlers.get("consent_granted")?.({
      v: 1,
      type: "consent_granted",
      org: "org1",
      feature: "other_feature" as never,
      at: 1,
    });
    expect(other.deps.read).not.toHaveBeenCalled();
  });

  it("keeps a grant made while a Stop waited, says so, and gives the prompt back unsent", async () => {
    const { consent, sid, deps, session } = setup();
    let finish: () => void = () => undefined;
    deps.enable.mockImplementation(
      () => new Promise<undefined>((r) => (finish = () => r(undefined))),
    );
    const enabling = consent.resolve(sid, true, true);
    expect(consent.busy?.(sid)).toBe(true);
    consent.cancel(sid, "stopped");
    await consent.resolve(sid, false);
    expect(deps.stop).not.toHaveBeenCalled();
    finish();
    await enabling;
    expect(deps.stop).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.withdraw).toHaveBeenCalledWith(sid);
    expect(session.messages.at(-1)?.contentBlocks?.[0]?.consentNote).toMatchObject({
      org: "org1",
    });
    expect(deps.hints.postFor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "consent_granted" }),
    );
  });

  it("takes a Stop while the enabled line shows as a stop after paid usage went on: note, prompt back, nothing sent", async () => {
    const { sid, deps, session } = setup();
    let release: () => void = () => undefined;
    deps.delay = () => new Promise<void>((resolve) => (release = resolve));
    const runtime = createConsentRuntime(deps as never);
    runtime.onConsentRequired(sid, {} as never);
    await runtime.resolve(sid, true, true);
    expect(runtime.busy?.(sid)).toBe(true);
    runtime.cancel(sid, "stopped");
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.stop).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.withdraw).toHaveBeenCalledWith(sid);
    expect(session.messages.at(-1)?.contentBlocks?.[0]?.consentNote).toMatchObject({
      org: "org1",
    });
  });

  it("drops a Stop deferred into the enabled line when the card goes another way, so the next card's Enable still sends", async () => {
    const { sid, deps, session, pending } = setup();
    let release: () => void = () => undefined;
    deps.delay = () => new Promise<void>((resolve) => (release = resolve));
    const runtime = createConsentRuntime(deps as never);
    runtime.onConsentRequired(sid, {} as never);
    await runtime.resolve(sid, true, true);
    runtime.cancel(sid, "stopped");
    session.pendingConsent = null;
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.turn = { state: "awaiting_consent" };
    session.pendingConsent = { ...pending, status: status() };
    runtime.onConsentRequired(sid, {} as never);
    await runtime.resolve(sid, true, true);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.withdraw).not.toHaveBeenCalled();
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it("reports a partial Enable stopped meanwhile as what went on, never as nothing written", async () => {
    const { consent, sid, deps, session } = setup(
      status({ payer: { org_id: "payer1", enabled: false, can_manage: true } }),
    );
    let fail: () => void = () => undefined;
    deps.enable.mockImplementation(async (org: string) => {
      if (org === "payer1")
        await new Promise<void>((_, reject) => (fail = () => reject(new Error("500"))));
    });
    const enabling = consent.resolve(sid, true, true);
    await Promise.resolve();
    await Promise.resolve();
    consent.cancel(sid, "container_closed");
    fail();
    await enabling;
    expect(deps.enable.mock.calls.map((call) => call[0])).toEqual(["org1", "payer1"]);
    expect(deps.stop).not.toHaveBeenCalled();
    expect(deps.withdraw).toHaveBeenCalledWith(sid);
    expect(session.messages.at(-1)?.contentBlocks?.[0]?.consentNote).toMatchObject({
      org: "org1",
    });
  });

  it("runs the cancel asked meanwhile once an Enable fails, so nothing was written", async () => {
    const { consent, sid, deps } = setup();
    let fail: () => void = () => undefined;
    deps.enable.mockImplementation(
      () => new Promise<undefined>((_, reject) => (fail = () => reject(new Error("500")))),
    );
    const enabling = consent.resolve(sid, true, true);
    consent.cancel(sid, "container_closed");
    fail();
    await enabling;
    expect(deps.stop).toHaveBeenCalledWith(sid);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("answers a non-turn caller when its chat goes away, as on a sign-out", async () => {
    const { consent, store } = setup();
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      thread: "new",
    });
    const answer = consent.promptFor(sid, "org1", "ai_credits", status());
    await nextTick();
    delete store.state.sessions[sid];
    await nextTick();
    await expect(answer).resolves.toBe(false);
    expect(consent.view(sid)).toBeNull();
  });
});
