// Copyright 2023 OpenObserve Inc.
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

import { describe, it, expect } from "vitest";
import { getPromqlLegendName, getLegendPosition } from "./legendBuilder";

describe("legendBuilder", () => {
  describe("getPromqlLegendName", () => {
    it("should replace single placeholder with metric value", () => {
      const metric = { job: "prometheus", instance: "localhost:9090" };
      const label = "{job}";

      expect(getPromqlLegendName(metric, label)).toBe("prometheus");
    });

    it("should replace multiple placeholders with metric values", () => {
      const metric = { job: "node_exporter", instance: "server1:9100" };
      const label = "{job} on {instance}";

      expect(getPromqlLegendName(metric, label)).toBe(
        "node_exporter on server1:9100",
      );
    });

    it("should handle complex template with text and multiple placeholders", () => {
      const metric = {
        job: "api",
        instance: "server1",
        environment: "production",
      };
      const label = "Service: {job} | Host: {instance} | Env: {environment}";

      expect(getPromqlLegendName(metric, label)).toBe(
        "Service: api | Host: server1 | Env: production",
      );
    });

    it("should leave placeholder unchanged if metric key does not exist", () => {
      const metric = { job: "prometheus" };
      const label = "{job} - {nonexistent}";

      expect(getPromqlLegendName(metric, label)).toBe(
        "prometheus - {nonexistent}",
      );
    });

    it("should leave placeholder unchanged if metric value is undefined", () => {
      const metric = { job: "prometheus", instance: undefined };
      const label = "{job} - {instance}";

      expect(getPromqlLegendName(metric, label)).toBe(
        "prometheus - {instance}",
      );
    });

    it("should leave placeholder unchanged if metric value is null", () => {
      const metric = { job: "prometheus", instance: null };
      const label = "{job} - {instance}";

      expect(getPromqlLegendName(metric, label)).toBe(
        "prometheus - {instance}",
      );
    });

    it("should leave placeholder unchanged if metric value is empty string", () => {
      const metric = { job: "prometheus", instance: "" };
      const label = "{job} - {instance}";

      expect(getPromqlLegendName(metric, label)).toBe(
        "prometheus - {instance}",
      );
    });

    it("should handle template with no placeholders", () => {
      const metric = { job: "prometheus" };
      const label = "Static Legend";

      expect(getPromqlLegendName(metric, label)).toBe("Static Legend");
    });

    it("should handle template with special characters", () => {
      const metric = { job: "api-server", instance: "host.example.com:8080" };
      const label = "{job}@{instance}";

      expect(getPromqlLegendName(metric, label)).toBe(
        "api-server@host.example.com:8080",
      );
    });

    it("should handle repeated placeholders", () => {
      const metric = { job: "prometheus" };
      const label = "{job} and {job} again";

      expect(getPromqlLegendName(metric, label)).toBe(
        "prometheus and prometheus again",
      );
    });

    it("should handle adjacent placeholders", () => {
      const metric = { job: "api", version: "v1" };
      const label = "{job}{version}";

      expect(getPromqlLegendName(metric, label)).toBe("apiv1");
    });

    it("should return JSON stringified metric when label is empty string", () => {
      const metric = { job: "prometheus", instance: "localhost" };
      const label = "";

      expect(getPromqlLegendName(metric, label)).toBe(JSON.stringify(metric));
    });

    it("should return JSON stringified metric when label is null", () => {
      const metric = { __name__: "up", job: "prometheus" };
      const label = null as any;

      expect(getPromqlLegendName(metric, label)).toBe(JSON.stringify(metric));
    });

    it("should return JSON stringified metric when label is undefined", () => {
      const metric = { job: "node", instance: "server1" };
      const label = undefined as any;

      expect(getPromqlLegendName(metric, label)).toBe(JSON.stringify(metric));
    });

    it("should handle empty metric object with template", () => {
      const metric = {};
      const label = "{job} - {instance}";

      expect(getPromqlLegendName(metric, label)).toBe("{job} - {instance}");
    });

    it("should handle empty metric object without template", () => {
      const metric = {};
      const label = "";

      expect(getPromqlLegendName(metric, label)).toBe(JSON.stringify({}));
    });

    it("should handle metric with __name__ label", () => {
      const metric = { __name__: "up", job: "prometheus" };
      const label = "{__name__}: {job}";

      expect(getPromqlLegendName(metric, label)).toBe("up: prometheus");
    });

    it("should handle nested braces in metric values", () => {
      const metric = { job: "test{nested}" };
      const label = "{job}";

      expect(getPromqlLegendName(metric, label)).toBe("test{nested}");
    });

    it("should handle numeric metric values", () => {
      const metric = { job: "api", port: "9090" };
      const label = "{job}:{port}";

      expect(getPromqlLegendName(metric, label)).toBe("api:9090");
    });

    it("should handle template with only one placeholder at the end", () => {
      const metric = { job: "prometheus" };
      const label = "Job: {job}";

      expect(getPromqlLegendName(metric, label)).toBe("Job: prometheus");
    });

    it("should handle template with placeholder at the beginning", () => {
      const metric = { job: "prometheus" };
      const label = "{job} - Service";

      expect(getPromqlLegendName(metric, label)).toBe("prometheus - Service");
    });

    it("should handle template with multiple same keys in metric", () => {
      const metric = { job: "api", job2: "backend" };
      const label = "{job} and {job2}";

      expect(getPromqlLegendName(metric, label)).toBe("api and backend");
    });

    it("should handle whitespace in placeholder names", () => {
      const metric = { job: "api", "my instance": "server1" };
      const label = "{job} on {my instance}";

      expect(getPromqlLegendName(metric, label)).toBe("api on server1");
    });

    it("should preserve template when no placeholders exist in template", () => {
      const metric = { job: "api" };
      const label = "No placeholders here";

      expect(getPromqlLegendName(metric, label)).toBe("No placeholders here");
    });
  });

  describe("getLegendPosition", () => {
    it('should return "horizontal" for "bottom" position', () => {
      expect(getLegendPosition("bottom")).toBe("horizontal");
    });

    it('should return "vertical" for "right" position', () => {
      expect(getLegendPosition("right")).toBe("vertical");
    });

    it('should return "horizontal" for unknown position', () => {
      expect(getLegendPosition("top")).toBe("horizontal");
      expect(getLegendPosition("left")).toBe("horizontal");
      expect(getLegendPosition("center")).toBe("horizontal");
    });

    it('should return "horizontal" for empty string', () => {
      expect(getLegendPosition("")).toBe("horizontal");
    });

    it('should return "horizontal" for null', () => {
      expect(getLegendPosition(null as any)).toBe("horizontal");
    });

    it('should return "horizontal" for undefined', () => {
      expect(getLegendPosition(undefined as any)).toBe("horizontal");
    });

    it("should handle case-sensitive position values", () => {
      expect(getLegendPosition("Bottom")).toBe("horizontal");
      expect(getLegendPosition("RIGHT")).toBe("horizontal");
      expect(getLegendPosition("BOTTOM")).toBe("horizontal");
    });

    it("should handle numeric input", () => {
      expect(getLegendPosition(123 as any)).toBe("horizontal");
    });

    it("should handle special characters", () => {
      expect(getLegendPosition("@#$%")).toBe("horizontal");
    });
  });
});
