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
import { describe, expect, it, vi } from "vitest";

import { fakeRouter } from "@/components/ai-assistant/__tests__/fakeAssistant";

import AssistantStatusCard, {
  epochMs,
  type AssistantStatusCardProps,
} from "./AssistantStatusCard.vue";

vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: vi.fn(),
}));

const NOW = Date.now();

const OK = {
  health: { status: "ok" as const, checked_at: NOW - 30_000 },
  model: "gpt-x",
  agent_version: "1.4.0",
};

const mountCard = (props: Partial<AssistantStatusCardProps> = {}) =>
  mount(AssistantStatusCard, {
    props: {
      capabilities: OK,
      status: "ready",
      config: { aiEnabled: true },
      isAdmin: true,
      testState: "idle",
      ...props,
    },
    global: { plugins: [fakeRouter()] },
  });

const chip = (w: ReturnType<typeof mountCard>) =>
  w.find('[data-test="settings-assistant-status-chip"]').text();

describe("AssistantStatusCard", () => {
  it("shows the admin setup card with the three deployment rows when the assistant is not set up", () => {
    const w = mountCard({ config: { aiEnabled: false } });
    expect(w.find('[data-test="settings-assistant-setup-card"]').exists()).toBe(true);
    expect(w.find('[data-test="assistant-gate-setup"]').exists()).toBe(true);
    for (const env of ["O2_AI_ENABLED", "O2_AGENT_URL", "O2_AI_HA_ENABLED"]) {
      expect(w.find(`[data-test="settings-assistant-env-${env}"]`).exists()).toBe(true);
    }
    expect(w.find('[data-test="settings-assistant-env-O2_AI_ENABLED-value"]').text()).toBe("false");
    expect(w.find('[data-test="settings-assistant-test-btn"]').exists()).toBe(false);
  });

  it("tells a member to ask an administrator, without docs or deployment rows", () => {
    const w = mountCard({ config: { aiEnabled: false }, isAdmin: false });
    expect(w.find('[data-test="settings-assistant-setup-card"]').exists()).toBe(true);
    expect(chip(w)).toBe("Not set up");
    expect(w.text()).toContain(
      "The assistant isn't set up for this deployment. Ask an administrator.",
    );
    expect(w.find('[data-test="assistant-gate-setup"]').exists()).toBe(false);
    expect(w.find('[data-test="settings-assistant-env-O2_AGENT_URL"]').exists()).toBe(false);
  });

  it("names who turned it off for the org and links to Access", async () => {
    const w = mountCard({
      config: {
        aiEnabled: true,
        orgEnabled: false,
        orgEnabledBy: { actor: "ada@example.com", at: 1_767_225_600_000 },
      },
    });
    expect(chip(w)).toBe("Off for this organization");
    expect(w.text()).toContain("Turned off by ada@example.com on");
    expect(w.text()).toContain("Members can still open their past chats.");
    await w.find('[data-test="settings-assistant-open-access"]').trigger("click");
    expect(w.emitted("open-access")).toHaveLength(1);
  });

  it("is a skeleton while the probe loads, never zero or none", () => {
    const w = mountCard({ status: "loading", capabilities: null });
    expect(w.find('[data-state="loading"]').exists()).toBe(true);
    expect(w.text()).not.toMatch(/\b0\b|none/);
  });

  it("offers Retry on a load failure", async () => {
    const w = mountCard({ status: "error", capabilities: null });
    await w.find('[data-test="settings-assistant-status-error"] button').trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
  });

  it("reads Configured without a health check and hides Test", () => {
    const w = mountCard({
      status: "unsupported",
      capabilities: null,
      lastClientError: { code: "agent_unavailable", at: NOW },
    });
    expect(chip(w)).toBe("Configured");
    expect(w.text()).toContain("Health check needs a newer server version.");
    expect(w.find('[data-test="settings-assistant-status-last-error"]').text()).toContain(
      "last seen in this browser",
    );
    expect(w.find('[data-test="settings-assistant-test-btn"]').exists()).toBe(false);
  });

  it("shows Unreachable in the error tone with the server's message and keeps Test", () => {
    const w = mountCard({
      capabilities: {
        health: { status: "down", checked_at: NOW, last_error: "upstream connect error" },
      },
    });
    expect(chip(w)).toBe("Unreachable");
    expect(w.text()).toContain("Users see the assistant as unavailable until this is fixed.");
    expect(w.find('[data-test="settings-assistant-status-last-error"]').text()).toContain(
      "upstream connect error",
    );
    expect(w.find('[data-test="settings-assistant-test-btn"]').exists()).toBe(true);
  });

  it("shows Reachable with model, version, last error none and the data level", () => {
    const w = mountCard({ dataLevel: "aggregates" });
    expect(chip(w)).toBe("Reachable");
    expect(w.find('[data-test="settings-assistant-status-model"]').text()).toBe("gpt-x");
    expect(w.find('[data-test="settings-assistant-status-agent-version"]').text()).toBe("1.4.0");
    expect(w.find('[data-test="settings-assistant-status-last-error"]').text()).toBe("none");
    expect(w.find('[data-test="settings-assistant-status-data-shared"]').text()).toBe(
      "Schema and aggregates",
    );
  });

  it("reads raw rows as the data level until the org sets one", () => {
    const w = mountCard();
    expect(w.find('[data-test="settings-assistant-status-data-shared"]').text()).toBe(
      "Schema, aggregates and raw rows",
    );
  });

  it("hides the model from members and offers them no Test", () => {
    const w = mountCard({ isAdmin: false, capabilities: { health: { status: "ok" } } });
    expect(w.find('[data-test="settings-assistant-status-model"]').text()).toBe(
      "Hidden from members",
    );
    expect(w.find('[data-test="settings-assistant-test-btn"]').exists()).toBe(false);
  });

  it("disables Test with Testing while a run is in flight", () => {
    const w = mountCard({ testState: "running" });
    const btn = w.find('[data-test="settings-assistant-test-btn"]');
    expect(btn.attributes("aria-disabled")).toBe("true");
    // A natively disabled button would drop keyboard focus to the page.
    expect(btn.attributes("disabled")).toBeUndefined();
    expect(btn.text()).toContain("Testing…");
  });

  it("announces a result once and shows the last-test row", async () => {
    const w = mountCard();
    const region = w.find('[data-test="settings-assistant-test-announce"]');
    expect(region.attributes("role")).toBe("status");
    expect(region.text()).toBe("");
    await w.setProps({ testState: { ok: true, durationMs: 1200, at: NOW } });
    await flushPromises();
    expect(region.text()).toBe("Test passed in 1.2 s");
    expect(w.find('[data-test="settings-assistant-status-last-test"]').text()).toContain(
      "passed 1.2 s",
    );
    await w.setProps({ dataLevel: "schema" });
    expect(w.findAll('[role="status"]')).toHaveLength(1);
    expect(region.text()).toBe("Test passed in 1.2 s");
  });

  it("states the cause of a failed test", async () => {
    const w = mountCard();
    await w.setProps({ testState: { ok: false, at: NOW } });
    await flushPromises();
    expect(w.find('[data-test="settings-assistant-test-announce"]').text()).toBe(
      "Test failed: no reason given",
    );
  });

  it("announces a second identical result again", async () => {
    const w = mountCard();
    const region = w.find('[data-test="settings-assistant-test-announce"]');
    await w.setProps({ testState: { ok: false, at: NOW } });
    await flushPromises();
    await w.setProps({ testState: { ok: false, at: NOW + 1 } });
    expect(region.text()).toBe("");
    await flushPromises();
    expect(region.text()).toBe("Test failed: no reason given");
  });

  it("reads a capabilities answer without health as Configured, never Unreachable", () => {
    const w = mountCard({ capabilities: { policy_enforced: true } as never });
    expect(chip(w)).toBe("Configured");
    expect(w.find('[data-test="settings-assistant-test-btn"]').exists()).toBe(false);
  });

  it("survives wrong-typed health fields", () => {
    const w = mountCard({
      capabilities: {
        health: { status: "down", last_error: { code: 1 }, checked_at: "x" },
        model: 7,
      } as never,
    });
    expect(chip(w)).toBe("Unreachable");
    expect(w.find('[data-test="settings-assistant-status-last-error"]').text()).toBe("none");
  });

  it("states the data level while off for the org", () => {
    const w = mountCard({ config: { aiEnabled: true, orgEnabled: false }, dataLevel: "schema" });
    expect(w.find('[data-test="settings-assistant-status-data-shared"]').text()).toBe(
      "Schema only",
    );
  });

  it("reads epoch microseconds, milliseconds and seconds", () => {
    expect(epochMs(1_700_000_000_000_000)).toBe(1_700_000_000_000);
    expect(epochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(epochMs(1_700_000_000)).toBe(1_700_000_000_000);
  });
});
