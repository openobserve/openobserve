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
import { mount, type VueWrapper } from "@vue/test-utils";
import type { Router } from "vue-router";
import store from "@/test/unit/helpers/store";
import securityInvestigate, {
  type UebaReport,
  type UserProfile,
  type UserRisk,
} from "@/services/securityInvestigate";
import { acceptOutcome, planStream, type StreamPlan } from "@/utils/security/streamPlan";
import { ATTACKER_IP, makeSecurityRouter, settle } from "./__fixtures__/securityFixtures";

const planState = vi.hoisted(() => ({ plans: [] as unknown[], failure: null as unknown }));

vi.mock("@/composables/security/useSecurityStreamPlans", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/composables/security/useSecurityStreamPlans")>();
  const { ref, shallowRef } = await import("vue");
  return {
    ...actual,
    useSecurityStreamPlans: () => {
      const plans = shallowRef<unknown[]>([]);
      const failure = shallowRef<unknown>(null);
      const names = shallowRef<string[]>([]);
      return {
        plans,
        names,
        unreadable: ref<string[]>([]),
        loading: ref(false),
        error: ref(""),
        failure,
        load: vi.fn(async () => {
          failure.value = planState.failure;
          plans.value = planState.plans;
          names.value = (planState.plans as StreamPlan[]).map((p) => p.stream);
        }),
      };
    },
  };
});
vi.mock("@/services/securityInvestigate", () => ({
  default: {
    entities: vi.fn(),
    graph: vi.fn(),
    detail: vi.fn(),
    ueba: vi.fn(),
    searchEvents: vi.fn(),
  },
}));
vi.mock("@/lib/overlay/Drawer/ODrawer.vue", async () => {
  const f = await import("./__fixtures__/securityFixtures");
  return f.drawerStubModule;
});

import SecurityUEBA from "./SecurityUEBA.vue";

const okta = acceptOutcome(
  planStream("okta_auth", ["_timestamp", "user", "src_ip", "outcome"], null),
  [{ value: "failure", n: 1 }],
);
const windows = planStream("windows_security", ["_timestamp", "user", "host"], null);
const noUser = planStream("vpc_flow", ["_timestamp", "src_ip"], null);

const profile = (user: string, over: Partial<UserProfile> = {}): UserProfile => ({
  user,
  aliases: [`${user}@acme.io`],
  events: 40,
  failures: 1,
  failureEvents: 40,
  ips: {},
  hours: { "9": 40 },
  streams: ["okta_auth"],
  firstSeen: 1,
  ...over,
});

const risk = (user: string, over: Partial<UserRisk> = {}): UserRisk => ({
  user,
  score: 0,
  tone: "info",
  signals: [],
  current: profile(user),
  baseline: null,
  expected: 0,
  baselineSpanUs: 0,
  volumeJudged: false,
  hoursEligible: false,
  withheld: [],
  baselineState: "building",
  ...over,
});

// As the server scores a source a day old: every baseline building, dave a clear peer outlier.
const REPORT: UebaReport = {
  risks: [
    risk("dave", {
      score: 55,
      tone: "high",
      signals: [
        { kind: "peer_volume", weight: 25, evidence: { n: 465, median: 40 } },
        { kind: "peer_failures", weight: 30, evidence: { n: 348, rate: 75, median: 1 } },
      ],
      current: profile("dave", {
        aliases: ["dave@acme.io", "ACME\\dave"],
        events: 465,
        failures: 348,
        failureEvents: 460,
        ips: { [ATTACKER_IP]: { events: 460, failures: 348, external: true } },
        hours: { "3": 405, "9": 60 },
        streams: ["okta_auth", "windows_security"],
      }),
    }),
    ...["alice", "bob", "carol", "erin", "svc-deploy"].map((u) => risk(u)),
  ],
  limitedUsers: [],
  withheld: [],
  currentPartial: false,
  excludedStreams: [],
  noHistoryStreams: ["okta_auth", "windows_security"],
  limitedStreams: [],
};

const refusal = (url: string, message = "Unauthorized Access") => ({
  response: { status: 403, data: { code: 403, message } },
  config: { method: "post", url },
});

let wrapper: VueWrapper | null = null;
let router: Router;

const mountView = async (query = "") => {
  router = await makeSecurityRouter(`/security/ueba${query}`);
  wrapper = mount(SecurityUEBA, { global: { provide: { store }, plugins: [store, router] } });
  await settle();
  return wrapper;
};

beforeEach(() => {
  planState.plans = [okta, windows, noUser];
  planState.failure = null;
  vi.mocked(securityInvestigate.ueba).mockResolvedValue({ data: REPORT } as never);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityUEBA", () => {
  it("sends only streams with a user column, over the window and the baseline before it", async () => {
    await mountView();
    const [, req] = vi.mocked(securityInvestigate.ueba).mock.calls[0];
    expect(req.plans.map((p) => p.stream)).toEqual(["okta_auth", "windows_security"]);
    expect(req.currentEnd - req.currentStart).toBe(24 * 3_600_000_000);
    expect(req.currentStart - req.baselineStart).toBe(7 * 24 * 3_600_000_000);
  });

  it("marks young baselines as building instead of scoring everyone 0", async () => {
    const w = await mountView();
    const notices = w.findComponent({ name: "SecurityNotices" }).props("notices") as {
      key: string;
      text: string;
    }[];
    expect(notices.find((n) => n.key === "building")?.text).toContain("still building for 6 users");
    expect(w.find('[data-test="security-ueba-building-alice"]').text()).toContain(
      "Baseline building",
    );
  });

  it("shows the server's peer outlier under one identity", async () => {
    const w = await mountView();
    const table = w.find('[data-test="security-ueba-table"]').text();
    expect(table).toContain("Failures far above peers");
    expect(table).toContain("Far above peers");
    expect(w.find('[data-test="security-ueba-aliases-dave"]').text()).toContain("+2");
    expect(w.find('[data-test="security-ueba-building-dave"]').exists()).toBe(true);
  });

  it("keeps the score visible beside the building tag, never in place of it", async () => {
    const w = await mountView();
    const row = w.find('[data-test="security-ueba-building-dave"]').element.closest("tr")!;
    expect(row.querySelector('[role="progressbar"], .o-progress')).not.toBeNull();
  });

  it("opens the user's events across every source and spelling", async () => {
    const w = await mountView("?user=dave");
    await settle();
    expect(w.find('[data-test="security-ueba-drawer-building"]').exists()).toBe(true);
    const push = vi.spyOn(router, "push");
    await w.find('[data-test="security-ueba-drawer-events"]').trigger("click");
    const target = push.mock.calls[0][0] as { path: string; query: Record<string, string> };
    expect(target.path).toBe("/security/events");
    expect(target.query).toMatchObject({ stream: "__all__", hunt_kind: "user", hunt: "dave" });
    expect(JSON.parse(target.query.hunt_aliases)).toEqual(
      expect.arrayContaining(["dave@acme.io", "ACME\\dave"]),
    );
  });
  it("locks the page on a refused stream list instead of a raw 403", async () => {
    planState.plans = [];
    planState.failure = refusal("/api/default/streams");
    const w = await mountView();
    const lock = w.find('[data-test="security-ueba-access-lock"]');
    expect(lock.exists()).toBe(true);
    expect(lock.text()).toContain("You can't view streams");
    expect(w.text()).not.toContain("Request failed with status code 403");
    expect(w.find('[data-test="security-ueba-access-lock-reason"]').exists()).toBe(false);
  });

  it("names the unreadable streams the server refused the read over", async () => {
    vi.mocked(securityInvestigate.ueba).mockRejectedValue(
      refusal("/api/default/security/ueba", "No read permission on streams: windows_security"),
    );
    const w = await mountView();
    expect(w.find('[data-test="security-ueba-access-lock"]').exists()).toBe(true);
    expect(w.find('[data-test="security-ueba-access-lock-reason"]').text()).toBe(
      "No read permission on streams: windows_security",
    );
  });
});
