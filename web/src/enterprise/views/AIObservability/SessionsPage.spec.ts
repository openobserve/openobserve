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
//
// @vitest-environment jsdom
//
// This same page renders at both /ai/sessions (enterprise/cloud — the detail
// route "aiSessionDetails" exists there) and /sessions (OSS — only the plain
// "sessionDetails" route exists). detailRouteName must resolve to whichever
// one the CURRENT build actually registered, or a session row would push to a
// route name vue-router has never heard of.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

let mockIsEnterprise = "false";
let mockIsCloud = "false";
vi.mock("@/aws-exports", () => ({
  default: {
    get isEnterprise() {
      return mockIsEnterprise;
    },
    get isCloud() {
      return mockIsCloud;
    },
  },
}));

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

vi.mock("@/enterprise/components/AIObservability/AiPageShell.vue", () => ({
  default: {
    name: "AiPageShell",
    template: '<div class="ai-page-shell"><slot /></div>',
  },
}));

vi.mock("@/enterprise/composables/useAiDateController", () => ({
  useAiDateController: () => ({
    dateState: { value: { valueType: "relative", relativeTimePeriod: "15m" } },
    timeRange: { value: { startTime: 100, endTime: 200 } },
    applyRelative: vi.fn(),
    onDateChange: vi.fn(),
    writeToUrl: vi.fn(),
    mountResolve: vi.fn(),
    DEFAULT_RELATIVE: "15m",
  }),
}));

vi.mock("@/enterprise/composables/useChildRefresh", () => ({
  useChildRefresh: () => ({
    lastRunAt: { value: null },
    isLoading: { value: false },
    refresh: vi.fn(),
  }),
}));

const SessionsListStub = {
  name: "SessionsList",
  props: ["streamName", "startTime", "endTime", "detailRouteName"],
  template: '<div class="sessions-list" />',
};
vi.mock("@/plugins/traces/SessionsList.vue", () => ({ default: SessionsListStub }));

async function mountPage() {
  vi.resetModules();
  const SessionsPage = (await import("./SessionsPage.vue")).default;
  return mount(SessionsPage);
}

beforeEach(() => {
  mockIsEnterprise = "false";
  mockIsCloud = "false";
});

describe("SessionsPage — detailRouteName resolves to the route the current build actually registers", () => {
  it("resolves to sessionDetails on a true OSS build (isEnterprise and isCloud both false)", async () => {
    const wrapper = await mountPage();
    expect(wrapper.findComponent(SessionsListStub).props("detailRouteName")).toBe("sessionDetails");
  });

  it("resolves to aiSessionDetails when isEnterprise is true", async () => {
    mockIsEnterprise = "true";
    const wrapper = await mountPage();
    expect(wrapper.findComponent(SessionsListStub).props("detailRouteName")).toBe(
      "aiSessionDetails",
    );
  });

  it("resolves to aiSessionDetails when isCloud is true, even with isEnterprise false", async () => {
    mockIsCloud = "true";
    const wrapper = await mountPage();
    expect(wrapper.findComponent(SessionsListStub).props("detailRouteName")).toBe(
      "aiSessionDetails",
    );
  });

  it("resolves to aiSessionDetails when both isEnterprise and isCloud are true", async () => {
    mockIsEnterprise = "true";
    mockIsCloud = "true";
    const wrapper = await mountPage();
    expect(wrapper.findComponent(SessionsListStub).props("detailRouteName")).toBe(
      "aiSessionDetails",
    );
  });
});
