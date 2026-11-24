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
import AgentRunnerNotice from "./AgentRunnerNotice.vue";

const agent = (name: string, runner_contract?: number) => ({
  id: name,
  name,
  version: "1.0.0",
  last_seen_at: 0,
  created_at: 0,
  live: true,
  ...(runner_contract === undefined ? {} : { runner_contract }),
});

describe("AgentRunnerNotice", () => {
  it("names only agents the server reports as lacking runner_contract=1", () => {
    const w = mount(AgentRunnerNotice, {
      props: {
        agents: [agent("old-1", 0), agent("unknown-1"), agent("new-1", 1)],
        minRunnerVersion: "2.0.0",
      },
      global: { plugins: [i18n] },
    });
    const text = w.find("[data-test='synthetics-old-runner-notice']").text();
    expect(text).toContain("old-1");
    expect(text).not.toContain("unknown-1");
    expect(text).not.toContain("new-1");
  });

  it.each([undefined, ""])("hides the notice when enforcement has no version (%s)", (version) => {
    const w = mount(AgentRunnerNotice, {
      props: { agents: [agent("old-1", 0)], minRunnerVersion: version },
      global: { plugins: [i18n] },
    });
    expect(w.find("[data-test='synthetics-old-runner-notice']").exists()).toBe(false);
  });

  it("names the enforced version and formats the microsecond deadline", () => {
    const w = mount(AgentRunnerNotice, {
      props: {
        agents: [agent("old-1", 0)],
        minRunnerVersion: "2.0.0",
        leaseDeadlineUs: Date.UTC(2026, 11, 3, 12) * 1000,
      },
      global: { plugins: [i18n] },
    });
    const text = w.get("[data-test='synthetics-old-runner-notice']").text();
    expect(text).toContain("Upgrade to 2.0.0 or later by Dec 3, 2026");
    expect(text).not.toContain("—");
  });

  it("shows nothing when no agent is reported old", () => {
    const w = mount(AgentRunnerNotice, {
      props: { agents: [agent("unknown-1"), agent("new-1", 1)] },
      global: { plugins: [i18n] },
    });
    expect(w.find("[data-test='synthetics-old-runner-notice']").exists()).toBe(false);
  });
});
