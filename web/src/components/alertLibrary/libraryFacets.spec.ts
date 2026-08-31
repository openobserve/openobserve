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

import { describe, expect, it } from "vitest";

import {
  SEVERITY_ORDER,
  categoryLabel,
  packLabel,
  severityBadgeValue,
  severityLabel,
  severityRank,
} from "./libraryFacets";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";

const t = i18n.global.t as unknown as TranslateFn;

describe("libraryFacets", () => {
  describe("severity ordering", () => {
    it("ranks hottest first", () => {
      expect(SEVERITY_ORDER).toEqual(["critical", "warning", "info"]);
      expect(severityRank("critical")).toBeLessThan(severityRank("warning"));
      expect(severityRank("warning")).toBeLessThan(severityRank("info"));
    });

    it("sorts an unrecognised severity last rather than first", () => {
      expect(severityRank("sev0")).toBeGreaterThan(severityRank("info"));
    });
  });

  describe("severityBadgeValue", () => {
    it("maps warning onto the badge group's amber, matching its installed priority", () => {
      // The severity group has no "warning"; medium is the amber P3 also uses.
      expect(severityBadgeValue("warning")).toBe("medium");
    });

    it("passes through values the badge group already knows", () => {
      expect(severityBadgeValue("critical")).toBe("critical");
      expect(severityBadgeValue("info")).toBe("info");
    });

    it("passes an unknown severity through untouched", () => {
      expect(severityBadgeValue("sev0")).toBe("sev0");
    });
  });

  describe("severityLabel", () => {
    it("translates the three library severities", () => {
      expect(severityLabel(t, "critical")).toBe("Critical");
      expect(severityLabel(t, "warning")).toBe("Warning");
      expect(severityLabel(t, "info")).toBe("Info");
    });

    it("shows an unrecognised severity verbatim instead of relabelling it", () => {
      expect(severityLabel(t, "sev0")).toBe("sev0");
    });
  });

  describe("packLabel", () => {
    it("uses the product name for a known pack", () => {
      expect(packLabel("k8s")).toBe("Kubernetes");
      expect(packLabel("openobserve")).toBe("OpenObserve");
    });

    it("falls back to the id so a new pack needs no frontend change", () => {
      expect(packLabel("aws")).toBe("aws");
    });

    it("does not read through the prototype chain", () => {
      expect(packLabel("constructor")).toBe("constructor");
    });
  });

  describe("categoryLabel", () => {
    it("humanises a hyphenated id", () => {
      expect(categoryLabel("control-plane")).toBe("Control plane");
      expect(categoryLabel("resource-optimization")).toBe("Resource optimization");
    });

    it("humanises an underscored id", () => {
      expect(categoryLabel("app_performance")).toBe("App performance");
    });

    it("leaves a single word capitalised", () => {
      expect(categoryLabel("pod")).toBe("Pod");
    });

    it("returns empty text for an empty id", () => {
      expect(categoryLabel("")).toBe("");
    });
  });
});
