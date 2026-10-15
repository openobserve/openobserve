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

import { describe, it, expect } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import {
  describeReadyMadeInstall,
  isReadyMadeGapFill,
  joinReadyMadeNamesCapped,
  primaryReadyMadeDashboard,
  type ReadyMadeInstallSuccess,
} from "./readyMadeMessages";

const t = ((...args: unknown[]) => (i18n.global as any).t(...args)) as TranslateFn;

const k8s = (
  created: string[],
  status: "created" | "exists" = created.length ? "created" : "exists",
): ReadyMadeInstallSuccess => ({
  status,
  sourceId: "kubernetes",
  folderId: "team",
  folderName: "Platform team",
  dashboards: ["Cluster", "Node", "Pod", "Workload"].map((name) => ({
    key: name.toLowerCase(),
    title: `Kubernetes / ${name}`,
    dashboardId: `id-${name}`,
    // A set the user moved to their own folder; anything re-created lands in the Kubernetes folder.
    folderId: created.includes(name) ? "f-k8s" : "team",
    folderName: created.includes(name) ? "Kubernetes" : "Platform team",
    created: created.includes(name),
  })),
});

describe("describeReadyMadeInstall", () => {
  it("a whole new set says how many were added and to which folder", () => {
    expect(describeReadyMadeInstall(k8s(["Cluster", "Node", "Pod", "Workload"]), t, "en-US")).toBe(
      "4 Kubernetes dashboards added to the Kubernetes folder.",
    );
  });

  it("a set already in place says where it is", () => {
    expect(describeReadyMadeInstall(k8s([]), t, "en-US")).toBe(
      "4 Kubernetes dashboards are in the Platform team folder.",
    );
  });

  it("a deleted dashboard put back is named, with the folder it went into", () => {
    expect(describeReadyMadeInstall(k8s(["Node"]), t, "en-US")).toBe(
      "Kubernetes / Node was missing and has been added to the Kubernetes folder.",
    );
    expect(describeReadyMadeInstall(k8s(["Node", "Workload"]), t, "en-US")).toBe(
      "Kubernetes / Node and Kubernetes / Workload were missing and have been added to the Kubernetes folder.",
    );
  });
});

describe("gap fills", () => {
  it("only a partial re-create is a gap fill", () => {
    expect(isReadyMadeGapFill(k8s(["Node"]))).toBe(true);
    expect(isReadyMadeGapFill(k8s(["Cluster", "Node", "Pod", "Workload"]))).toBe(false);
    expect(isReadyMadeGapFill(k8s([]))).toBe(false);
  });

  it("opens the dashboard that came back, else the set's first", () => {
    expect(primaryReadyMadeDashboard(k8s(["Pod"])).title).toBe("Kubernetes / Pod");
    expect(primaryReadyMadeDashboard(k8s([])).title).toBe("Kubernetes / Cluster");
  });
});

describe("joinReadyMadeNamesCapped", () => {
  const names = ["Kubernetes", "PostgreSQL", "MySQL", "Redis", "OTel Collector", "MongoDB"];

  it("names up to four in full", () => {
    expect(joinReadyMadeNamesCapped(names.slice(0, 4), "en-US", t)).toBe(
      "Kubernetes, PostgreSQL, MySQL, and Redis",
    );
  });

  it("past four, names three and counts the rest", () => {
    expect(joinReadyMadeNamesCapped(names.slice(0, 5), "en-US", t)).toBe(
      "Kubernetes, PostgreSQL, MySQL, and 2 more",
    );
    expect(joinReadyMadeNamesCapped(names, "en-US", t, "unit")).toBe(
      "Kubernetes, PostgreSQL, MySQL, 3 more",
    );
  });
});
