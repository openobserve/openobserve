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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { ref, shallowRef } from "vue";
import type { Router } from "vue-router";
import store from "@/test/unit/helpers/store";
import threatIntel from "@/services/threat_intel";
import securityIntel from "@/services/securityIntel";
import { b64DecodeUnicode } from "@/utils/formatters";
import type { Indicator, IndicatorMatch } from "@/utils/security/intel";
import {
  ATTACKER_IP,
  C2_IP,
  HOUR_US,
  authorOnly,
  grantAll,
  makeSecurityRouter,
  nowMicros,
  okResponse,
  settle,
  triageOnly,
} from "./__fixtures__/securityFixtures";

const confirmMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const sweepRun = vi.hoisted(() => vi.fn());

const matchesRef = shallowRef<IndicatorMatch[]>([]);

vi.mock("@/services/threat_intel", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/threat_intel")>());
});
vi.mock("@/services/securityIntel", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/securityIntel")>());
});
vi.mock("@/composables/security/useIntelSweep", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/security/useIntelSweep")>()),
  useIntelSweep: () => ({
    matches: matchesRef,
    coverage: shallowRef([]),
    streams: shallowRef(["aws_cloudtrail", "okta_auth", "vpc_flow"]),
    unreadStreams: shallowRef([]),
    running: ref(false),
    done: ref(0),
    planned: ref(0),
    partial: ref(false),
    failed: ref(0),
    partialResults: ref(false),
    checked: ref(3),
    total: ref(3),
    lastRunAt: ref(Date.now()),
    run: sweepRun,
  }),
}));
vi.mock("@/composables/security/useSecurityAccess", async (importOriginal) => {
  const f = await import("./__fixtures__/securityFixtures");
  return {
    ...(await importOriginal<typeof import("@/composables/security/useSecurityAccess")>()),
    useSecurityAccess: f.mockSecurityAccess,
    loadSecurityAccess: async () => ({ read: true, ...f.accessGrants }),
    isSecurityGated: () => false,
  };
});
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: (...args: unknown[]) => toastMock(...args),
}));
vi.mock("@/components/security/SecuritySeverityChart.vue", () => ({
  default: { name: "SecuritySeverityChart", template: "<div />" },
}));
vi.mock("@/components/security/SecurityIntelAddDialog.vue", () => ({
  default: { name: "SecurityIntelAddDialog", template: "<div />" },
}));
vi.mock("@/components/security/SecurityIntelImportDialog.vue", () => ({
  default: { name: "SecurityIntelImportDialog", template: "<div />" },
}));
vi.mock("@/lib/overlay/Drawer/ODrawer.vue", async () => {
  const f = await import("./__fixtures__/securityFixtures");
  return f.drawerStubModule;
});

import SecurityIntel from "./SecurityIntel.vue";

const indicator = (over: Partial<Indicator>): Indicator => ({
  indicator: ATTACKER_IP,
  type: "ip",
  severity: "critical",
  confidence: 95,
  source: "abuse.ch Feodo",
  description: "Tor exit node used for the password spray",
  addedAt: "2026-11-01T00:00:00Z",
  expiresAt: "",
  table: "intel_tor_exits",
  ...over,
});

const attacker = indicator({});
const c2 = indicator({
  indicator: C2_IP,
  severity: "high",
  source: "internal-ir",
  description: "Payload host from the certutil download",
});

const sighting = (stream: string, column: string, count: number) => ({
  stream,
  column,
  mode: "exact" as const,
  raw: ATTACKER_IP,
  count,
  first: nowMicros() - 8 * HOUR_US,
  last: nowMicros() - HOUR_US,
});

let wrapper: VueWrapper | null = null;
let router: Router;

const mountView = async (start = "/security/intel") => {
  router = await makeSecurityRouter(start);
  wrapper = mount(SecurityIntel, { global: { provide: { store }, plugins: [store, router] } });
  await settle();
  return wrapper;
};

const rowOf = (w: VueWrapper, table: string, text: string) =>
  w.findAll(`[data-test="${table}"] tr`).find((tr) => tr.text().includes(text));

beforeEach(() => {
  grantAll();
  matchesRef.value = [
    {
      indicator: attacker,
      sightings: [
        sighting("aws_cloudtrail", "sourceipaddress", 11),
        sighting("okta_auth", "client_ipaddress", 41),
      ],
      hits: 52,
      first: nowMicros() - 8 * HOUR_US,
      last: nowMicros() - HOUR_US,
    },
  ];
  vi.mocked(threatIntel.listTables).mockResolvedValue([
    { name: "intel_tor_exits", docs: 2, createdAt: Date.now() - 86_400_000, feed: null },
  ]);
  vi.mocked(threatIntel.readTable).mockResolvedValue({
    raw: [{}, {}],
    indicators: [attacker, c2],
    rowCount: 2,
    skipped: 0,
    blank: 0,
    columns: ["indicator", "type", "severity", "confidence", "source", "description"],
    hasIndicatorColumn: true,
  });
  vi.mocked(threatIntel.removeIndicator).mockResolvedValue({ removed: 1 } as never);
  vi.mocked(securityIntel.sightings).mockResolvedValue(okResponse({ series: [] }) as never);
  sweepRun.mockResolvedValue(undefined);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityIntel", () => {
  it("shows the attacker IP as a match with its total sightings", async () => {
    const w = await mountView();
    const row = rowOf(w, "security-intel-matches-table", ATTACKER_IP);
    expect(row?.text()).toContain("52");
    expect(rowOf(w, "security-intel-matches-table", C2_IP)).toBeUndefined();
    expect(sweepRun).toHaveBeenCalledWith(
      "default",
      [attacker, c2],
      expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }),
      expect.any(AbortSignal),
    );
  });

  it("lists every loaded indicator on the indicators tab", async () => {
    const w = await mountView("/security/intel?tab=indicators");
    expect(rowOf(w, "security-intel-indicators-table", C2_IP)?.text()).toContain("internal-ir");
    expect(rowOf(w, "security-intel-indicators-table", ATTACKER_IP)?.text()).toContain(
      "abuse.ch Feodo",
    );
  });

  it("hunts a sighting in Events filtered to the matched column", async () => {
    const w = await mountView();
    await rowOf(w, "security-intel-matches-table", ATTACKER_IP)!.trigger("click");
    await flushPromises();
    expect(w.find('[data-test="security-intel-drawer"]').text()).toContain(ATTACKER_IP);
    expect(securityIntel.sightings).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        type: "ip",
        indicator: ATTACKER_IP,
        sightings: [
          { stream: "aws_cloudtrail", column: "sourceipaddress", mode: "exact" },
          { stream: "okta_auth", column: "client_ipaddress", mode: "exact" },
        ],
      }),
    );
    const push = vi.spyOn(router, "push");
    await w.find('[data-test="security-intel-hunt-okta_auth-client_ipaddress"]').trigger("click");
    const call = push.mock.calls[0][0] as { path: string; query: Record<string, string> };
    expect(call.path).toBe("/security/events");
    expect(call.query.stream).toBe("okta_auth");
    expect(JSON.parse(b64DecodeUnicode(call.query.filters) ?? "")).toEqual([
      { field: "client_ipaddress", op: "=", value: ATTACKER_IP },
    ]);
  });

  it("removes an indicator from its list after confirmation", async () => {
    confirmMock.mockResolvedValue(true);
    const w = await mountView();
    await rowOf(w, "security-intel-matches-table", ATTACKER_IP)!.trigger("click");
    await flushPromises();
    await w.find('[data-test="security-intel-drawer-remove"]').trigger("click");
    await flushPromises();
    expect(threatIntel.removeIndicator).toHaveBeenCalledWith("default", attacker);
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });
});

describe("SecurityIntel authoring access", () => {
  const sel = (id: string) => `[data-test="${id}"]`;
  const openAttacker = async (w: VueWrapper) => {
    await rowOf(w, "security-intel-matches-table", ATTACKER_IP)!.trigger("click");
    await flushPromises();
  };

  it("leaves a triage-only analyst the sweep but no list writes", async () => {
    triageOnly();
    const w = await mountView();
    expect(w.find(sel("security-intel-add")).attributes("disabled")).toBeDefined();
    expect(w.find(sel("security-intel-import")).attributes("disabled")).toBeDefined();
    expect(w.find(sel("security-intel-run-sweep")).attributes("disabled")).toBeUndefined();
    await openAttacker(w);
    expect(w.find(sel("security-intel-drawer-remove")).exists()).toBe(false);
    expect(w.find(sel("security-intel-drawer-hunt")).exists()).toBe(true);
  });

  it("lets an author add and import but not remove an indicator", async () => {
    authorOnly();
    const w = await mountView();
    expect(w.find(sel("security-intel-add")).attributes("disabled")).toBeUndefined();
    expect(w.find(sel("security-intel-import")).attributes("disabled")).toBeUndefined();
    await openAttacker(w);
    expect(w.find(sel("security-intel-drawer-remove")).exists()).toBe(false);
  });
  it("locks the page when the threat-intel lists are refused, pointing at the analyst preset", async () => {
    vi.mocked(threatIntel.listTables).mockRejectedValue({
      response: { status: 403, data: { code: 403, message: "Unauthorized Access" } },
      message: "Request failed with status code 403",
      config: { method: "get", url: "/api/default/streams" },
    });
    const w = await mountView();
    const lock = w.find('[data-test="security-intel-access-lock"]');
    expect(lock.exists()).toBe(true);
    expect(lock.text()).toContain("SOC Analyst");
    expect(w.text()).not.toContain("Request failed with status code 403");
    expect(w.find('[data-test="security-intel-tabs"]').exists()).toBe(false);
  });
});
