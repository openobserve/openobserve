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

import { describe, it, expect, vi, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import fleet, { type FleetFlowLink } from "@/services/fleet";
import { apiCollector, apiRollout } from "./fleet.fixtures";
import { raw } from "@/types/i18n";
import { useFlowIssues } from "./flowIssues";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: { listCollectors: vi.fn(), listRollouts: vi.fn() },
}));

const DAY = 24 * 3600_000;

const collector = apiCollector;
const rollout = apiRollout;

const link = (over: Partial<FleetFlowLink> = {}): FleetFlowLink => ({
  config: "edge",
  destination: "d_3b9c0e5a1f2d4c67",
  exporters: ["otlphttp/o2"],
  rate: { logs: 10, metrics: 5, traces: null },
  issues: [],
  ...over,
});

function serve(collectors: FleetCollector[], rollouts: FleetRollout[] = []) {
  vi.mocked(fleet.listCollectors).mockResolvedValue({
    data: { total: collectors.length, items: collectors },
  } as any);
  vi.mocked(fleet.listRollouts).mockResolvedValue({ data: { items: rollouts } } as any);
}

let wrapper: VueWrapper | null = null;

async function mountIssues() {
  let api!: ReturnType<typeof useFlowIssues>;
  wrapper = mount(
    defineComponent({
      setup() {
        api = useFlowIssues();
        return () => null;
      },
    }),
    { global: { plugins: [store, i18n] } },
  );
  await flushPromises();
  return api;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("flow map link issues", () => {
  const issues: FleetFlowLink["issues"] = [
    { kind: "export_errors", signal: "logs", value: 0.021 },
    { kind: "dropped", signal: "metrics", value: 72 },
    { kind: "backpressure", signal: "traces", value: 0.92 },
  ];

  it("keeps only the selected signal's issues and names the destination label", async () => {
    serve([]);
    const api = await mountIssues();
    const out = api.pathIssues(link({ issues }), "logs", raw("o2.acme.io"));
    expect(out.map((i) => i.id)).toEqual(["edge-logs-export_errors"]);
    expect(out[0].evidence).toContain("o2.acme.io");
    expect(out[0].evidence).not.toContain("d_");
  });

  it("keeps every signal's issues under all, with ids unique per signal", async () => {
    serve([]);
    const api = await mountIssues();
    const both: FleetFlowLink["issues"] = [
      ...issues,
      { kind: "export_errors", signal: "metrics", value: 0.5 },
    ];
    const out = api.pathIssues(link({ issues: both }), "all", raw("o2.acme.io"));
    expect(out.map((i) => i.id)).toEqual([
      "edge-logs-export_errors",
      "edge-metrics-dropped",
      "edge-traces-backpressure",
      "edge-metrics-export_errors",
    ]);
  });

  it("names the signal so the same kind on two signals reads differently", async () => {
    serve([]);
    const api = await mountIssues();
    const twin: FleetFlowLink["issues"] = [
      { kind: "export_errors", signal: "logs", value: 0.1 },
      { kind: "export_errors", signal: "metrics", value: 0.1 },
      { kind: "backpressure", signal: "logs", value: 0.8 },
      { kind: "backpressure", signal: "traces", value: 0.8 },
    ];
    const out = api.pathIssues(link({ issues: twin }), "all", raw("o2.acme.io"));
    expect(out.map((i) => i.title)).toEqual([
      "Logs: 10% export failures",
      "Metrics: 10% export failures",
      "Logs: queue at 80% (backpressure)",
      "Traces: queue at 80% (backpressure)",
    ]);
  });

  it("words each issue kind with its value and severity", async () => {
    serve([]);
    const api = await mountIssues();
    const label = raw("o2.acme.io");
    const [errors] = api.pathIssues(link({ issues }), "logs", label);
    expect(errors.title).toBe("Logs: 2.1% export failures");
    expect(errors.severity).toBe("error");
    const [dropped] = api.pathIssues(link({ issues }), "metrics", label);
    expect(dropped.title).toBe("72 points/min dropped");
    expect(dropped.severity).toBe("error");
    const [queue] = api.pathIssues(link({ issues }), "traces", label);
    expect(queue.title).toBe("Traces: queue at 92% (backpressure)");
    expect(queue.severity).toBe("warning");
  });

  it("sends a link issue to the collectors of its config", async () => {
    serve([]);
    const api = await mountIssues();
    const [issue] = api.pathIssues(link({ issues }), "logs", raw("o2.acme.io"));
    expect(issue.action).toEqual({ kind: "collectors", query: { q: "edge" } });
  });
});

describe("flow map config issues", () => {
  it("shows an in-progress rollout as progress", async () => {
    serve([], [rollout({ status: "in_progress", attempted: 0 })]);
    const api = await mountIssues();
    const [issue] = api.configIssues("edge");
    expect(issue.severity).toBe("progress");
    expect(issue.action).toEqual({ kind: "rollout", rolloutId: "r1" });
  });

  it("shows a halted rollout within 3 days as an error and an older one as nothing", async () => {
    serve([], [rollout({ status: "halted", started_at: Date.now() - DAY })]);
    let api = await mountIssues();
    const [issue] = api.configIssues("edge");
    expect(issue.severity).toBe("error");
    expect(String(issue.title)).toBe("v2 rollout halted");
    wrapper?.unmount();
    queryClient.clear();
    serve([], [rollout({ status: "halted", started_at: Date.now() - 4 * DAY })]);
    api = await mountIssues();
    expect(api.configIssues("edge")).toEqual([]);
  });

  it("shows an auto-reverted rollout as an error, and one a user superseded as nothing", async () => {
    serve([], [rollout({ status: "reverted", auto_revert: true })]);
    let api = await mountIssues();
    const [issue] = api.configIssues("edge");
    expect(issue.severity).toBe("error");
    expect(String(issue.title)).toBe("v2 reverted automatically");
    wrapper?.unmount();
    queryClient.clear();
    serve([], [rollout({ status: "superseded" })]);
    api = await mountIssues();
    expect(api.configIssues("edge")).toEqual([]);
  });

  it("explains a halted rollout with its halt class and reason", async () => {
    const halt = {
      class: "proven_bad" as const,
      reason: "1 collector rejected",
      at: Date.now(),
      exits: ["revert" as const],
    };
    serve([], [rollout({ status: "halted", halt })]);
    const api = await mountIssues();
    const [issue] = api.configIssues("edge");
    expect(issue.severity).toBe("error");
    expect(issue.evidence).toBe("Proven bad: 1 collector rejected");
    expect(issue.action).toEqual({ kind: "rollout", rolloutId: "r1" });
  });

  it("informs on outdated collectors and never mentions drift", async () => {
    serve([
      collector({ id: "c3", name: "old", outdated: true }),
      collector({ id: "c4", config: "other", outdated: true }),
    ]);
    const api = await mountIssues();
    const out = api.configIssues("edge");
    expect(out.map((i) => [i.id, i.severity])).toEqual([["behind", "info"]]);
    expect(out[0].title).toBe("1 collector older than the target version");
    expect(out[0].evidence).toBe("Older than the target version: old");
  });

  it("sends offline collectors to the collectors of that config", async () => {
    serve([collector({ id: "c2", status: "offline" })]);
    const api = await mountIssues();
    expect(api.configIssues("edge").map((i) => i.action)).toEqual([
      { kind: "collectors", query: { q: "edge" } },
    ]);
  });

  it("refreshes a stale offline state every 15 s while mounted, and stops after unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve([collector({ status: "online" })], [rollout()]);
    const api = await mountIssues();
    expect(api.configIssues("edge")).toEqual([]);
    serve([collector({ status: "offline" })], [rollout()]);
    await vi.advanceTimersByTimeAsync(15_000);
    await flushPromises();
    expect(api.configIssues("edge").map((i) => i.id)).toEqual(["offline"]);
    wrapper?.unmount();
    wrapper = null;
    const calls = vi.mocked(fleet.listCollectors).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    await flushPromises();
    expect(vi.mocked(fleet.listCollectors).mock.calls.length).toBe(calls);
  });
});
