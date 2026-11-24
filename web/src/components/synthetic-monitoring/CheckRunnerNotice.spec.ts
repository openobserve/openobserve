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
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";

vi.mock("@/services/synthetics", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual.default,
      getLocations: vi.fn(),
      getLocation: vi.fn(),
      getAgentSetup: vi.fn(),
    },
  };
});

import CheckRunnerNotice from "./CheckRunnerNotice.vue";
import syntheticsService from "@/services/synthetics";

const agent = (name: string, version: string, runner_contract: number) => ({
  id: name,
  name,
  version,
  last_seen_at: 0,
  created_at: 0,
  live: true,
  runner_contract,
});

describe("runs page old-runner banner (U6)", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    vi.mocked(syntheticsService.getLocations).mockResolvedValue({
      data: {
        locations: [
          { id: "aws-us-east-1", kind: "public" },
          { id: "loc-eu", kind: "private" },
          { id: "loc-other", kind: "private" },
        ],
      },
    } as any);
    vi.mocked(syntheticsService.getLocation).mockImplementation(
      async (_org: string, id: string) =>
        ({
          data: {
            id,
            agents:
              id === "loc-eu"
                ? [agent("private-eu-1", "1.8.2", 0), agent("private-eu-2", "2.1.0", 1)]
                : [agent("elsewhere", "1.0.0", 0)],
          },
        }) as any,
    );
    vi.mocked(syntheticsService.getAgentSetup).mockResolvedValue({
      data: {
        min_runner_version: "2.0.0",
        lease_deadline_us: Date.UTC(2026, 11, 3, 12) * 1000,
        public_locations_leased: false,
      },
    } as any);
  });

  it("names old agents on this check's private locations only", async () => {
    const w = mount(CheckRunnerNotice, {
      props: { locationIds: ["aws-us-east-1", "loc-eu"] },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();
    const text = w.find("[data-test='synthetics-old-runner-notice']").text();
    expect(text).toContain("private-eu-1 (1.8.2) lacks runner_contract=1");
    expect(text).toContain("Upgrade to 2.0.0 or later");
    expect(text).toContain("by Dec 3, 2026");
    expect(text).not.toContain("private-eu-2");
    expect(text).not.toContain("elsewhere");
    expect(syntheticsService.getLocation).toHaveBeenCalledTimes(1);
  });

  it("warns public-only checks when public runners cannot hold leases", async () => {
    const w = mount(CheckRunnerNotice, {
      props: { locationIds: ["aws-us-east-1"] },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();
    const notice = w.find("[data-test='synthetics-public-runner-notice']");
    expect(notice.attributes("role")).toBe("alert");
    expect(notice.text()).toContain("Public locations will stop running");
    expect(notice.text()).toContain("inline credentials");
    expect(notice.text()).toContain("after Dec 3, 2026");
    expect(notice.text()).toContain("until public runners are upgraded to 2.0.0 or later");
    expect(w.find("[data-test='synthetics-old-runner-notice']").exists()).toBe(false);
    expect(syntheticsService.getLocation).not.toHaveBeenCalled();
    expect(syntheticsService.getAgentSetup).toHaveBeenCalledTimes(1);
    expect(w.text()).not.toContain("Agents that will break");
  });

  it.each([true, undefined])(
    "hides the public warning when public_locations_leased is %s",
    async (publicLocationsLeased) => {
      vi.mocked(syntheticsService.getAgentSetup).mockResolvedValue({
        data: {
          min_runner_version: "2.0.0",
          lease_deadline_us: Date.UTC(2026, 11, 3, 12) * 1000,
          public_locations_leased: publicLocationsLeased,
        },
      } as Awaited<ReturnType<typeof syntheticsService.getAgentSetup>>);
      const w = mount(CheckRunnerNotice, {
        props: { locationIds: ["aws-us-east-1"] },
        global: { plugins: [i18n, store] },
      });
      await flushPromises();
      expect(w.find("[data-test='synthetics-public-runner-notice']").exists()).toBe(false);
      expect(w.find("[data-test='synthetics-old-runner-notice']").exists()).toBe(false);
      expect(syntheticsService.getLocation).not.toHaveBeenCalled();
      expect(syntheticsService.getAgentSetup).toHaveBeenCalledTimes(1);
    },
  );

  it("does not warn about public runners for private-only checks", async () => {
    const w = mount(CheckRunnerNotice, {
      props: { locationIds: ["loc-eu"] },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();
    expect(w.find("[data-test='synthetics-public-runner-notice']").exists()).toBe(false);
    expect(w.find("[data-test='synthetics-old-runner-notice']").exists()).toBe(true);
  });

  it.each([["loc-eu"], ["aws-us-east-1"]])(
    "shows nothing for %s when lease enforcement is off",
    async (locationId) => {
      vi.mocked(syntheticsService.getAgentSetup).mockResolvedValue({
        data: { public_locations_leased: false },
      } as Awaited<ReturnType<typeof syntheticsService.getAgentSetup>>);
      const w = mount(CheckRunnerNotice, {
        props: { locationIds: [locationId] },
        global: { plugins: [i18n, store] },
      });
      await flushPromises();
      expect(w.find("[data-test='synthetics-old-runner-notice']").exists()).toBe(false);
      expect(w.find("[data-test='synthetics-public-runner-notice']").exists()).toBe(false);
      expect(syntheticsService.getAgentSetup).toHaveBeenCalledTimes(1);
    },
  );
});
