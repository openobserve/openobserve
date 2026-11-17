import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "./http";
import alertSources from "./alert_sources";
import analytics from "./product_analytics";

vi.mock("./product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("./http", () => {
  const ok = () => Promise.resolve({ data: {} });
  const mockClient = {
    get: vi.fn(),
    post: vi.fn(ok),
    patch: vi.fn(ok),
    delete: vi.fn(ok),
  };
  return { default: vi.fn(() => mockClient) };
});

describe("alert_sources service", () => {
  const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list() calls GET /api/v2/{org}/incidents/integrations", () => {
    alertSources.list("myorg");
    expect(mockClient.get).toHaveBeenCalledWith("/api/v2/myorg/incidents/integrations");
  });

  it("create() calls POST with payload", () => {
    const payload = { name: "grafana-prod", source_type: "grafana" };
    alertSources.create("myorg", payload);
    expect(mockClient.post).toHaveBeenCalledWith("/api/v2/myorg/incidents/integrations", payload);
  });

  it("setEnabled() calls PATCH with { enabled }", () => {
    alertSources.setEnabled("myorg", "int-1", false);
    expect(mockClient.patch).toHaveBeenCalledWith(
      "/api/v2/myorg/incidents/integrations/int-1/enable",
      { enabled: false },
    );
  });

  it("rotate() calls POST rotate endpoint with no body", () => {
    alertSources.rotate("myorg", "int-1");
    expect(mockClient.post).toHaveBeenCalledWith(
      "/api/v2/myorg/incidents/integrations/int-1/rotate",
    );
  });

  it("listSenders() calls GET senders endpoint", () => {
    alertSources.listSenders("myorg", "int-1");
    expect(mockClient.get).toHaveBeenCalledWith(
      "/api/v2/myorg/incidents/integrations/int-1/senders",
    );
  });

  it("tracks each mutation once it succeeds", async () => {
    await alertSources.create("myorg", { name: "x" });
    await alertSources.setEnabled("myorg", "int-1", false);
    await alertSources.setEnabled("myorg", "int-1", true);
    await alertSources.rotate("myorg", "int-1");
    await alertSources.update("myorg", "int-1", { destinations: ["d"] });
    await alertSources.delete("myorg", "int-1");
    expect(vi.mocked(analytics.track).mock.calls).toEqual([
      ["alert_source_created"],
      ["alert_source_disabled"],
      ["alert_source_enabled"],
      ["alert_source_token_rotated"],
      ["alert_source_updated", { name_changed: false, destinations_changed: true }],
      ["alert_source_deleted", { count: 1 }],
    ]);
  });

  it("does not track a failed mutation", async () => {
    vi.mocked(mockClient.delete).mockRejectedValueOnce(new Error("boom"));
    await expect(alertSources.delete("myorg", "int-1")).rejects.toThrow("boom");
    expect(analytics.track).not.toHaveBeenCalled();
  });
});
