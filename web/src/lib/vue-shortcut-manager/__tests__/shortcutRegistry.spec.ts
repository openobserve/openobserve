import { describe, it, expect } from "vitest";
import {
  SHORTCUT_MODULES,
  SHORTCUT_REGISTRY,
  type ShortcutCapabilities,
} from "../shortcutRegistry";

const OSS: ShortcutCapabilities = {
  isEnterprise: false,
  isCloud: false,
  isMetaOrg: false,
  onlineEvalsEnabled: false,
  incidentsEnabled: false,
  modelPricingEnabled: false,
  rbacEnabled: false,
};
const ENTERPRISE: ShortcutCapabilities = {
  isEnterprise: true,
  isCloud: false,
  isMetaOrg: true,
  onlineEvalsEnabled: true,
  incidentsEnabled: true,
  modelPricingEnabled: true,
  rbacEnabled: true,
};
const CLOUD: ShortcutCapabilities = {
  isEnterprise: false,
  isCloud: true,
  isMetaOrg: true,
  onlineEvalsEnabled: true,
  incidentsEnabled: true,
  modelPricingEnabled: true,
  rbacEnabled: true,
};

/** Mirrors ShortcutCheatsheet: a page shows unless its gate rejects the caps. */
function visiblePages(caps: ShortcutCapabilities): Set<string> {
  const pages = new Set<string>();
  for (const g of SHORTCUT_REGISTRY) {
    if (!g.visible || g.visible(caps)) pages.add(g.pageKey);
  }
  return pages;
}

/** A module shows only while at least one of its pages is visible. */
function visibleModuleTitles(caps: ShortcutCapabilities): string[] {
  const pages = visiblePages(caps);
  return SHORTCUT_MODULES.filter((m) => m.pages.some((p) => pages.has(p))).map(
    (m) => m.title ?? m.titleKey,
  );
}

const GATED_IN_OSS = [
  "shortcuts.pages.searchSchedulers",
  "shortcuts.pages.alertSources",
  "shortcuts.pages.alertIncidents",
  "shortcuts.pages.pipelineDestinations",
  "shortcuts.pages.iamRoles",
  "shortcuts.pages.iamGroups",
  "shortcuts.pages.iamInvitations",
  "shortcuts.pages.regexPatterns",
  "shortcuts.pages.cipherKeys",
  "shortcuts.pages.nodes",
  "shortcuts.pages.modelPricing",
  "shortcuts.pages.llmProviders",
  "shortcuts.pages.aiToolsets",
  "shortcuts.pages.orgManagement",
  "shortcuts.pages.actions",
  "shortcuts.pages.evalTemplates",
  "shortcuts.pages.scorers",
  "shortcuts.pages.evalJobs",
  "shortcuts.pages.scoreConfigs",
  "shortcuts.pages.runningQueries",
];

const OSS_PAGES = [
  "shortcuts.pages.global",
  "shortcuts.pages.logs",
  "shortcuts.pages.searchHistory",
  "shortcuts.pages.alerts",
  "shortcuts.pages.alertDestinations",
  "shortcuts.pages.alertTemplates",
  "shortcuts.pages.streams",
  "shortcuts.pages.pipelines",
  "shortcuts.pages.functions",
  "shortcuts.pages.reports",
  "shortcuts.pages.iamUsers",
  "shortcuts.pages.iamServiceAccounts",
  "shortcuts.pages.ingestionTokens",
  "shortcuts.pages.rumErrors",
];

describe("shortcut cheatsheet OSS gating", () => {
  it("hides every enterprise/cloud-only page on an OSS build", () => {
    const pages = visiblePages(OSS);
    for (const p of GATED_IN_OSS) expect(pages.has(p), `${p} leaked into OSS`).toBe(false);
  });

  it("keeps the core OSS pages visible on an OSS build", () => {
    const pages = visiblePages(OSS);
    for (const p of OSS_PAGES) expect(pages.has(p), `${p} missing from OSS`).toBe(true);
  });

  it("drops the fully-gated module chips on an OSS build", () => {
    const titles = visibleModuleTitles(OSS);
    expect(titles).not.toContain("shortcuts.modules.settings");
    expect(titles).not.toContain("shortcuts.modules.onlineEvals");
    expect(titles).not.toContain("shortcuts.modules.runningQueries");
    expect(titles).not.toContain("shortcuts.modules.actions");
  });

  it("shows enterprise-only pages on enterprise and hides the cloud-only ones", () => {
    const pages = visiblePages(ENTERPRISE);
    for (const p of [
      "shortcuts.pages.regexPatterns",
      "shortcuts.pages.cipherKeys",
      "shortcuts.pages.nodes",
      "shortcuts.pages.searchSchedulers",
      "shortcuts.pages.aiToolsets",
      "shortcuts.pages.pipelineDestinations",
      "shortcuts.pages.runningQueries",
    ]) {
      expect(pages.has(p), `${p} should show on enterprise`).toBe(true);
    }
    // Cloud-only pages stay hidden on a pure enterprise build.
    expect(pages.has("shortcuts.pages.iamInvitations")).toBe(false);
    expect(pages.has("shortcuts.pages.orgManagement")).toBe(false);
  });

  it("shows cloud-only pages on cloud and hides the enterprise-only ones", () => {
    const pages = visiblePages(CLOUD);
    expect(pages.has("shortcuts.pages.iamInvitations")).toBe(true);
    expect(pages.has("shortcuts.pages.orgManagement")).toBe(true);
    // Enterprise-only pages (incl. _meta-org cluster pages) stay hidden on cloud.
    for (const p of [
      "shortcuts.pages.regexPatterns",
      "shortcuts.pages.cipherKeys",
      "shortcuts.pages.nodes",
      "shortcuts.pages.searchSchedulers",
      "shortcuts.pages.aiToolsets",
      "shortcuts.pages.pipelineDestinations",
      "shortcuts.pages.runningQueries",
    ]) {
      expect(pages.has(p), `${p} should be hidden on cloud`).toBe(false);
    }
  });

  it("keeps flag-gated pages hidden on enterprise/cloud when their /config flag is off", () => {
    const entNoFlags: ShortcutCapabilities = {
      ...ENTERPRISE,
      onlineEvalsEnabled: false,
      incidentsEnabled: false,
      modelPricingEnabled: false,
    };
    const pages = visiblePages(entNoFlags);
    expect(pages.has("shortcuts.pages.scorers")).toBe(false);
    expect(pages.has("shortcuts.pages.alertIncidents")).toBe(false);
    // Alert Sources rides the same incidents gate — the nav only reaches it via Incidents.
    expect(pages.has("shortcuts.pages.alertSources")).toBe(false);
    // llmProviders follows online_evals_enabled; modelPricing follows model_pricing_enabled.
    expect(pages.has("shortcuts.pages.llmProviders")).toBe(false);
    expect(pages.has("shortcuts.pages.modelPricing")).toBe(false);
  });

  it("gates IAM Roles/Groups behind rbac_enabled on enterprise/cloud", () => {
    const entNoRbac: ShortcutCapabilities = { ...ENTERPRISE, rbacEnabled: false };
    const pages = visiblePages(entNoRbac);
    expect(pages.has("shortcuts.pages.iamRoles")).toBe(false);
    expect(pages.has("shortcuts.pages.iamGroups")).toBe(false);
  });

  it("gates cluster-scoped pages to the _meta org", () => {
    const entNonMeta = visiblePages({ ...ENTERPRISE, isMetaOrg: false });
    expect(entNonMeta.has("shortcuts.pages.nodes")).toBe(false);
    expect(entNonMeta.has("shortcuts.pages.runningQueries")).toBe(false);
    const cloudNonMeta = visiblePages({ ...CLOUD, isMetaOrg: false });
    expect(cloudNonMeta.has("shortcuts.pages.orgManagement")).toBe(false);
  });
});
