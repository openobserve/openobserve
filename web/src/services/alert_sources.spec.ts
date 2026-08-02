import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "./http";
import alertSources from "./alert_sources";

vi.mock("./http", () => {
  const mockClient = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
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
});
