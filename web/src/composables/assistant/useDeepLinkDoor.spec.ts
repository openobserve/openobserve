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
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

import {
  fakeAssistant,
  fakeRouter,
  fakeVuex,
} from "@/components/ai-assistant/__tests__/fakeAssistant";
import { raw } from "@/types/i18n";

import type { GateCode } from "./assistantStore.types";
import { useDeepLinkDoor, type DeepLinkDoorDeps } from "./useDeepLinkDoor";

const { fake, track } = vi.hoisted(() => ({ fake: { current: null as any }, track: vi.fn() }));

vi.mock("./useAssistantCapability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useAssistantCapability")>()),
  useAssistantCapability: () => fake.current.handle,
}));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: track,
}));

const chip = {
  id: "door:alert:a1",
  kind: "alert" as const,
  label: raw("Alert · Checkout 5xx"),
  ref: { type: "alert", id: "a1", org: "default" },
  sizeBytes: 0,
  provenance: "door" as const,
  sent: "not_read" as const,
};

async function visit(
  url: string,
  gate: GateCode = "available",
  deps: Partial<DeepLinkDoorDeps> = {},
) {
  fake.current = fakeAssistant(gate);
  const open = vi.fn();
  const notify = vi.fn();
  const resolve = vi.fn(async (ref: string) =>
    ref === "a1"
      ? { chips: [chip], text: "Explain alert “Checkout 5xx”.", title: raw("Alert · Checkout 5xx") }
      : null,
  );
  const router = fakeRouter();
  await router.push(url);
  let blocked: ReturnType<typeof useDeepLinkDoor>["blocked"] | null = null;
  const Host = defineComponent({
    setup() {
      blocked = useDeepLinkDoor({
        open,
        notify,
        resolvers: { alert: { objectKind: "alert", resolve } },
        userOrgKey: () => "ada@example.com|default",
        ...deps,
      }).blocked;
      return () => h("div");
    },
  });
  mount(Host, { global: { plugins: [router, fakeVuex()] } });
  await flushPromises();
  return { open, notify, resolve, router, blocked: () => blocked?.value ?? null };
}

afterEach(() => track.mockClear());

describe("useDeepLinkDoor (DG-13)", () => {
  it("stages the object's prompt and chip, never sends, and strips the keys", async () => {
    const { open, router, resolve } = await visit(
      "/logs?assistant=explain&object=alert&ref=a1&keep=1",
    );
    expect(resolve).toHaveBeenCalledWith(
      "a1",
      expect.objectContaining({ org: "default", verb: "explain" }),
    );
    expect(open).toHaveBeenCalledWith({
      entryKind: "deep_link",
      entryVerb: "explain",
      objectKind: "alert",
      intent: "stage",
      thread: "new",
      payload: expect.objectContaining({ chips: [chip] }),
      userOrgKey: "ada@example.com|default",
    });
    expect(open.mock.calls.every(([args]) => args.intent !== "send")).toBe(true);
    expect(router.currentRoute.value.query).toEqual({ keep: "1" });
  });

  it("toasts and opens empty for an unknown object or a ref that does not resolve", async () => {
    for (const url of [
      "/logs?assistant=explain&object=alert&ref=missing",
      "/logs?assistant=explain&object=nope&ref=x",
    ]) {
      const { open, notify, router } = await visit(url);
      expect(notify).toHaveBeenCalledWith("Couldn't find that item to ask about");
      expect(open).toHaveBeenCalledWith(
        expect.objectContaining({ intent: "open", objectKind: "none" }),
      );
      expect(router.currentRoute.value.query).toEqual({});
    }
  });

  it("opens the assistant for a plain ?assistant=open", async () => {
    const { open } = await visit("/logs?assistant=open");
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ entryKind: "deep_link", entryVerb: "ask", intent: "open" }),
    );
  });

  it.each(["no_permission", "not_entitled", "off_for_org"] as GateCode[])(
    "shows the %s gate banner instead and reports ai_gate_blocked{cta: deep_link}",
    async (gate) => {
      const { open, blocked, router } = await visit(
        "/logs?assistant=explain&object=alert&ref=a1",
        gate,
      );
      expect(open).not.toHaveBeenCalled();
      expect(blocked()).toBe(gate);
      expect(track).toHaveBeenCalledWith("ai_gate_blocked", { reason: gate, cta: "deep_link" });
      expect(router.currentRoute.value.query).toEqual({});
      await router.push("/");
      await flushPromises();
      expect(blocked()).toBeNull();
    },
  );

  it("waits for a loading gate before deciding", async () => {
    const { open } = await visit("/logs?assistant=explain&object=alert&ref=a1", "loading");
    expect(open).not.toHaveBeenCalled();
    fake.current.capability.value = { ...fake.current.capability.value, gate: "available" };
    await flushPromises();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ intent: "stage" }));
  });

  it("never resolves a ref that is not id-shaped (S4)", async () => {
    const { open, notify, resolve } = await visit(
      "/logs?assistant=explain&object=alert&ref=..%2F..%2Fapi%2Fdefault%2Fusers",
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Couldn't find that item to ask about");
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ intent: "open" }));
  });

  it("lets a newer link supersede one still waiting on the gate (S8)", async () => {
    const { open, router } = await visit("/logs?assistant=explain&object=alert&ref=a1", "loading");
    await router.push("/logs?assistant=open");
    await flushPromises();
    fake.current.capability.value = { ...fake.current.capability.value, gate: "available" };
    await flushPromises();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ intent: "open" }));
  });

  it("does nothing on a route without the keys", async () => {
    const { open, notify } = await visit("/logs?keep=1");
    expect(open).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
