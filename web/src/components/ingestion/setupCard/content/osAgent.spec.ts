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

// Shared host-agent card content (design 4.2/4.5/§6): detection keyword + dashboard-ready step.

import { describe, it, expect } from "vitest";
import { hostMetricsDetect, dashboardReadyStep } from "./osAgent";
import i18n from "@/locales";
import linuxCard from "./linux";
import windowsCard from "./windows";
import macosCard from "./macos";
import { gt } from "@/types/i18n";

const SUBS = {
  url: "https://test.openobserve.ai",
  org: "test-org",
  token: "dGVzdEB0b2tlbg==",
};

describe("hostMetricsDetect", () => {
  it("is frozen to keyword detection on the verified system_ prefix", () => {
    // OTLP ingest lands hostmetrics' system.* metrics as system_* streams (3.8) — underscore included.
    expect(hostMetricsDetect).toEqual({
      streamType: "metrics",
      match: "keyword",
      streamName: "system_",
      filter: "",
    });
  });
});

describe("dashboardReadyStep", () => {
  it("auto-completes on detect and shows the view-host-dashboard action post-detect", () => {
    const step = dashboardReadyStep(gt);
    expect(step.id).toBe("dashboard");
    // completeOn:"detect" reuses isStepDone's existing branch — zero renderer change.
    expect(step.completeOn).toBe("detect");
    expect(step.action?.id).toBe("view-host-dashboard");
    expect((step.action as any)?.showOnDetect).toBe(true);
  });

  it("carries the pass-4 'Get your dashboard' copy keys", () => {
    const step = dashboardReadyStep(gt);
    expect(step.titleKey).toBe("ingestion.setupCard.dashboardReadyTitle");
    expect(step.descriptionKey).toBe("ingestion.setupCard.dashboardReadyDesc");
  });
});

describe("host agent cards include the dashboard step", () => {
  it.each([
    ["linux", linuxCard],
    ["windows", windowsCard],
    ["macos", macosCard],
  ])("%s card ends install → verify → dashboard", (_name, builder: any) => {
    const card = builder(SUBS, gt);
    expect(card.steps.map((s: any) => s.id)).toEqual(["install", "verify", "dashboard"]);
    expect(card.steps[2].completeOn).toBe("detect");
  });
});

describe("ingestion.setupCard i18n keys (design 4.2 — the 9 new en-US keys)", () => {
  const NEW_KEYS = [
    "ingestion.setupCard.dashboardReadyTitle",
    "ingestion.setupCard.dashboardReadyDesc",
    "ingestion.setupCard.chipDashboard",
    "ingestion.setupCard.viewHostDashboard",
    "ingestion.setupCard.hostDashboardImported",
    "ingestion.setupCard.hostDashboardExists",
    "ingestion.setupCard.viewHosts",
    "ingestion.setupCard.hostDashboardImportForbidden",
    "ingestion.setupCard.hostDashboardImportFailed",
  ];

  it.each(NEW_KEYS)("%s exists in en-US (t(key) must not echo the key)", (key) => {
    // vue-i18n echoes the raw key when missing — echoing makes every t()-based pin vacuous.
    expect(i18n.global.t(key)).not.toBe(key);
  });

  it("keeps the forbidden and generic failure copy distinct (pass-4 finding 2)", () => {
    expect(i18n.global.t("ingestion.setupCard.hostDashboardImportForbidden")).not.toBe(
      i18n.global.t("ingestion.setupCard.hostDashboardImportFailed"),
    );
  });

  it("leads the imported/exists toast copy with the Infra → Hosts destination (4.2)", () => {
    expect(i18n.global.t("ingestion.setupCard.hostDashboardImported")).toContain("Infra → Hosts");
    expect(i18n.global.t("ingestion.setupCard.hostDashboardExists")).toContain("Infra → Hosts");
    expect(i18n.global.t("ingestion.setupCard.viewHosts")).toBe("View Hosts");
    expect(i18n.global.t("ingestion.setupCard.dashboardReadyTitle")).toBe("Get your dashboard");
  });
});
