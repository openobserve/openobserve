// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import { ENV_SEGMENTS, groupEnvKey } from "./serviceStreamEnvs";

describe("serviceStreamEnvs", () => {
  describe("ENV_SEGMENTS", () => {
    it("should have exactly 4 entries", () => {
      expect(Object.keys(ENV_SEGMENTS)).toHaveLength(4);
    });

    it("should contain the k8s entry with matching key and non-empty label", () => {
      expect(ENV_SEGMENTS.k8s.key).toBe("k8s");
      expect(ENV_SEGMENTS.k8s.label.length).toBeGreaterThan(0);
    });

    it("should contain the aws entry with matching key and non-empty label", () => {
      expect(ENV_SEGMENTS.aws.key).toBe("aws");
      expect(ENV_SEGMENTS.aws.label.length).toBeGreaterThan(0);
    });

    it("should contain the azure entry with matching key and non-empty label", () => {
      expect(ENV_SEGMENTS.azure.key).toBe("azure");
      expect(ENV_SEGMENTS.azure.label.length).toBeGreaterThan(0);
    });

    it("should contain the gcp entry with matching key and non-empty label", () => {
      expect(ENV_SEGMENTS.gcp.key).toBe("gcp");
      expect(ENV_SEGMENTS.gcp.label.length).toBeGreaterThan(0);
    });
  });

  describe("groupEnvKey", () => {
    describe("k8s prefix", () => {
      it('should return "k8s" when groupId is "k8s-pod"', () => {
        expect(groupEnvKey("k8s-pod")).toBe("k8s");
      });

      it('should return "k8s" when groupId is "k8s-node"', () => {
        expect(groupEnvKey("k8s-node")).toBe("k8s");
      });
    });

    describe("aws prefix", () => {
      it('should return "aws" when groupId is "aws-ec2"', () => {
        expect(groupEnvKey("aws-ec2")).toBe("aws");
      });
    });

    describe("azure prefix", () => {
      it('should return "azure" when groupId is "azure-vm"', () => {
        expect(groupEnvKey("azure-vm")).toBe("azure");
      });
    });

    describe("gcp prefix", () => {
      it('should return "gcp" when groupId is "gcp-gke"', () => {
        expect(groupEnvKey("gcp-gke")).toBe("gcp");
      });
    });

    describe("single segment matching env", () => {
      it('should return "k8s" when groupId is exactly "k8s"', () => {
        expect(groupEnvKey("k8s")).toBe("k8s");
      });
    });

    describe("multiple dashes", () => {
      it('should return "k8s" for "k8s-pod-restarts" (only first segment matters)', () => {
        expect(groupEnvKey("k8s-pod-restarts")).toBe("k8s");
      });
    });

    describe("fallback / unknown segments returning null", () => {
      it('should return null when groupId is "host"', () => {
        expect(groupEnvKey("host")).toBeNull();
      });

      it('should return null when groupId is "process-cpu"', () => {
        expect(groupEnvKey("process-cpu")).toBeNull();
      });

      it('should return null when groupId is "container"', () => {
        expect(groupEnvKey("container")).toBeNull();
      });

      it('should return null when groupId is an empty string', () => {
        expect(groupEnvKey("")).toBeNull();
      });

      it('should return null when groupId has an unknown prefix "unknown-thing"', () => {
        expect(groupEnvKey("unknown-thing")).toBeNull();
      });
    });
  });
});
