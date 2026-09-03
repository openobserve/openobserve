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

// L0 workload detection over stream names (design 4.6/§6): client-side, no module-level state.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { useWorkloadDetection } from "@/composables/useWorkloadDetection";

const getStreams = vi.fn();

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams }),
}));

const streams = (names: string[]) => ({ list: names.map((name) => ({ name })) });

// Per-type responses keyed on the first getStreams argument.
const mockStreamLists = (byType: Record<string, string[]>) => {
  getStreams.mockImplementation((streamType: string) =>
    Promise.resolve(streams(byType[streamType] ?? [])),
  );
};

describe("useWorkloadDetection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamLists({ metrics: [], logs: [] });
  });

  describe("hosts signature (≥2 exact characteristic streams)", () => {
    it("detects at two exact names", async () => {
      mockStreamLists({ metrics: ["system_cpu_time", "system_memory_usage"] });
      const { states, refresh } = useWorkloadDetection();
      await refresh();
      await flushPromises();
      expect(states.value.hosts).toBe("detected");
    });

    it("stays undetected at one exact name — near-miss names don't count", async () => {
      // Exact match only: prefixy/substringy stream names must not satisfy the rule.
      mockStreamLists({
        metrics: ["system_cpu_time", "system_cpu_time_extra", "systemd_journal"],
      });
      const { states, refresh } = useWorkloadDetection();
      await refresh();
      await flushPromises();
      expect(states.value.hosts).toBe("undetected");
    });

    it("reports unknown while the stream list is unresolved", async () => {
      getStreams.mockReturnValue(new Promise(() => {}));
      const { states, refresh } = useWorkloadDetection();
      void refresh();
      // Pages render a spinner on unknown, never a false "set up" flash.
      expect(states.value.hosts).toBe("unknown");
    });

    it("stays unknown when the stream fetch REJECTS — a failure is not 'undetected'", async () => {
      // Design 4.6: a fetch failure must never flash the "set up" onboarding face.
      getStreams.mockRejectedValue(new Error("network down"));
      const { states, refresh } = useWorkloadDetection();
      await refresh();
      await flushPromises();
      expect(states.value.hosts).toBe("unknown");
      expect(states.value.kubernetes).toBe("unknown");
      expect(states.value.aws).toBe("unknown");
    });
  });

  describe("kubernetes signature (≥2 k8s_-prefixed metric streams)", () => {
    it("detects at two k8s_ streams", async () => {
      mockStreamLists({ metrics: ["k8s_pod_cpu_usage", "k8s_node_memory_usage"] });
      const { states, refresh } = useWorkloadDetection();
      await refresh();
      await flushPromises();
      expect(states.value.kubernetes).toBe("detected");
    });

    it("stays undetected at one", async () => {
      mockStreamLists({ metrics: ["k8s_pod_cpu_usage"] });
      const { states, refresh } = useWorkloadDetection();
      await refresh();
      await flushPromises();
      expect(states.value.kubernetes).toBe("undetected");
    });
  });

  describe("aws signature (≥1 aws_/cloudwatch stream, metrics or logs)", () => {
    it("detects an aws_-prefixed metrics stream", async () => {
      mockStreamLists({ metrics: ["aws_ec2_cpu"] });
      const { states, refresh } = useWorkloadDetection();
      await refresh();
      await flushPromises();
      expect(states.value.aws).toBe("detected");
    });

    it("detects a cloudwatch-bearing logs stream", async () => {
      mockStreamLists({ logs: ["vpc_cloudwatch_flow"] });
      const { states, refresh } = useWorkloadDetection();
      await refresh();
      await flushPromises();
      expect(states.value.aws).toBe("detected");
    });

    it("stays undetected without either", async () => {
      mockStreamLists({ metrics: ["nginx_requests"], logs: ["default"] });
      const { states, refresh } = useWorkloadDetection();
      await refresh();
      await flushPromises();
      expect(states.value.aws).toBe("undetected");
    });
  });

  describe("stream-list access", () => {
    it("pulls metrics and logs with schema=false and notify=false; mount-style refresh() never forces", async () => {
      const { refresh } = useWorkloadDetection();
      await refresh();
      await flushPromises();
      // notify=false must be the explicit third arg or every empty-state render toasts (pass-2 finding 4).
      expect(getStreams).toHaveBeenCalledWith("metrics", false, false, false);
      expect(getStreams).toHaveBeenCalledWith("logs", false, false, false);
      for (const call of getStreams.mock.calls) {
        expect(call[3]).toBe(false);
      }
    });

    it("forces the stream fetch on detect-driven refresh({force:true}), never on plain refresh()", async () => {
      const { refresh } = useWorkloadDetection();
      await refresh({ force: true });
      await flushPromises();
      expect(getStreams).toHaveBeenCalledWith("metrics", false, false, true);
      expect(getStreams).toHaveBeenCalledWith("logs", false, false, true);
    });

    it("flips empty→live past a stale cached empty list when forced (cold-review finding 2)", async () => {
      // getStreams caches an EMPTY list forever with force=false — only force:true re-fetches.
      getStreams.mockImplementation((streamType: string, _schema, _notify, force) => {
        if (streamType !== "metrics") return Promise.resolve(streams([]));
        return Promise.resolve(
          force ? streams(["system_cpu_time", "system_memory_usage"]) : streams([]),
        );
      });
      const { states, refresh } = useWorkloadDetection();
      await refresh();
      await flushPromises();
      expect(states.value.hosts).toBe("undetected");
      // The agent connected; the @detected handler refreshes with force — the state must flip.
      await refresh({ force: true });
      await flushPromises();
      expect(states.value.hosts).toBe("detected");
    });

    it("refresh() re-evaluates against the current stream list (org switch, no stale leak)", async () => {
      mockStreamLists({ metrics: ["system_cpu_time", "system_memory_usage"] });
      const { states, refresh } = useWorkloadDetection();
      await refresh();
      await flushPromises();
      expect(states.value.hosts).toBe("detected");
      // The next org has no host streams — the state must flip, not linger.
      mockStreamLists({ metrics: [] });
      await refresh();
      await flushPromises();
      expect(states.value.hosts).toBe("undetected");
    });

    it("holds no module-level state — two instances don't share results", async () => {
      mockStreamLists({ metrics: ["system_cpu_time", "system_memory_usage"] });
      const a = useWorkloadDetection();
      await a.refresh();
      await flushPromises();
      expect(a.states.value.hosts).toBe("detected");

      mockStreamLists({ metrics: [] });
      const b = useWorkloadDetection();
      await b.refresh();
      await flushPromises();
      expect(b.states.value.hosts).toBe("undetected");
      // Module-level shared state would have flipped a's result alongside b's.
      expect(a.states.value.hosts).toBe("detected");
    });
  });
});
