import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, it, expect, vi } from "vitest";
import { computed, onScopeDispose } from "vue";

import { resetAssistantV2ForTests } from "@/composables/assistant/flags";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import ShortcutCheatsheet from "../ShortcutCheatsheet.vue";
import {
  getShortcutDef,
  SHORTCUT_MODULES,
  SHORTCUT_REGISTRY,
  type ShortcutCapabilities,
} from "../shortcutRegistry";

const { capabilityDisposed } = vi.hoisted(() => ({ capabilityDisposed: vi.fn() }));

vi.mock("@/composables/assistant", () => ({
  useAssistantCapability: () => {
    onScopeDispose(capabilityDisposed);
    return { assistantCanChat: computed(() => true) };
  },
}));

const OSS: ShortcutCapabilities = {
  isEnterprise: false,
  isCloud: false,
  isMetaOrg: false,
  onlineEvalsEnabled: false,
  incidentsEnabled: false,
  modelPricingEnabled: false,
  rbacEnabled: false,
  aiEnabled: false,
  downtimesEnabled: false,
  assistantCanChat: false,
};
const ENTERPRISE: ShortcutCapabilities = {
  isEnterprise: true,
  isCloud: false,
  isMetaOrg: true,
  onlineEvalsEnabled: true,
  incidentsEnabled: true,
  modelPricingEnabled: true,
  rbacEnabled: true,
  aiEnabled: true,
  downtimesEnabled: true,
  assistantCanChat: true,
};
const CLOUD: ShortcutCapabilities = {
  isEnterprise: false,
  isCloud: true,
  isMetaOrg: true,
  onlineEvalsEnabled: true,
  incidentsEnabled: true,
  modelPricingEnabled: true,
  rbacEnabled: true,
  aiEnabled: true,
  downtimesEnabled: true,
  assistantCanChat: true,
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

/** Entry-level gate, mirroring ShortcutCheatsheet: an entry shows unless its own gate rejects the caps. */
function entryVisible(id: string, caps: ShortcutCapabilities): boolean {
  for (const g of SHORTCUT_REGISTRY) {
    const e = g.shortcuts.find((s) => s.id === id);
    if (e) return !e.visible || e.visible(caps);
  }
  throw new Error(`entry ${id} not registered`);
}

const GATED_IN_OSS = [
  "shortcuts.pages.searchSchedulers",
  "shortcuts.pages.alertSources",
  "shortcuts.pages.alertIncidents",
  "shortcuts.pages.downtimes",
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

  it("hides Downtimes on enterprise and cloud while downtimes_enabled is off", () => {
    expect(
      visiblePages({ ...ENTERPRISE, downtimesEnabled: false }).has("shortcuts.pages.downtimes"),
    ).toBe(false);
    expect(
      visiblePages({ ...CLOUD, downtimesEnabled: false }).has("shortcuts.pages.downtimes"),
    ).toBe(false);
    expect(visiblePages(ENTERPRISE).has("shortcuts.pages.downtimes")).toBe(true);
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

describe("aiChatToggle entry visibility", () => {
  it("is hidden on OSS (the shortcut is never registered there)", () => {
    expect(entryVisible("aiChatToggle", OSS)).toBe(false);
  });

  it("is hidden on cloud — the AI chat shortcut is enterprise-only", () => {
    expect(entryVisible("aiChatToggle", CLOUD)).toBe(false);
  });

  it("is hidden on enterprise when ai_enabled is off (the handler no-ops)", () => {
    expect(entryVisible("aiChatToggle", { ...ENTERPRISE, aiEnabled: false })).toBe(false);
  });

  it("is shown only on enterprise with ai_enabled on", () => {
    expect(entryVisible("aiChatToggle", ENTERPRISE)).toBe(true);
  });
});

describe("synthetics journey search shortcut", () => {
  it("registers syntheticsJourneyFocusSearch on /", () => {
    expect(getShortcutDef("syntheticsJourneyFocusSearch")).toMatchObject({
      key: "/",
      scope: "synthetics-journey",
      descriptionKey: "shortcuts.actions.focusSearch",
    });
    expect(visiblePages(ENTERPRISE).has("shortcuts.pages.syntheticsJourney")).toBe(true);
    expect(visiblePages(OSS).has("shortcuts.pages.syntheticsJourney")).toBe(true);
    expect(visiblePages(CLOUD).has("shortcuts.pages.syntheticsJourney")).toBe(true);
  });

  it("the cheatsheet modules include the synthetics journey page", () => {
    const synthetics = SHORTCUT_MODULES.find((m) => m.titleKey === "shortcuts.modules.synthetics");

    expect(synthetics).toBeDefined();
    expect(synthetics?.pages).toContain("shortcuts.pages.syntheticsJourney");
  });
});

describe("row navigation entries (item 4a)", () => {
  const entry = (id: string) =>
    SHORTCUT_REGISTRY.flatMap((g) => g.shortcuts).find((e) => e.id === id);
  const groupOf = (id: string) =>
    SHORTCUT_REGISTRY.find((g) => g.shortcuts.some((e) => e.id === id));

  it("keeps every id unique across the registry", () => {
    const ids = SHORTCUT_REGISTRY.flatMap((g) => g.shortcuts.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("binds J/K in the logs and traces scopes", () => {
    expect(getShortcutDef("logsNextRow")).toMatchObject({ key: "j", scope: "logs" });
    expect(getShortcutDef("logsPrevRow")).toMatchObject({ key: "k", scope: "logs" });
    expect(getShortcutDef("tracesNextRow")).toMatchObject({ key: "j", scope: "traces" });
    expect(getShortcutDef("tracesPrevRow")).toMatchObject({ key: "k", scope: "traces" });
  });

  it("keeps the display-only rows keyless and unregisterable", () => {
    for (const id of ["logsRowFocusMove", "logsRowOpen", "logsDetailClose", "tracesRowOpen"]) {
      const e = entry(id);
      expect(e?.display).toBeTruthy();
      expect(e?.key ?? e?.keys ?? e?.keyForMac ?? e?.keyForWindows).toBeUndefined();
      expect(getShortcutDef(id)).toBeUndefined();
    }
    expect(groupOf("logsRowOpen")?.scope).toBe("logs");
    expect(groupOf("tracesRowOpen")?.scope).toBe("traces");
  });

  it("describes trace-detail J/K as visible-span steps", () => {
    expect(getShortcutDef("traceNextSpan")?.descriptionKey).toBe(
      "shortcuts.actions.traceNextVisibleSpan",
    );
    expect(getShortcutDef("tracePrevSpan")?.descriptionKey).toBe(
      "shortcuts.actions.tracePrevVisibleSpan",
    );
  });
});

describe("assistant entries", () => {
  const ASSISTANT_IDS = [
    "assistantOpen",
    "assistantClose",
    "assistantHelper",
    "assistantHistory",
    "assistantComposerSend",
    "assistantComposerNewline",
    "assistantComposerRecall",
    "assistantGoToAnswer",
    "editorTabFocusMode",
  ];
  const assistantPages = [
    "shortcuts.pages.assistant",
    "shortcuts.pages.assistantComposer",
    "shortcuts.pages.queryEditor",
  ];

  afterEach(() => {
    delete window.__O2_ASSISTANT_V2__;
    resetAssistantV2ForTests();
  });

  it("leaves the cheatsheet unchanged with the flag off, on every edition", () => {
    window.__O2_ASSISTANT_V2__ = false;
    for (const caps of [OSS, ENTERPRISE, CLOUD]) {
      for (const id of ASSISTANT_IDS) expect(entryVisible(id, caps), id).toBe(false);
      for (const page of assistantPages) expect(visiblePages(caps).has(page), page).toBe(false);
      expect(visibleModuleTitles(caps)).not.toContain("shortcuts.modules.assistant");
    }
    expect(entryVisible("aiChatToggle", ENTERPRISE)).toBe(true);
  });

  it("shows the rows only while the assistant can chat, and never assistantClose", () => {
    window.__O2_ASSISTANT_V2__ = true;
    expect(entryVisible("assistantOpen", ENTERPRISE)).toBe(true);
    expect(entryVisible("assistantOpen", { ...ENTERPRISE, assistantCanChat: false })).toBe(false);
    expect(entryVisible("assistantOpen", { ...ENTERPRISE, aiEnabled: false })).toBe(false);
    expect(entryVisible("assistantClose", ENTERPRISE)).toBe(false);
    expect(visibleModuleTitles(ENTERPRISE)).toContain("shortcuts.modules.assistant");
  });

  it("binds the chords of 10 §6.1 with their scopes and input flags", () => {
    expect(getShortcutDef("assistantOpen")).toMatchObject({
      keyForWindows: "ctrl+i",
      keyForMac: "meta+i",
      skipInInput: false,
      scope: undefined,
    });
    expect(getShortcutDef("assistantClose")).toMatchObject({
      key: "escape",
      scope: "assistant",
      allowInInput: true,
    });
    expect(getShortcutDef("assistantHistory")).toMatchObject({
      keyForWindows: "ctrl+shift+h",
      keyForMac: "meta+shift+h",
      scope: "assistant",
      allowInInput: true,
    });
    expect(getShortcutDef("assistantHelper")).toMatchObject({
      keyForWindows: "ctrl+i",
      scope: "editor",
    });
    expect(getShortcutDef("assistantGoToAnswer")).toMatchObject({
      keyForWindows: "ctrl+up",
      keyForMac: "meta+up",
      scope: "assistantComposer",
    });
    expect(getShortcutDef("editorTabFocusMode")).toMatchObject({
      keyForWindows: "ctrl+m",
      keyForMac: "ctrl+shift+m",
      scope: "editor",
    });
    for (const id of [
      "assistantComposerSend",
      "assistantComposerNewline",
      "assistantComposerRecall",
    ])
      expect(getShortcutDef(id), id).toBeUndefined();
  });
});

describe("cheatsheet with the assistant flag on", () => {
  afterEach(() => {
    delete window.__O2_ASSISTANT_V2__;
    resetAssistantV2ForTests();
    document.body.innerHTML = "";
  });

  it("names the product through {product} and stops its capability reader on unmount", async () => {
    window.__O2_ASSISTANT_V2__ = true;
    store.state.zoConfig = { ...store.state.zoConfig, ai_enabled: true };
    const wrapper = mount(ShortcutCheatsheet, {
      props: { open: true },
      attachTo: document.body,
      global: { plugins: [store, i18n] },
    });
    await flushPromises();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Open O2 Assistant"));
    expect(document.body.textContent).toContain("O2 Assistant composer");
    expect(document.body.textContent).not.toContain("{product}");
    expect(capabilityDisposed).not.toHaveBeenCalled();
    wrapper.unmount();
    expect(capabilityDisposed).toHaveBeenCalledTimes(1);
  });
});
