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

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, shallowMount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import {
  mockLocations,
  mockPrivateLocations,
  mockProtocolCheckHttp,
} from "@/test/unit/mockData/synthetics";

const { routeState, configState } = vi.hoisted(() => ({
  routeState: { query: {} as Record<string, string> },
  configState: { isEnterprise: "true" },
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string, opts?: unknown) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
  })),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: {}, query: routeState.query }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
}));

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = (await importOriginal()) as { default: Record<string, unknown> };
  return {
    default: new Proxy(actual.default, {
      get: (target, key) =>
        key === "isEnterprise" ? configState.isEnterprise : target[key as string],
    }),
  };
});

vi.mock("@/services/synthetics", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      getLocations: vi.fn().mockResolvedValue({ data: { locations: [] } }),
      get: vi.fn().mockResolvedValue({ data: {} }),
    },
  });
});

vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn().mockResolvedValue({ data: [] }) },
  });
});

vi.mock("@/utils/commons", () => ({
  getFoldersListByType: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import CheckDetails from "@/components/synthetics/configure/CheckDetails.vue";
import CheckLocations from "@/components/synthetics/configure/CheckLocations.vue";
import CheckSchedule from "@/components/synthetics/configure/CheckSchedule.vue";
import CheckAlerts from "@/components/synthetics/configure/CheckAlerts.vue";
import CheckConfigure from "@/components/synthetics/configure/CheckConfigure.vue";
import CreateProtocolCheck from "@/views/synthetics/CreateProtocolCheck.vue";

const PREFILL_KEY = "o2:syntheticPrefill";

const storedPrefill = {
  version: 1,
  source: "autoobserve",
  sourceLabel: "Suggested by AutoObserve for svc-c",
  name: "svc-c health",
  folder: "ops",
  type: "http",
  url: "http://svc-c.ns-a.svc.cluster.local:8080/healthz",
  method: "GET",
  locations: ["private-mumbai-1"],
  destinations: ["ops-webhook"],
  intervalMinutes: 5,
  tags: ["service:svc-c", "namespace:ns-a", "cluster:cluster-k"],
  suggested: ["folder", "tags", "url", "locations", "destinations"],
  service: { name: "svc-c", cluster: "cluster-k", namespace: "ns-a" },
};

// Vue's v-if placeholders are not part of what a user sees, so they are not part of "unchanged".
const visible = (html: string) => {
  let out = html;
  let prev: string;
  do {
    prev = out;
    out = out.replace(/<!--[\s\S]*?-->/g, "");
  } while (out !== prev);
  return out.replace(/^\s*\n/gm, "");
};

const check = { ...mockProtocolCheckHttp, locations: ["private-mumbai-1"] };

function configureSnapshots() {
  const details = shallowMount(CheckDetails, {
    props: { check, folders: [{ folderId: "ops", name: "ops" }] as any },
  });
  const locations = shallowMount(CheckLocations, {
    props: { check, locations: [...mockLocations, ...mockPrivateLocations], allowPrivate: true },
    global: { renderStubDefaultSlot: true },
  });
  const schedule = shallowMount(CheckSchedule, { props: { check } });
  const alerts = shallowMount(CheckAlerts, { props: { check, destinations: ["ops-webhook"] } });
  const out = [details, locations, schedule, alerts].map((w) => visible(w.html()));
  [details, locations, schedule, alerts].forEach((w) => w.unmount());
  return out;
}

const pageStubs = {
  OPageLayout: {
    template: '<div data-test="page" :data-title="title"><slot /></div>',
    props: ["title", "back", "bleed"],
  },
  CheckConfigure: {
    template: '<div data-test="synthetics-check-configure"><slot name="type-config" /></div>',
    props: ["check", "checkType", "locations", "destinations", "folders"],
  },
  CheckHttpConfig: { template: "<div />", props: ["check"] },
  AgentSetupDrawer: true,
  EditorDraftDialogs: true,
  CreateBrowserTestSkeleton: true,
  OButton: { template: "<button><slot /></button>" },
};

async function pageSnapshot() {
  const wrapper = mount(CreateProtocolCheck, {
    props: { checkType: "http" },
    global: { plugins: [store], stubs: pageStubs },
  });
  await flushPromises();
  const html = visible(wrapper.html());
  wrapper.unmount();
  return html;
}

describe("synthetic check form without an AutoObserve prefill", () => {
  beforeEach(() => {
    sessionStorage.clear();
    routeState.query = {};
    configState.isEnterprise = "true";
  });
  afterEach(() => sessionStorage.clear());

  it("renders the configure sections exactly as before", () => {
    expect(configureSnapshots()).toMatchSnapshot();
  });

  it("renders the configure column exactly as before", () => {
    const wrapper = shallowMount(CheckConfigure, {
      props: { check, checkType: "http", locations: mockLocations, destinations: [] },
      global: { renderStubDefaultSlot: true },
    });
    expect(visible(wrapper.html())).toMatchSnapshot();
    wrapper.unmount();
  });

  it("renders the create page exactly as before", async () => {
    expect(await pageSnapshot()).toMatchSnapshot();
  });

  it("renders the plain page on an OSS build even with a stored prefill and the query", async () => {
    configState.isEnterprise = "false";
    routeState.query = { type: "http", prefill: "autoobserve" };
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(storedPrefill));
    const plain = await pageSnapshot();
    expect(plain).not.toContain("svc-c");
    configState.isEnterprise = "true";
    routeState.query = {};
    sessionStorage.clear();
    expect(plain).toBe(await pageSnapshot());
  });

  it("renders the plain page for another prefill value", async () => {
    routeState.query = { type: "http", prefill: "calibration" };
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(storedPrefill));
    const html = await pageSnapshot();
    expect(html).not.toContain("svc-c");
    expect(sessionStorage.getItem(PREFILL_KEY)).not.toBeNull();
  });
});
