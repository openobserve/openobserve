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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import SlackPrerequisites from "./SlackPrerequisites.vue";
import type { SlackPrerequisiteCheck } from "@/types/slack";
import { OTableStub } from "@/test/unit/helpers/slack";

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

  it("reports nothing blocking once every check passes or warns", () => {
    const w = mountChecks(checks.filter((c) => c.status !== "fail"));
    expect(w.find('[data-test="slack-prereq-summary"]').text()).toContain(
      "Every prerequisite passes",
    );
    expect(w.emitted("blocking")?.at(-1)).toEqual([false]);
  });

  it("asks the parent to re-check", async () => {
    const w = mountChecks();
    await w.find('[data-test="slack-prereq-recheck"]').trigger("click");
    expect(w.emitted("recheck")).toHaveLength(1);
  });
});
