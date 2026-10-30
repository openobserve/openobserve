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
import fleet, {
  type FleetCollector,
  type FleetPipeline,
  type FleetRollout,
} from "@/services/fleet";
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

const pipeline = (over: Partial<FleetPipeline> = {}): FleetPipeline => ({
  id: "default/logs",
  fleet: "default",
  name: "logs",
  signal: "logs",
  receivers: [
    { name: "filelog", rate: 10, refused: 0 },
    { name: "otlp", rate: 5, refused: 3 },
  ],
  exporters: [
    { name: "otlphttp/o2", destination: "d_o2", rate: 10, failed: 0, dropped: 0, queue: 0.1 },
    { name: "kafka/bus", destination: "d_bus", rate: 5, failed: 4, dropped: 2, queue: 0.9 },
  ],
  in_rate: 15,
  out_rate: 15,
  failed_ratio: 0.2,
  dropped_ratio: 0.1,
  queue_ratio: 0.9,
  issues: [],
  ...over,
});

const label = (id: string) => raw(id === "d_bus" ? "kafka.acme.io" : "o2.acme.io");

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

describe("pipeline issues", () => {
  const issues: FleetPipeline["issues"] = [
    { kind: "export_errors", signal: "logs", value: 0.021 },
    { kind: "dropped", signal: "logs", value: 72 },
    { kind: "backpressure", signal: "logs", value: 0.92 },
    { kind: "receiver_refused", signal: "logs", value: 0.2 },
  ];

  it("words each issue kind with its value and severity, ids unique per pipeline", async () => {
    serve([]);
    const api = await mountIssues();
    const out = api.pipelineIssues(pipeline({ issues }), label);
    expect(out.map((i) => [i.id, i.severity, String(i.title)])).toEqual([
      ["default/logs-export_errors", "error", "Logs: 2.1% export failures"],
      ["default/logs-dropped", "error", "72 records/min dropped"],
      ["default/logs-backpressure", "warning", "Logs: queue at 92% (backpressure)"],
      ["default/logs-receiver_refused", "warning", "Logs: 20% refused by receivers"],
    ]);
  });

  it("points the evidence at the worst exporter or receiver by its label, never its id", async () => {
    serve([]);
    const api = await mountIssues();
    const out = api.pipelineIssues(pipeline({ issues }), label);
    expect(out.slice(0, 3).map((i) => String(i.evidence))).toEqual([
      "Reported by the exporter to kafka.acme.io",
      "Reported by the exporter to kafka.acme.io",
      "Reported by the exporter to kafka.acme.io",
    ]);
    expect(out[3].evidence).toBe("Refused by the otlp receiver");
    expect(out.some((i) => String(i.evidence).includes("d_"))).toBe(false);
  });

  it("sends a pipeline issue to the collectors of its fleet", async () => {
    serve([]);
    const api = await mountIssues();
    const [issue] = api.pipelineIssues(pipeline({ issues }), label);
    expect(issue.action).toEqual({ kind: "collectors", query: { fleet: "default" } });
  });
});

describe("fleet issues", () => {
  it("shows an in-progress rollout as progress", async () => {
    serve([], [rollout({ status: "in_progress", attempted: 0 })]);
    const api = await mountIssues();
    const [issue] = api.fleetIssues("default");
    expect(issue.severity).toBe("progress");
    expect(issue.action).toEqual({ kind: "rollout", rolloutId: "r1" });
  });

  it("shows a halted rollout within 3 days as an error and an older one as nothing", async () => {
    serve([], [rollout({ status: "halted", started_at: Date.now() - DAY })]);
    let api = await mountIssues();
    const [issue] = api.fleetIssues("default");
    expect(issue.severity).toBe("error");
    expect(String(issue.title)).toBe("v2 rollout halted");
    wrapper?.unmount();
    queryClient.clear();
    serve([], [rollout({ status: "halted", started_at: Date.now() - 4 * DAY })]);
    api = await mountIssues();
    expect(api.fleetIssues("default")).toEqual([]);
  });

  it("shows an auto-rollbacked rollout as an error, and one a user superseded as nothing", async () => {
    serve([], [rollout({ status: "rolled_back", auto_rollback: true })]);
    let api = await mountIssues();
    const [issue] = api.fleetIssues("default");
    expect(issue.severity).toBe("error");
    expect(String(issue.title)).toBe("v2 rolled back automatically");
    wrapper?.unmount();
    queryClient.clear();
    serve([], [rollout({ status: "superseded" })]);
    api = await mountIssues();
    expect(api.fleetIssues("default")).toEqual([]);
  });

  it("explains a halted rollout with its halt class and reason", async () => {
    const halt = {
      class: "proven_bad" as const,
      reason: "1 collector rejected",
      at: Date.now(),
      exits: ["rollback" as const],
    };
    serve([], [rollout({ status: "halted", halt })]);
    const api = await mountIssues();
    const [issue] = api.fleetIssues("default");
    expect(issue.severity).toBe("error");
    expect(issue.evidence).toBe("Proven bad: 1 collector rejected");
    expect(issue.action).toEqual({ kind: "rollout", rolloutId: "r1" });
  });

  it("informs on outdated collectors and never mentions drift", async () => {
    serve([
      collector({ id: "c3", name: "old", outdated: true }),
      collector({ id: "c4", fleet: { id: "other", name: "other" }, outdated: true }),
    ]);
    const api = await mountIssues();
    const out = api.fleetIssues("default");
    expect(out.map((i) => [i.id, i.severity])).toEqual([["behind", "info"]]);
    expect(out[0].title).toBe("1 collector older than the target version");
    expect(out[0].evidence).toBe("Older than the target version: old");
  });

  it("sends offline collectors to the offline collectors of that fleet", async () => {
    serve([collector({ id: "c2", status: "offline" })]);
    const api = await mountIssues();
    expect(api.fleetIssues("default").map((i) => i.action)).toEqual([
      { kind: "collectors", query: { fleet: "default", status: "offline" } },
    ]);
  });

  it("refreshes a stale offline state every 15 s while mounted, and stops after unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve([collector({ status: "online" })], [rollout()]);
    const api = await mountIssues();
    expect(api.fleetIssues("default")).toEqual([]);
    serve([collector({ status: "offline" })], [rollout()]);
    await vi.advanceTimersByTimeAsync(15_000);
    await flushPromises();
    expect(api.fleetIssues("default").map((i) => i.id)).toEqual(["offline"]);
    wrapper?.unmount();
    wrapper = null;
    const calls = vi.mocked(fleet.listCollectors).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    await flushPromises();
    expect(vi.mocked(fleet.listCollectors).mock.calls.length).toBe(calls);
  });
});
