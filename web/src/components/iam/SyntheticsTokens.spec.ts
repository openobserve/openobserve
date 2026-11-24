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
import router from "@/test/unit/helpers/router";
import { queryClient } from "@/composables/query/queryClient";

vi.mock("@/services/synthetics", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: { ...actual.default, listAgentTokens: vi.fn(), getAgentSetup: vi.fn() },
  };
});

import SyntheticsTokens from "./SyntheticsTokens.vue";
import syntheticsService from "@/services/synthetics";

const token = (name: string, pre_cutover: boolean) => ({
  name,
  token: "o2syn_••••",
  is_default: false,
  enabled: true,
  agents: 1,
  created_by: "priya@acme.io",
  created_at: 0,
  pre_cutover,
});

describe("SyntheticsTokens pre-cutover tokens (S4)", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    vi.mocked(syntheticsService.getAgentSetup).mockResolvedValue({ data: null } as any);
  });

  it("shows the rotate banner and a Rotate required badge on each older token", async () => {
    vi.mocked(syntheticsService.listAgentTokens).mockResolvedValue({
      data: {
        tokens: [
          token("agent-token eu-1", true),
          token("legacy-default", true),
          token("agent-token us-2", false),
        ],
      },
    } as any);
    const w = mount(SyntheticsTokens, {
      global: {
        plugins: [i18n, store, router],
        provide: { store },
        stubs: {
          OTable: {
            props: ["data"],
            template: `<div><div v-for="r in data" :key="r.name"><slot name="cell-name" :row="r" /></div></div>`,
          },
          ORefreshButton: true,
        },
      },
    });
    await flushPromises();
    expect(w.find("[data-test='synthetics-tokens-pre-cutover-banner']").text()).toContain(
      "2 agent tokens were created before agent tokens became admin-only",
    );
    expect(w.find("[data-test='synthetics-token-agent-token eu-1-rotate-required']").exists()).toBe(
      true,
    );
    expect(w.find("[data-test='synthetics-token-agent-token us-2-rotate-required']").exists()).toBe(
      false,
    );
  });

  it("shows no banner when every token is current", async () => {
    vi.mocked(syntheticsService.listAgentTokens).mockResolvedValue({
      data: { tokens: [token("agent-token us-2", false)] },
    } as any);
    const w = mount(SyntheticsTokens, {
      global: {
        plugins: [i18n, store, router],
        provide: { store },
        stubs: { OTable: true, ORefreshButton: true },
      },
    });
    await flushPromises();
    expect(w.find("[data-test='synthetics-tokens-pre-cutover-banner']").exists()).toBe(false);
  });
});
