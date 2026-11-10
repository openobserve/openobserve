// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";

import streamService from "@/services/stream";
import securityIntel, { type SweepResponse } from "@/services/securityIntel";
import { useIntelSweep } from "@/composables/security/useIntelSweep";
import type { Indicator } from "@/utils/security/intel";

vi.mock("@/services/stream", () => ({ default: { nameList: vi.fn(), schema: vi.fn() } }));
vi.mock("@/services/securityIntel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/securityIntel")>()),
  default: { sweep: vi.fn(), sightings: vi.fn(), validate: vi.fn() },
}));
vi.mock("@/services/securitySources.queries", async () => {
  const { SOURCE_TYPE_BY_ID } = await import("@/views/Security/__fixtures__/securitySourceTypes");
  return {
    fetchSecuritySources: async () => ({ sources: ["vpc", "gone"] }),
    fetchSourceMatch: async () => ({
      classification: { source: SOURCE_TYPE_BY_ID.get("aws_vpc_flow") },
      isSecurity: true,
    }),
  };
});

const streamMock = streamService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const sweepMock = vi.mocked(securityIntel.sweep);

const ind = (indicator: string): Indicator => ({
  indicator,
  type: "ip",
  severity: "high",
  confidence: 80,
  source: "",
  description: "",
  addedAt: "",
  expiresAt: "",
  table: "ioc_x",
});

const answer = (over: Partial<SweepResponse> = {}): SweepResponse => ({
  matches: [],
  streams: ["vpc"],
  unread_streams: [],
  planned: 1,
  capped: false,
  failed: 0,
  partial_results: 0,
  checked: 2,
  total: 2,
  partial: false,
  coverage: [],
  ...over,
});

const WINDOW = { start: 1, end: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  streamMock.nameList.mockResolvedValue({ data: { list: [{ name: "vpc" }, { name: "gone" }] } });
  streamMock.schema.mockImplementation(async (_org: string, stream: string) => {
    if (stream === "gone") throw new Error("no schema");
    return { data: { schema: [{ name: "srcaddr" }] } };
  });
});

describe("useIntelSweep", () => {
  it("sends the indicators, window and security sources to the server", async () => {
    sweepMock.mockResolvedValue({ data: answer() } as never);
    const sweep = useIntelSweep();
    const list = [ind("1.2.3.4"), ind("5.6.7.8")];
    await sweep.run("org", list, WINDOW);
    expect(sweepMock).toHaveBeenCalledTimes(1);
    const [org, indicators, streams, window] = sweepMock.mock.calls[0];
    expect([org, indicators, window]).toEqual(["org", list, WINDOW]);
    expect(streams.map((s) => s.name)).toEqual(["vpc", "gone"]);
    expect(sweep.streams.value).toEqual(["vpc", "gone"]);
    expect([sweep.checked.value, sweep.total.value, sweep.partial.value]).toEqual([2, 2, false]);
  });

  it("passes the caller's abort signal and keeps no answer once aborted", async () => {
    const ctrl = new AbortController();
    sweepMock.mockImplementation(async () => {
      ctrl.abort();
      return { data: answer({ checked: 9 }) } as never;
    });
    const sweep = useIntelSweep();
    await sweep.run("org", [ind("1.2.3.4")], WINDOW, ctrl.signal);
    expect(sweepMock.mock.calls[0][4]).toBe(ctrl.signal);
    expect(sweep.checked.value).toBe(0);
  });

  it("joins the server's matches back to the page's own indicators", async () => {
    const list = [ind("1.2.3.4")];
    sweepMock.mockResolvedValue({
      data: answer({
        matches: [
          {
            indicator: { indicator: "1.2.3.4", type: "ip", table: "ioc_x" },
            sightings: [],
            hits: 3,
            first: 1,
            last: 2,
          },
          {
            indicator: { indicator: "9.9.9.9", type: "ip", table: "ioc_x" },
            sightings: [],
            hits: 1,
            first: 1,
            last: 2,
          },
        ],
      }),
    } as never);
    const sweep = useIntelSweep();
    await sweep.run("org", list, WINDOW);
    expect(sweep.matches.value).toHaveLength(1);
    expect(sweep.matches.value[0].indicator).toBe(list[0]);
    expect(sweep.matches.value[0].hits).toBe(3);
  });

  it("reports the cap, failures and N of M the server counted", async () => {
    sweepMock.mockResolvedValue({
      data: answer({
        planned: 200,
        capped: true,
        failed: 1,
        partial_results: 2,
        checked: 250,
        total: 255,
        partial: true,
        unread_streams: ["gone"],
      }),
    } as never);
    const sweep = useIntelSweep();
    await sweep.run("org", [ind("1.2.3.4")], WINDOW);
    expect(sweep.partial.value).toBe(true);
    expect([sweep.checked.value, sweep.total.value]).toEqual([250, 255]);
    expect([sweep.failed.value, sweep.partialResults.value]).toEqual([1, 2]);
    expect(sweep.planned.value).toBe(200);
    expect(sweep.unreadStreams.value).toEqual(["gone"]);
    expect(sweep.running.value).toBe(false);
  });
});
