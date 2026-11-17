import { describe, expect, it } from "vitest";
import {
  correlationDisplayProps,
  isPlaceholderService,
  isTraceBacked,
  placeholderLineKey,
  serviceRefFrom,
  showsDetectedAs,
} from "./serviceRef";
import { labelRows } from "@/components/shared/ServiceNameLabel.fixtures";

describe("serviceRef", () => {
  it("keeps the key as the value and the qualified display as the label", () => {
    expect(serviceRefFrom(labelRows.differs)).toEqual({
      key: labelRows.differs.service_name,
      display: labelRows.differs.display_name,
    });
    expect(serviceRefFrom(labelRows.qualified)).toEqual({
      key: labelRows.qualified.service_name,
      display: `${labelRows.qualified.display_name} · ${labelRows.qualified.display_qualifier}`,
    });
  });

  it("shows detected-as only when the names differ case-insensitively", () => {
    expect(showsDetectedAs("checkoutservice", "CheckoutService")).toBe(false);
    expect(showsDetectedAs("c1-openobserve-ingester", "ingester")).toBe(true);
    expect(showsDetectedAs("payments", undefined)).toBe(false);
  });

  it("reads the scope only for trace and alias sources", () => {
    expect(
      ["trace", "alias:rename", "alias:k8s_workload", "detection", undefined].map(isTraceBacked),
    ).toEqual([true, true, true, false, false]);
  });

  it("recognises the SDK placeholder pattern", () => {
    expect(isPlaceholderService("unknown_service:node")).toBe(true);
    expect(isPlaceholderService("unknown_service")).toBe(true);
    expect(isPlaceholderService("unknown_services")).toBe(false);
  });

  it("treats the ingest default and an empty name as placeholders, not as services", () => {
    expect(isPlaceholderService("default")).toBe(true);
    expect(isPlaceholderService("")).toBe(true);
    expect(isPlaceholderService("default-api")).toBe(false);
    expect(isPlaceholderService("Default")).toBe(false);
  });

  it("says the SDK sent a placeholder only for unknown_service, and no name was sent otherwise", () => {
    expect(placeholderLineKey("unknown_service:node")).toBe("serviceVersions.names.placeholder");
    expect(placeholderLineKey("unknown_service")).toBe("serviceVersions.names.placeholder");
    expect(placeholderLineKey("")).toBe("serviceVersions.names.noServiceName");
    expect(placeholderLineKey("default")).toBe("serviceVersions.names.noServiceName");
    expect(placeholderLineKey("payments")).toBeNull();
  });

  it("maps a correlate response to drawer display props without touching the key", () => {
    expect(correlationDisplayProps(labelRows.qualified)).toEqual({
      displayServiceName: "querier",
      serviceDisplay: {
        display_source: "alias:k8s_workload",
        display_candidates: undefined,
        display_qualifier: "pentest",
      },
    });
    expect(correlationDisplayProps(labelRows.noDisplay).displayServiceName).toBe(undefined);
  });
});
