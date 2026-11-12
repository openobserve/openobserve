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
  type EntitiesResponse,
  type RiskGraph,
  type ScoredEntity,
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

import SecurityEntities from "./SecurityEntities.vue";

const okta = acceptOutcome(
  planStream("okta_auth", ["_timestamp", "user", "src_ip", "outcome"], null),
  [{ value: "failure", n: 1 }],
);
const windows = planStream("windows_security", ["_timestamp", "user", "host"], null);

const row = (value: string, over: Partial<ScoredEntity> = {}): ScoredEntity => ({
  value,
  aliases: [value],
  events: 25,
  failures: 0,
  failureEvents: 25,
  firstSeen: 1,
  lastSeen: 2,
  streams: ["okta_auth"],
  peers: 5,
  failureKnown: true,
  signals: [],
  tone: "info",
  ...over,
});

// As the server answers: dave's three spellings folded into one row, nobody spread out.
const ENTITIES: EntitiesResponse = {
  user: {
    rows: [
      row("dave", {
        aliases: ["dave@acme.io", "ACME\\dave", "dave"],
        events: 25,
        failures: 18,
        failureEvents: 20,
        streams: ["okta_auth", "windows_security"],
        signals: ["failures"],
        tone: "high",
      }),
      row("alice", { aliases: ["alice@acme.io", "ACME\\alice"] }),
    ],
    capped: false,
    spreadAt: 16,
  },
  ip: {
    rows: [row(ATTACKER_IP, { signals: ["external"], tone: "low" })],
    capped: false,
    spreadAt: 5,
  },
  host: { rows: [row("win-hr-02", { aliases: ["WIN-HR-02"] })], capped: false, spreadAt: 5 },
  streams: [
    { stream: "okta_auth", failed: false, partial: false, startTime: 1, endTime: 2 },
    { stream: "windows_security", failed: false, partial: false, startTime: 1, endTime: 2 },
  ],
};

const GRAPH: RiskGraph = {
  nodes: [
    {
      id: "user:dave",
      kind: "user",
      value: "dave",
      aliases: ["dave@acme.io"],
      events: 25,
      failures: 18,
      cases: [{ id: "c1", title: "spray", severity: "P2" }],
      detectionScore: 30,
      failureScore: 27,
      neighbourScore: 0,
      score: 57,
      tone: "high",
    },
  ],
  edges: [],
  total: 1,
};

const refusal = (url: string, message = "Unauthorized Access") => ({
  response: { status: 403, data: { code: 403, message } },
  config: { method: "post", url },
});

let wrapper: VueWrapper | null = null;
let router: Router;

const mountView = async (query = "") => {
  router = await makeSecurityRouter(`/security/entities${query}`);
  wrapper = mount(SecurityEntities, {
    global: {
      provide: { store },
      plugins: [store, router],
      stubs: {
        SecurityRiskGraph: {
          name: "SecurityRiskGraph",
          props: ["graph", "loading"],
          template: "<div />",
        },
      },
    },
  });
  await settle();
  return wrapper;
};

beforeEach(() => {
  planState.plans = [okta, windows];
  planState.failure = null;
  vi.mocked(securityInvestigate.entities).mockResolvedValue({ data: ENTITIES } as never);
  vi.mocked(securityInvestigate.graph).mockResolvedValue({
    data: { ...GRAPH, failedStreams: [] },
  } as never);
  vi.mocked(securityInvestigate.detail).mockResolvedValue({
    data: {
      timeline: [],
      related: { ip: [{ value: ATTACKER_IP, n: 20, fail: 18 }] },
      failedStreams: [],
    },
  } as never);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityEntities", () => {
  it("asks the server for every planned stream over the window", async () => {
    await mountView();
    const [org, req] = vi.mocked(securityInvestigate.entities).mock.calls[0];
    expect(org).toBe("default");
    expect(req.plans.map((p) => p.stream)).toEqual(["okta_auth", "windows_security"]);
    expect(req.endTime - req.startTime).toBe(24 * 3_600_000_000);
    expect(req.fullWindow).toEqual([]);
  });

  it("shows one user for dave, ACME\\dave and dave@acme.io, with the raw spellings", async () => {
    const w = await mountView();
    const table = w.find('[data-test="security-entities-table"]').text();
    expect(table).toContain("dave");
    expect(table).not.toContain("dave@acme.io");
    expect(w.find('[data-test="security-entities-aliases-dave"]').text()).toContain("+2");
    expect(w.find('[data-test="security-entities-aliases-alice"]').exists()).toBe(true);
  });

  it("shows the server's signals and counts them in the strip", async () => {
    const w = await mountView();
    expect(w.find('[data-test="security-entities-stat-spread"]').text()).toMatch(/^0/);
    expect(w.find('[data-test="security-entities-stat-failures"]').text()).toMatch(/^1/);
    expect(w.find('[data-test="security-entities-table"]').text()).toContain("High failure rate");
  });

  it("hunts across every source with all of the user's spellings", async () => {
    const w = await mountView("?kind=user&entity=dave");
    await settle();
    expect(w.find('[data-test="security-entity-drawer-alias-ACME\\\\dave"]').exists()).toBe(true);
    const [, detail] = vi.mocked(securityInvestigate.detail).mock.calls[0];
    expect(detail).toMatchObject({ kind: "user", values: ["dave@acme.io", "ACME\\dave", "dave"] });
    expect(detail.plans.map((p) => p.stream)).toEqual(["okta_auth", "windows_security"]);
    const push = vi.spyOn(router, "push");
    await w.find('[data-test="security-entity-drawer-open-events"]').trigger("click");
    const target = push.mock.calls[0][0] as { path: string; query: Record<string, string> };
    expect(target.path).toBe("/security/events");
    expect(target.query).toMatchObject({ stream: "__all__", hunt_kind: "user", hunt: "dave" });
    expect(JSON.parse(target.query.hunt_aliases)).toEqual(
      expect.arrayContaining(["dave@acme.io", "ACME\\dave"]),
    );
  });

  it("links each case naming the entity to the Cases page, open ones first", async () => {
    vi.mocked(securityInvestigate.detail).mockResolvedValueOnce({
      data: {
        timeline: [],
        related: {},
        failedStreams: [],
        cases: [
          { id: "c-open", title: "Okta MFA factor reset", severity: "P2", open: true },
          { id: "c-old", title: "Impossible travel", severity: "P3", open: false },
        ],
      },
    } as never);
    const w = await mountView("?kind=user&entity=dave");
    await settle();
    w.findComponent({ name: "SecurityRecordDrawer" }).vm.$emit("update:tab", "cases");
    await settle();
    const list = w.find('[data-test="security-entity-drawer-cases"]');
    expect(list.text()).toContain("Okta MFA factor reset");
    expect(list.text()).toContain("Resolved");
    const push = vi.spyOn(router, "push");
    await w.find('[data-test="security-entity-drawer-case-c-open"]').trigger("click");
    expect(push).toHaveBeenCalledWith({
      path: "/security/cases",
      query: { org_identifier: "default", case: "c-open" },
    });
  });

  it("draws the risk graph the server built", async () => {
    const w = await mountView();
    const views = w
      .findAllComponents({ name: "OToggleGroup" })
      .find((c) => c.props("modelValue") === "table")!;
    views.vm.$emit("update:modelValue", "graph");
    await settle();
    expect(securityInvestigate.graph).toHaveBeenCalled();
    const graph = w.findComponent({ name: "SecurityRiskGraph" }).props("graph") as RiskGraph;
    expect(graph.nodes.map((n) => n.id)).toEqual(["user:dave"]);
  });

  it("says when the entity request fails instead of showing an empty table", async () => {
    vi.mocked(securityInvestigate.entities).mockRejectedValue(new Error("search gate closed"));
    const w = await mountView();
    expect(w.text()).toContain("search gate closed");
  });
  it("locks the page on a refused stream list instead of a raw 403", async () => {
    planState.plans = [];
    planState.failure = refusal("/api/default/streams");
    const w = await mountView();
    const lock = w.find('[data-test="security-entities-access-lock"]');
    expect(lock.exists()).toBe(true);
    expect(lock.text()).toContain("You can't view streams");
    expect(w.text()).not.toContain("Request failed with status code 403");
    expect(w.find('[data-test="security-entities-access-lock-reason"]').exists()).toBe(false);
  });

  it("names the unreadable streams the server refused the read over", async () => {
    vi.mocked(securityInvestigate.entities).mockRejectedValue(
      refusal("/api/default/security/entities", "No read permission on streams: windows_security"),
    );
    const w = await mountView();
    expect(w.find('[data-test="security-entities-access-lock"]').exists()).toBe(true);
    expect(w.find('[data-test="security-entities-access-lock-reason"]').text()).toBe(
      "No read permission on streams: windows_security",
    );
  });
});
