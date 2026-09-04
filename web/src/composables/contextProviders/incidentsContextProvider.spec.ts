import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createIncidentsContextProvider } from "./incidentsContextProvider";

describe("createIncidentsContextProvider", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates SRE incident context with all mapped fields", () => {
    const incidentData = {
      id: "inc-1",
      title: "CPU spike",
      status: "open",
      severity: "critical",
      alert_count: 4,
      first_alert_at: "2026-03-10T10:00:00Z",
      last_alert_at: "2026-03-10T11:00:00Z",
    };

    const store = {
      state: {
        selectedOrganization: {
          identifier: "org-prod",
        },
      },
    };

    const provider = createIncidentsContextProvider(incidentData, store);
    const context = provider.getContext();

    expect(context).toEqual({
      agent_type: "sre",
      org_id: "org-prod",
      incident_id: "inc-1",
      incident_title: "CPU spike",
      incident_status: "open",
      incident_severity: "critical",
      alert_count: 4,
      first_alert_at: "2026-03-10T10:00:00Z",
      last_alert_at: "2026-03-10T11:00:00Z",
      request_timestamp: 1_800_000_000_000_000,
    });
  });

  it("handles missing incident/store data gracefully", () => {
    const provider = createIncidentsContextProvider(null, {});
    const context = provider.getContext();

    expect(context.agent_type).toBe("sre");
    expect(context.org_id).toBe("");
    expect(context.incident_id).toBeUndefined();
    expect(context.incident_title).toBeUndefined();
    expect(context.request_timestamp).toBe(1_800_000_000_000_000);
  });
});
