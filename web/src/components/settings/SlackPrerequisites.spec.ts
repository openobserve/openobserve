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
import { computed } from "vue";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import SlackPrerequisites from "./SlackPrerequisites.vue";
import type { SlackPrerequisiteCheck } from "@/types/slack";
import { OTableStub } from "@/test/unit/helpers/slack";

const breakpoint = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/composables/useBreakpoint", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/composables/useBreakpoint")>();
  return {
    ...original,
    default: () => ({
      ...original.default(),
      isMobile: computed(() => breakpoint.mobile),
      mdUp: computed(() => !breakpoint.mobile),
    }),
  };
});

const SUMMARY = '[data-test="slack-prereq-summary"]';
const HELM_HINT =
  "Installed without Helm? Set it in the server environment, restart, then Re-check.";

// Row 3 shape (ENT prereq::prerequisites).
const checks: SlackPrerequisiteCheck[] = [
  {
    id: "master_key",
    status: "pass",
    detail: "Set · encrypts stored Slack tokens",
    variable: "O2_MASTER_ENCRYPTION_KEY",
    fix: null,
  },
  {
    id: "delegation_key",
    status: "pass",
    detail: "Derived from master key",
    variable: null,
    fix: null,
  },
  {
    id: "web_url",
    status: "warn",
    detail: "Is http://localhost:5080; Slack needs https",
    variable: "ZO_WEB_URL",
    fix: "ZO_WEB_URL=https://o2.example.com",
  },
  {
    id: "agent",
    status: "fail",
    detail: "O2_AGENT_URL is empty",
    variable: "O2_AGENT_URL",
    fix: "Set O2_AGENT_URL and O2_AI_INTERNAL_SECRET",
  },
];

const mountChecks = (list = checks) =>
  mount(SlackPrerequisites, {
    props: { checks: list },
    global: { plugins: [i18n], stubs: { OTable: OTableStub } },
  });

describe("SlackPrerequisites", () => {
  it("AC-7.1 names each variable with its result and the fix for a failing one", () => {
    const w = mountChecks();
    const rows = w.findAll('[data-test-stub="otable-row"]');
    expect(rows).toHaveLength(4);
    expect(rows[3].text()).toContain("O2_AGENT_URL");
    expect(rows[3].text()).toContain("O2_AGENT_URL is empty");
    expect(rows[3].find('[data-test="slack-prereq-fix"]').text()).toContain(
      "O2_AI_INTERNAL_SECRET",
    );
    const fix = rows[3].findComponent({ name: "OCode" });
    expect(fix.exists()).toBe(true);
    expect(fix.props()).toMatchObject({ block: true, copyable: true });
    expect(rows[3].find('[data-test="slack-prereq-result"]').attributes("data-status")).toBe(
      "fail",
    );
  });

  it("falls back to the check's name when it has no variable", () => {
    const rows = mountChecks().findAll('[data-test-stub="otable-row"]');
    expect(rows[1].text()).toContain("Delegation key");
  });

  it("AC-7.1 counts a warning as passing, so only failures block", () => {
    const w = mountChecks();
    expect(w.find('[data-test="slack-prereq-summary"]').text()).toContain("1 of 4 failed");
    expect(w.emitted("blocking")?.at(-1)).toEqual([true]);
  });

  it("S4 reports nothing blocking but still counts the warning once no check fails", () => {
    const w = mountChecks(checks.filter((c) => c.status !== "fail"));
    const summary = w.find(SUMMARY).text();
    expect(summary).toContain("All required checks pass");
    expect(summary).toContain("1 warning");
    expect(summary).toContain("you can continue");
    expect(summary).not.toContain("Every prerequisite passes");
    expect(w.find('[data-test="slack-prereq-can-continue"]').classes()).toContain("max-md:hidden");
    expect(w.emitted("blocking")?.at(-1)).toEqual([false]);
  });

  it("wraps a long fix command inside its box instead of running under the copy icon", () => {
    const fix = mountChecks().findAll('[data-test="slack-prereq-fix"]')[0];
    expect(fix.classes()).toEqual(
      expect.arrayContaining(["[&>code]:whitespace-pre-wrap", "[&>code]:wrap-anywhere"]),
    );
  });

  it("S4 says every prerequisite passes only without warnings, and adds the warnings to a failure", () => {
    const clean = mountChecks(checks.filter((c) => c.status === "pass"));
    expect(clean.find(SUMMARY).text()).toBe("Every prerequisite passes");
    const both = mountChecks().find(SUMMARY).text();
    expect(both).toContain("1 of 4 failed");
    expect(both).toContain("1 warning");
  });

  it("S7 shows the no-Helm hint under the master-key row only while that check fails", () => {
    expect(mountChecks().text()).not.toContain("Installed without Helm");
    const failing = checks.map((c) =>
      c.id === "master_key"
        ? { ...c, status: "fail" as const, detail: "Not set", fix: "O2_MASTER_ENCRYPTION_KEY=…" }
        : c,
    );
    const rows = mountChecks(failing).findAll('[data-test-stub="otable-row"]');
    expect(rows[0].find('[data-test="slack-prereq-helm-hint"]').text()).toBe(HELM_HINT);
    expect(rows[3].find('[data-test="slack-prereq-helm-hint"]').exists()).toBe(false);
  });

  it("S12 stacks each check above its result below md instead of a table", () => {
    breakpoint.mobile = true;
    try {
      const w = mountChecks();
      expect(w.find('[data-test-stub="otable"]').exists()).toBe(false);
      const row = w.find('[data-test="slack-prereq-row-web_url"]');
      expect(row.text()).toContain("ZO_WEB_URL");
      expect(row.text()).toContain("Is http://localhost:5080; Slack needs https");
      expect(row.find('[data-test="slack-prereq-fix"]').text()).toContain(
        "ZO_WEB_URL=https://o2.example.com",
      );
      expect(w.find('[data-test="slack-prereq-row-delegation_key"]').text()).toContain(
        "Delegation key",
      );
      expect(w.find(SUMMARY).text()).toContain("1 of 4 failed");
    } finally {
      breakpoint.mobile = false;
    }
  });

  it("asks the parent to re-check", async () => {
    const w = mountChecks();
    await w.find('[data-test="slack-prereq-recheck"]').trigger("click");
    expect(w.emitted("recheck")).toHaveLength(1);
  });
});
