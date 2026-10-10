// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import {
  isAlertDestination,
  pipelineDestinationsToTerraform,
} from "./pipelineDestinationTerraform";

const DESTINATION = {
  name: "ship_to_remote",
  url: "https://example.com/ingest",
  method: "post",
  skip_tls_verify: false,
  headers: { "X-Token": "abc" },
  emails: [],
  type: "http",
  metadata: {},
};

const exportOf = (destinations: Record<string, unknown>[], options = {}) =>
  pipelineDestinationsToTerraform(destinations, options);

describe("isAlertDestination", () => {
  // The two share one object on the server, told apart by the template field.
  it("treats a destination carrying a template as an alert destination", () => {
    expect(isAlertDestination({ ...DESTINATION, template: "soc_tmpl" })).toBe(true);
    expect(isAlertDestination(DESTINATION)).toBe(false);
    expect(isAlertDestination({ ...DESTINATION, template: "" })).toBe(false);
  });

  it("treats email and SNS as alert-only, since a pipeline has nowhere to forward", () => {
    expect(isAlertDestination({ ...DESTINATION, type: "email" })).toBe(true);
    expect(isAlertDestination({ ...DESTINATION, type: "sns" })).toBe(true);
  });
});

describe("pipelineDestinationsToTerraform", () => {
  it("renders an openobserve_pipeline_destination", () => {
    const { hcl, unsupported } = exportOf([DESTINATION]);

    expect(unsupported).toEqual([]);
    expect(hcl).toContain('resource "openobserve_pipeline_destination" "ship_to_remote"');
    expect(hcl).toMatch(/name\s+= "ship_to_remote"/);
    expect(hcl).toMatch(/url\s+= "https:\/\/example\.com\/ingest"/);
    expect(hcl).toMatch(/method\s+= "post"/);
  });

  it("writes headers as a map", () => {
    const { hcl } = exportOf([DESTINATION]);
    expect(hcl).toContain("headers = {");
    expect(hcl).toMatch(/"X-Token"\s+= "abc"/);
  });

  it("omits skip_tls_verify at its default and writes it when set", () => {
    expect(exportOf([DESTINATION]).hcl).not.toContain("skip_tls_verify");
    expect(exportOf([{ ...DESTINATION, skip_tls_verify: true }]).hcl).toMatch(
      /skip_tls_verify\s+= true/,
    );
  });

  it("reads destination_type from either spelling the API uses", () => {
    expect(exportOf([{ ...DESTINATION, destination_type_name: "splunk" }]).hcl).toMatch(
      /destination_type\s+= "splunk"/,
    );
    expect(exportOf([{ ...DESTINATION, destination_type: "elasticsearch" }]).hcl).toMatch(
      /destination_type\s+= "elasticsearch"/,
    );
  });

  it("refuses an alert destination rather than mislabelling it", () => {
    const { hcl, unsupported } = exportOf([{ ...DESTINATION, template: "soc_tmpl" }]);

    expect(hcl).toBe("");
    expect(unsupported).toEqual([{ name: "ship_to_remote", reason: "incomplete" }]);
  });

  it("refuses a destination with nothing to forward to", () => {
    expect(exportOf([{ name: "no_url" }]).unsupported).toEqual([
      { name: "no_url", reason: "incomplete" },
    ]);
  });
});

describe("import blocks", () => {
  // Unlike every other resource here, a destination is addressed by NAME.
  it("addresses the destination as org/name, not by an id", () => {
    const { hcl } = exportOf([DESTINATION], { orgId: "default" });

    expect(hcl).toContain("to = openobserve_pipeline_destination.ship_to_remote");
    expect(hcl).toContain('id = "default/ship_to_remote"');
  });

  it("writes none without an org", () => {
    expect(exportOf([DESTINATION]).hcl).not.toContain("import {");
  });

  it("gives colliding names distinct labels and keeps each import correct", () => {
    const { hcl } = exportOf([DESTINATION, { ...DESTINATION, url: "https://other.example.com" }], {
      orgId: "default",
    });

    expect(hcl).toContain('"openobserve_pipeline_destination" "ship_to_remote"');
    expect(hcl).toContain('"openobserve_pipeline_destination" "ship_to_remote_2"');
    expect(hcl).toContain("to = openobserve_pipeline_destination.ship_to_remote_2");
  });
});
