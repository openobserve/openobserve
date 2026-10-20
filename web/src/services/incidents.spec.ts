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

import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import incidents, { type CancelRcaResponse, type TriggerRcaResponse } from "./incidents";
import http, { attemptTokenRefresh } from "./http";
import serviceStreamsApi from "./service_streams";
import { gt } from "@/types/i18n";
import analytics from "./product_analytics";

// Mock the http module
vi.mock("./http");
vi.mock("./service_streams");
vi.mock("./product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/stores", () => ({ default: { state: { API_ENDPOINT: "http://api.test" } } }));

describe("incidents service", () => {
  const mockHttp = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (http as any).mockReturnValue(mockHttp);
  });

  describe("list", () => {
    it("should call http.get with correct URL for basic list", () => {
      mockHttp.get.mockResolvedValue({ data: { incidents: [], total: 0 } });

      incidents.list("test-org");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents?limit=50&offset=0",
      );
    });

    it("should include status parameter when provided", () => {
      mockHttp.get.mockResolvedValue({ data: { incidents: [], total: 0 } });

      incidents.list("test-org", "open");

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents?limit=50&offset=0&status=open",
      );
    });

    it("should use custom limit and offset", () => {
      mockHttp.get.mockResolvedValue({ data: { incidents: [], total: 0 } });

      incidents.list("test-org", undefined, 20, 10);

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents?limit=20&offset=10",
      );
    });

    it("should include status with custom pagination", () => {
      mockHttp.get.mockResolvedValue({ data: { incidents: [], total: 0 } });

      incidents.list("test-org", "resolved", 100, 50);

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents?limit=100&offset=50&status=resolved",
      );
    });
  });

  describe("get", () => {
    it("should call http.get with correct URL", () => {
      mockHttp.get.mockResolvedValue({
        data: {
          id: "incident-123",
          alerts: [],
        },
      });

      incidents.get("test-org", "incident-123");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.get).toHaveBeenCalledWith("/api/v2/test-org/alerts/incidents/incident-123");
    });
  });

  describe("updateStatus", () => {
    it("should call http.patch with correct URL and status", () => {
      mockHttp.patch.mockResolvedValue({ data: { id: "incident-123" } });

      incidents.updateStatus("test-org", "incident-123", "acknowledged");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/update",
        { status: "acknowledged" },
      );
    });

    it("should handle open status", () => {
      mockHttp.patch.mockResolvedValue({ data: { id: "incident-123" } });

      incidents.updateStatus("test-org", "incident-123", "open");

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/update",
        { status: "open" },
      );
    });

    it("should handle resolved status", () => {
      mockHttp.patch.mockResolvedValue({ data: { id: "incident-123" } });

      incidents.updateStatus("test-org", "incident-123", "resolved");

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/update",
        { status: "resolved" },
      );
    });
  });

  describe("getStats", () => {
    it("should call http.get with correct URL", () => {
      mockHttp.get.mockResolvedValue({
        data: {
          total_incidents: 10,
          open_incidents: 3,
          acknowledged_incidents: 2,
          resolved_incidents: 5,
        },
      });

      incidents.getStats("test-org");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.get).toHaveBeenCalledWith("/api/v2/test-org/alerts/incidents/stats");
    });
  });

  describe("triggerRca", () => {
    it("should call http.post with correct URL", () => {
      mockHttp.post.mockResolvedValue({ data: { message: "started", run_id: "run-1" } });

      incidents.triggerRca("test-org", "incident-123");

      expect(http).toHaveBeenCalled();
      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/rca",
        null,
        { params: {}, signal: undefined },
      );
    });

    it("resolves the 202 body {message, run_id} (02 TH13)", async () => {
      const body: TriggerRcaResponse = { message: "Analysis started", run_id: "run-7" };
      mockHttp.post.mockResolvedValue({ status: 202, data: body });

      const res = await incidents.triggerRca("test-org", "incident-123");

      expect(res.status).toBe(202);
      expect(res.data).toEqual({ message: "Analysis started", run_id: "run-7" });
    });

    it("SG33: sends the guidance as the JSON body and keeps the query flags", () => {
      mockHttp.post.mockResolvedValue({ data: { run_id: "run-1" } });

      incidents.triggerRca("test-org", "incident-123", {
        build_on_previous: true,
        guidance: "Check the orders pool",
      });

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/rca",
        { guidance: "Check the orders pool" },
        { params: { build_on_previous: true }, signal: undefined },
      );
    });

    it("passes the abort signal with the request", () => {
      mockHttp.post.mockResolvedValue({ data: { run_id: "run-1" } });
      const controller = new AbortController();

      incidents.triggerRca("test-org", "incident-123", {}, { signal: controller.signal });

      expect(mockHttp.post.mock.calls[0][2]).toEqual({
        params: {},
        signal: controller.signal,
      });
      expect(mockHttp.post.mock.calls[0][2].signal).toBe(controller.signal);
    });
  });

  describe("steering (04 §9.1, §9.2)", () => {
    it("steerRca POSTs the request to the run's steer route", async () => {
      mockHttp.post.mockResolvedValue({ data: { run_state: "running" } });
      const body = {
        text: "",
        kind: "hypothesis_action" as const,
        action: "disprove" as const,
        hypothesis_id: "h1",
      };

      const res = await incidents.steerRca("test-org", "inc-1", "run-2", body);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/inc-1/rca/runs/run-2/steer",
        body,
      );
      expect(res.data).toEqual({ run_state: "running" });
    });
  });

  describe("listRcaRuns", () => {
    it("should call GET …/rca/runs with paging params", () => {
      mockHttp.get.mockResolvedValue({ data: { runs: [], has_more: false } });

      incidents.listRcaRuns("test-org", "incident-123", { limit: 20, before: "run-9" });

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/rca/runs",
        { params: { limit: 20, before: "run-9" } },
      );
    });
  });

  describe("getRcaRun", () => {
    it("should call GET …/rca/runs/{run_id}", () => {
      mockHttp.get.mockResolvedValue({ data: { run_id: "run-1" } });

      incidents.getRcaRun("test-org", "incident-123", "run-1");

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/rca/runs/run-1",
      );
    });
  });

  describe("openRcaLiveStream (05 LU1, LU5, LU16)", () => {
    /** A body whose reads return `chunks` one by one, so a frame can split across reads. */
    const streamingResponse = (chunks: string[]) => {
      const encoder = new TextEncoder();
      let index = 0;
      const body = {
        getReader: () => ({
          read: async () =>
            index < chunks.length
              ? { done: false, value: encoder.encode(chunks[index++]) }
              : { done: true, value: undefined },
        }),
      };
      return { ok: true, status: 200, body } as unknown as Response;
    };
    const refused = (status: number) => ({ ok: false, status }) as unknown as Response;
    const stubFetch = (...responses: Response[]) => {
      const fetchMock = vi.fn();
      for (const response of responses) fetchMock.mockResolvedValueOnce(response);
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };

    afterEach(() => vi.unstubAllGlobals());

    it("reads the run's events in order, frames split across reads, and resolves at end", async () => {
      const fetchMock = stubFetch(
        streamingResponse([
          'event: rca\ndata: {"run_id":"run-2","state":"running"}\n\nevent: thr',
          'ead\ndata: {"run_id":"run-2","steps":[]}\n\n: ping\n\n',
          'event: end\ndata: {"state":"completed"}\n\n',
        ]),
      );
      const events: unknown[] = [];

      const result = await incidents.openRcaLiveStream("test-org", "inc-1", "run-2", {
        onEvent: (event) => events.push(event),
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "http://api.test/api/v2/test-org/alerts/incidents/inc-1/rca/live_stream?run_id=run-2",
        expect.objectContaining({
          method: "GET",
          credentials: "include",
          headers: { Accept: "text/event-stream" },
        }),
      );
      expect(events).toEqual([
        { event: "rca", data: { run_id: "run-2", state: "running" } },
        { event: "thread", data: { run_id: "run-2", steps: [] } },
        { event: "end", data: { state: "completed" } },
      ]);
      expect(result).toEqual({ ended: true });
    });

    it("without a run asks for the incident's state only", async () => {
      const fetchMock = stubFetch(streamingResponse(["event: rca\ndata: null\n\n"]));

      const result = await incidents.openRcaLiveStream("test-org", "inc-1", null, {
        onEvent: () => {},
      });

      expect(fetchMock.mock.calls[0][0]).toBe(
        "http://api.test/api/v2/test-org/alerts/incidents/inc-1/rca/live_stream",
      );
      expect(result).toEqual({ ended: false });
    });

    it("refreshes the token once on 401, then opens again", async () => {
      const fetchMock = stubFetch(
        refused(401),
        streamingResponse(['event: end\ndata: {"state":null}\n\n']),
      );

      const result = await incidents.openRcaLiveStream("test-org", "inc-1", null, {
        onEvent: () => {},
      });

      expect(attemptTokenRefresh).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ended: true });
    });

    it.each([403, 404, 503])("rejects a %i answer with its status", async (status) => {
      stubFetch(refused(status));

      await expect(
        incidents.openRcaLiveStream("test-org", "inc-1", "run-2", { onEvent: () => {} }),
      ).rejects.toMatchObject({ name: "RcaLiveStreamRefused", status });
    });
  });

  describe("cancelRca", () => {
    it("should call DELETE …/rca", () => {
      mockHttp.delete.mockResolvedValue({ data: { run_id: "run-1" } });

      incidents.cancelRca("test-org", "incident-123");

      expect(mockHttp.delete).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/incident-123/rca",
      );
    });

    it("resolves {run_id, cancelled} (02 TH41)", async () => {
      const body: CancelRcaResponse = { run_id: "run-1", cancelled: true };
      mockHttp.delete.mockResolvedValue({ data: body });

      const res = await incidents.cancelRca("test-org", "incident-123");

      expect(res.data).toEqual({ run_id: "run-1", cancelled: true });
      expect(res.data).not.toHaveProperty("aborted_local_task");
    });
  });

  describe("feedback (J4)", () => {
    const URL = "/api/v2/test-org/alerts/incidents/inc-1/rca/runs/run-2/feedback";

    it("getRcaFeedback GETs the run's feedback and resolves {items, mine}", async () => {
      mockHttp.get.mockResolvedValue({ data: { items: [], mine: null } });

      const res = await incidents.getRcaFeedback("test-org", "inc-1", "run-2");

      expect(mockHttp.get).toHaveBeenCalledWith(URL);
      expect(res.data).toEqual({ items: [], mine: null });
    });

    it("putRcaFeedback PUTs the body as is to the same route", async () => {
      const body = { verdict: "no" as const, reasons: ["wrong_service" as const], note: "x" };
      mockHttp.put.mockResolvedValue({ data: { verdict: "no" } });

      await incidents.putRcaFeedback("test-org", "inc-1", "run-2", body);

      expect(mockHttp.put).toHaveBeenCalledWith(URL, body);
    });

    it("deleteRcaFeedback DELETEs the caller's row", async () => {
      mockHttp.delete.mockResolvedValue({ status: 204 });

      await incidents.deleteRcaFeedback("test-org", "inc-1", "run-2");

      expect(mockHttp.delete).toHaveBeenCalledWith(URL);
    });
  });

  describe("resumeRca (J7)", () => {
    it("POSTs an empty body to the run's resume route with the abort signal", async () => {
      const signal = new AbortController().signal;
      const body = {
        message: "ok",
        run_id: "run-3",
        resumed_from: "run-2",
        reused_steps: 2,
        from_step: { index: 3, stage: "metrics", title: "Check metrics" },
      };
      mockHttp.post.mockResolvedValue({ data: body });

      const res = await incidents.resumeRca("test-org", "inc-1", "run-2", { signal });

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/v2/test-org/alerts/incidents/inc-1/rca/runs/run-2/resume",
        null,
        { signal },
      );
      expect(res.data).toEqual(body);
    });
  });

  it("no longer exposes getRcaHistory", () => {
    expect("getRcaHistory" in incidents).toBe(false);
  });

  describe("getCorrelatedStreams", () => {
    it("should call correlate API with incident stable dimensions", async () => {
      const mockIncident = {
        id: "incident-123",
        group_values: {
          service: "api-gateway",
          namespace: "production",
        },
        first_alert_at: 1000000,
        last_alert_at: 2000000,
      } as any;

      const mockCorrelationResponse = {
        data: {
          service_name: "api-gateway",
          matched_dimensions: { service: "api-gateway" },
          additional_dimensions: { namespace: "production" },
          related_streams: {
            logs: [{ stream_name: "default", filters: {} }],
            metrics: [{ stream_name: "metrics", filters: {} }],
            traces: [{ stream_name: "traces", filters: {} }],
            profiles: [],
          },
        },
      };

      vi.mocked(serviceStreamsApi.correlate).mockResolvedValue(mockCorrelationResponse);

      const result = await incidents.getCorrelatedStreams("test-org", mockIncident, gt);

      expect(serviceStreamsApi.correlate).toHaveBeenCalledWith("test-org", {
        source_stream: "api-gateway",
        source_type: "logs",
        available_dimensions: mockIncident.group_values,
      });

      expect(result.serviceName).toBe("api-gateway");
      expect(result.logStreams).toHaveLength(1);
      expect(result.metricStreams).toHaveLength(1);
      expect(result.traceStreams).toHaveLength(1);
    });

    it("should fallback to default when service dimension missing", async () => {
      const mockIncident = {
        id: "incident-123",
        group_values: {
          namespace: "production",
        },
      } as any;

      const mockCorrelationResponse = {
        data: {
          service_name: "unknown",
          matched_dimensions: {},
          additional_dimensions: {},
          related_streams: { logs: [], metrics: [], traces: [], profiles: [] },
        },
      };

      vi.mocked(serviceStreamsApi.correlate).mockResolvedValue(mockCorrelationResponse);

      await incidents.getCorrelatedStreams("test-org", mockIncident, gt);

      expect(serviceStreamsApi.correlate).toHaveBeenCalledWith("test-org", {
        source_stream: "default",
        source_type: "logs",
        available_dimensions: mockIncident.group_values,
      });
    });

    it("should check multiple service dimension variations", async () => {
      const mockIncident = {
        id: "incident-123",
        group_values: {
          serviceName: "api-gateway",
        },
      } as any;

      const mockCorrelationResponse = {
        data: {
          service_name: "api-gateway",
          matched_dimensions: {},
          additional_dimensions: {},
          related_streams: { logs: [], metrics: [], traces: [], profiles: [] },
        },
      };

      vi.mocked(serviceStreamsApi.correlate).mockResolvedValue(mockCorrelationResponse);

      await incidents.getCorrelatedStreams("test-org", mockIncident, gt);

      expect(serviceStreamsApi.correlate).toHaveBeenCalledWith("test-org", {
        source_stream: "api-gateway",
        source_type: "logs",
        available_dimensions: mockIncident.group_values,
      });
    });
  });

  describe("product analytics", () => {
    const cases: [string, "post" | "patch", () => Promise<unknown>, string, object?][] = [
      [
        "updateStatus",
        "patch",
        () => incidents.updateStatus("test-org", "incident-123", "acknowledged"),
        "incident_status_updated",
        { status: "acknowledged" },
      ],
      [
        "updateIncident",
        "patch",
        () => incidents.updateIncident("test-org", "incident-123", { severity: "P1" }),
        "incident_updated",
        { severity_changed: true, title_changed: false },
      ],
      [
        "triggerRca",
        "post",
        () => incidents.triggerRca("test-org", "incident-123", { build_on_previous: true }),
        "incident_rca_requested",
        { build_on_previous: true },
      ],
      [
        "postComment",
        "post",
        () => incidents.postComment("test-org", "incident-123", "note"),
        "incident_comment_added",
      ],
    ];

    it.each(cases)("%s tracks once the server confirms", async (_, verb, call, event, props) => {
      mockHttp[verb].mockResolvedValue({ data: {} });

      await call();

      if (props) expect(analytics.track).toHaveBeenCalledWith(event, props);
      else expect(analytics.track).toHaveBeenCalledWith(event);
    });

    it.each(cases)("%s does not track a rejected request", async (_, verb, call) => {
      mockHttp[verb].mockRejectedValue(new Error("boom"));

      await expect(call()).rejects.toThrow("boom");

      expect(analytics.track).not.toHaveBeenCalled();
    });
  });
});
