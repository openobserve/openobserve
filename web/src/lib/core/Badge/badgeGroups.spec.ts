// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { resolveBadge, normalizeKey, BADGE_GROUPS } from "./badgeGroups";
import enUS from "@/locales/languages/en-US.json";

describe("badgeGroups", () => {
  it("resolves cwvBand wire values to the compare band labels", () => {
    expect(resolveBadge("cwvBand", "good")).toMatchObject({
      tone: "ok",
      labelKey: "serviceVersions.compare.cwv.good",
    });
    expect(resolveBadge("cwvBand", "needs_improvement")).toMatchObject({
      tone: "warn",
      labelKey: "serviceVersions.compare.cwv.ni",
    });
    expect(resolveBadge("cwvBand", "poor")).toMatchObject({
      tone: "err",
      labelKey: "serviceVersions.compare.cwv.poor",
    });
  });

  it("normalizes separators and case", () => {
    expect(normalizeKey("Real-Time")).toBe("realtime");
    expect(normalizeKey("real_time")).toBe("realtime");
    expect(normalizeKey("realTime")).toBe("realtime");
  });

  it("resolves alertType to icon mode with the right colour + icon", () => {
    const r = resolveBadge("alertType", "realTime");
    expect(r.mode).toBe("icon");
    expect(r.tone).toBe("neutral");
    expect(r.icon).toBe("bolt");
    expect(r.dot).toBe(false);
    expect(r.labelKey).toBe("components.badge.alertType.realtime");
  });

  it("resolves oncallResponseState exhausted to Nobody answered", () => {
    const r = resolveBadge("oncallResponseState", "exhausted");
    expect(r.tone).toBe("err");
    expect(r.labelKey).toBe("oncall.state_exhausted");
  });

  it("resolves the on-call routing groups", () => {
    expect(resolveBadge("oncallRuleHealth", "shadowed").tone).toBe("warn");
    expect(resolveBadge("oncallUnroutedOutcome", "nobody").labelKey).toBe(
      "oncall.unroutedPagedNobody",
    );
  });

  it("resolves alertStatus to dot mode (no icon)", () => {
    const r = resolveBadge("alertStatus", "active");
    expect(r.mode).toBe("dot");
    expect(r.tone).toBe("ok");
    expect(r.dot).toBe(true);
    expect(r.icon).toBeUndefined();
  });

  it("resolves licenseWaiverStatus", () => {
    expect(resolveBadge("licenseWaiverStatus", "active").tone).toBe("ok");
    expect(resolveBadge("licenseWaiverStatus", "scheduled").tone).toBe("info");
    const past = resolveBadge("licenseWaiverStatus", "past");
    expect(past.tone).toBe("neutral");
    expect(past.labelKey).toBe("components.badge.licenseWaiverStatus.past");
    const ended = resolveBadge("licenseWaiverStatus", "ended");
    expect(ended.tone).toBe("neutral");
    expect(ended.labelKey).toBe("components.badge.licenseWaiverStatus.ended");
  });

  it("resolves downtimeStatus to dot mode with an amber active state", () => {
    expect(resolveBadge("downtimeStatus", "active").tone).toBe("warn");
    expect(resolveBadge("downtimeStatus", "scheduled").tone).toBe("info");
    expect(resolveBadge("downtimeStatus", "ended").tone).toBe("neutral");
    const cancelled = resolveBadge("downtimeStatus", "cancelled");
    expect(cancelled.tone).toBe("outline");
    expect(cancelled.dot).toBe(true);
    expect(cancelled.labelKey).toBe("components.badge.downtimeStatus.cancelled");
    const early = resolveBadge("downtimeStatus", "ended_early");
    expect(early.tone).toBe("neutral");
    expect(early.labelKey).toBe("components.badge.downtimeStatus.endedEarly");
  });

  it("resolves logLevel to plain mode (no dot, no icon)", () => {
    const r = resolveBadge("logLevel", "error");
    expect(r.mode).toBe("plain");
    expect(r.tone).toBe("err");
    expect(r.dot).toBe(false);
    expect(r.icon).toBeUndefined();
  });

  it("uses generic semantic mapping for unknown group", () => {
    expect(resolveBadge(undefined, "failed").tone).toBe("err");
    expect(resolveBadge("nope", "active").tone).toBe("ok");
  });

  it("resolves enrichmentJobStatus 1:1 (dot, solid)", () => {
    expect(resolveBadge("enrichmentJobStatus", "completed").tone).toBe("ok");
    expect(resolveBadge("enrichmentJobStatus", "failed").tone).toBe("err");
    expect(resolveBadge("enrichmentJobStatus", "processing").tone).toBe("info");
    expect(resolveBadge("enrichmentJobStatus", "whatever").tone).toBe("neutral");
    expect(resolveBadge("enrichmentJobStatus", "completed").dot).toBe(true);
  });
  it("resolves backfillJobStatus 1:1 (plain, solid, deletion overlay)", () => {
    const cases: Record<string, string> = {
      running: "ok",
      completed: "ok",
      failed: "err",
      pending: "warn",
      canceled: "neutral",
      deletionfailed: "err",
      weird: "neutral",
    };
    for (const [v, variant] of Object.entries(cases)) {
      expect(resolveBadge("backfillJobStatus", v).tone, v).toBe(variant);
      expect(resolveBadge("backfillJobStatus", v).dot, `${v} dot`).toBe(false);
    }
  });
  it("resolves fieldNameChip (highlight→primary, muted→default-soft, pill, sm)", () => {
    expect(resolveBadge("fieldNameChip", "highlight").tone).toBe("accent");
    expect(resolveBadge("fieldNameChip", "muted").tone).toBe("neutral");
    expect(resolveBadge("fieldNameChip", "highlight").size).toBe("sm");
  });

  it("resolves diffCategory (new→success, modified→warning, unchanged→default)", () => {
    expect(resolveBadge("diffCategory", "new").tone).toBe("ok");
    expect(resolveBadge("diffCategory", "modified").tone).toBe("warn");
    expect(resolveBadge("diffCategory", "unchanged").tone).toBe("neutral");
  });

  it("resolves normalizeState boolean → primary/Normalized, default/Not Normalized", () => {
    const t = resolveBadge("normalizeState", true);
    expect(t.tone).toBe("accent");
    expect(t.labelKey).toBe("components.badge.normalizeState.true");
    const f = resolveBadge("normalizeState", false);
    expect(f.tone).toBe("neutral");
    expect(f.labelKey).toBe("components.badge.normalizeState.false");
  });

  it("resolves fieldDiffStatus (new→success, existing→default, sm)", () => {
    expect(resolveBadge("fieldDiffStatus", "new").tone).toBe("ok");
    expect(resolveBadge("fieldDiffStatus", "existing").tone).toBe("neutral");
    expect(resolveBadge("fieldDiffStatus", "new").size).toBe("sm");
  });

  it("resolves templateDefaultFlag (default, pill, md, no dot)", () => {
    const r = resolveBadge("templateDefaultFlag", "default");
    expect(r.tone).toBe("neutral");
    expect(r.size).toBe("md");
    expect(r.dot).toBe(false);
  });

  it("resolves readonlyFlag (default, pill, sm, no dot)", () => {
    const r = resolveBadge("readonlyFlag", "readonly");
    expect(r.tone).toBe("neutral");
    expect(r.size).toBe("sm");
    expect(r.dot).toBe(false);
  });

  it("resolves cliPreset to its uniform neutral fallback (md) for any value", () => {
    for (const v of ["kubectl", "gh", "anything"]) {
      const r = resolveBadge("cliPreset", v);
      expect(r.tone, v).toBe("neutral");
      expect(r.size, v).toBe("md");
      expect(r.dot, v).toBe(false);
    }
  });

  it("resolves destinationKind 1:1 (prebuilt→primary, custom→default, pill)", () => {
    expect(resolveBadge("destinationKind", "prebuilt").tone).toBe("accent");
    expect(resolveBadge("destinationKind", "custom").tone).toBe("neutral");
    expect(resolveBadge("destinationKind", "prebuilt").dot).toBe(false);
  });

  it("resolves modelSource 1:1 (org/meta_org/builtin)", () => {
    expect(resolveBadge("modelSource", "org").tone).toBe("accent");
    expect(resolveBadge("modelSource", "meta_org").tone).toBe("outline");
    expect(resolveBadge("modelSource", "builtin").tone).toBe("neutral");
  });

  it("resolves every observationType as a neutral category (no dot)", () => {
    const cases = [
      "chat",
      "text_completion",
      "embeddings",
      "execute_tool",
      "guardrail",
      "span",
      "x",
    ];
    for (const value of cases) {
      const r = resolveBadge("observationType", value);
      expect(r.tone, `${value} tone`).toBe("neutral");
      expect(r.mode, `${value} mode`).toBe("plain");
      expect(r.dot, `${value} dot`).toBe(false);
    }
  });

  it("falls back to generic engine for unknown value in a known group", () => {
    const r = resolveBadge("alertStatus", "weird");
    expect(r.mode).toBe("dot");
    expect(r.tone).toBe("neutral");
  });

  it("invoice 'open' is informational (blue), not a warning", () => {
    expect(resolveBadge("invoiceStatus", "open").tone).toBe("info");
  });

  it("every registry value config has a tone", () => {
    for (const group of Object.values(BADGE_GROUPS)) {
      for (const cfg of Object.values(group.values)) {
        expect(cfg.tone).toBeTruthy();
      }
    }
  });

  it("every registry value key is already normalised", () => {
    for (const [groupName, group] of Object.entries(BADGE_GROUPS)) {
      for (const key of Object.keys(group.values)) {
        expect(
          key,
          `key "${key}" in group "${groupName}" is not normalised (should be "${normalizeKey(key)}")`,
        ).toBe(normalizeKey(key));
      }
    }
  });

  // Legacy `condition_not_satisfied` and current `normal` are the same state,
  // so they must render with the same word — otherwise history rows read
  // differently depending on whether they predate the RunOutcome rename.
  // `normal` carries no explicit label: it falls back to the humanised value,
  // which is the same word the `.normal` key holds.
  it("alert 'condition_not_satisfied' resolves to the Normal label", () => {
    expect(resolveBadge("alertState", "condition_not_satisfied").labelKey).toBe(
      "components.badge.alertState.normal",
    );
    expect(resolveBadge("alertState", "Condition Not Satisfied").labelKey).toBe(
      "components.badge.alertState.normal",
    );
  });

  // The backend's `completed` meant "the alert fired". Rendering it green
  // contradicted both the backend and the timeline's own aggregation.
  it("alert 'completed' is a FIRING state, not a success state", () => {
    const r = resolveBadge("alertState", "completed");
    expect(r.tone).toBe("err");
    expect(r.labelKey).toBe("components.badge.alertState.firing");
  });

  it("alert 'notify_failed' is a delivery warning, not red (R9)", () => {
    const r = resolveBadge("alertState", "notify_failed");
    expect(r.tone).toBe("warn");
    expect(r.labelKey).toBe("components.badge.alertState.notifyfailed");
  });

  it("alert 'acknowledged' is info with a person, apart from firing err and muted warn", () => {
    const r = resolveBadge("alertState", "acknowledged");
    expect(r.tone).toBe("info");
    expect(r.icon).toBe("person");
    expect(r.labelKey).toBe("components.badge.alertState.acknowledged");
  });

  it("an ack event history row is a quiet person badge", () => {
    const r = resolveBadge("alertState", "ack_event");
    expect(r.tone).toBe("neutral");
    expect(r.icon).toBe("person");
    expect(r.labelKey).toBe("components.badge.alertState.ackevent");
  });

  it("alert 'firing' and 'normal' resolve to opposite tones", () => {
    expect(resolveBadge("alertState", "firing").tone).toBe("err");
    expect(resolveBadge("alertState", "normal").tone).toBe("ok");
    expect(resolveBadge("alertState", "succeeded").tone).toBe("ok");
  });

  it("pipeline run outcomes support current and legacy trigger vocabularies", () => {
    for (const value of [
      "firing",
      "normal",
      "succeeded",
      "completed",
      "condition_not_satisfied",
      "success",
      "ok",
    ]) {
      expect(resolveBadge("pipelineRunOutcome", value).tone, value).toBe("ok");
    }

    for (const value of ["error", "failed"]) {
      expect(resolveBadge("pipelineRunOutcome", value).tone, value).toBe("err");
    }

    for (const value of ["skipped", "warning", "notify_failed"]) {
      expect(resolveBadge("pipelineRunOutcome", value).tone, value).toBe("warn");
    }
  });

  it("pipeline run outcome firing is labelled Succeeded", () => {
    const firing = resolveBadge("pipelineRunOutcome", "firing");
    expect(firing.labelKey).toBe("components.badge.pipelineRunOutcome.succeeded");
    expect(enUS.components.badge.pipelineRunOutcome.succeeded).toBe("Succeeded");
    expect(resolveBadge("pipelineRunOutcome", "succeeded").labelKey).toBe(firing.labelKey);
    expect(resolveBadge("alertState", "firing").labelKey).not.toBe(firing.labelKey);
  });

  it("resolves the groups added in the OTag type/value sweep", () => {
    expect(resolveBadge("billingTag", "discount").tone).toBe("accent");
    expect(resolveBadge("billingTag", "subscribed").tone).toBe("accent");

    expect(resolveBadge("tabChip", "active").tone).toBe("accent");
    expect(resolveBadge("tabChip", "inactive").tone).toBe("neutral");

    expect(resolveBadge("userStatus", "invited").tone).toBe("warn");
    expect(resolveBadge("userStatus", "invited").label).toBe("Invited");

    expect(resolveBadge("evalBadge", "weakest").tone).toBe("warn");
    expect(resolveBadge("evalBadge", "template").tone).toBe("outline");

    expect(resolveBadge("featureStatus", "enabled").tone).toBe("ok");
    expect(resolveBadge("featureStatus", "disabled").tone).toBe("err");

    expect(resolveBadge("toolMeta", "tool").tone).toBe("neutral");
    expect(resolveBadge("toolMeta", "callid").tone).toBe("neutral");

    expect(resolveBadge("exampleChip", "dim").tone).toBe("accent");
    expect(resolveBadge("exampleChip", "value").tone).toBe("neutral");

    expect(resolveBadge("reportTag", "png").tone).toBe("outline");
    expect(resolveBadge("reportTag", "preview").tone).toBe("outline");
  });

  it("correlationChip: overflow plain, subject amber-outline WITH dot, md", () => {
    expect(resolveBadge("correlationChip", "overflow").tone).toBe("neutral");
    expect(resolveBadge("correlationChip", "overflow").dot).toBe(false);
    expect(resolveBadge("correlationChip", "subject").tone).toBe("outline");
    expect(resolveBadge("correlationChip", "subject").dot).toBe(true);
    expect(resolveBadge("correlationChip", "subject").size).toBe("md");
  });

  it("wildcardChip is a bare sm shell (colour comes from a dynamic class)", () => {
    expect(resolveBadge("wildcardChip", "anything").tone).toBe("neutral");
    expect(resolveBadge("wildcardChip", "anything").size).toBe("sm");
  });

  it("resolves the per-value additions (fieldTag / countChip / logsResultChip)", () => {
    expect(resolveBadge("fieldTag", "primary").tone).toBe("accent");
    expect(resolveBadge("fieldTag", "primarysoft").tone).toBe("accent");
    expect(resolveBadge("countChip", "errorstrong").tone).toBe("err");
    expect(resolveBadge("logsResultChip", "error").tone).toBe("err");
  });
});

describe("aiMode", () => {
  it("renders consent-required as a warning instead of free usage", () => {
    const result = resolveBadge("aiMode", "consent_required");
    expect(result.tone).toBe("warn");
    expect(result.labelKey).toBe("paidUsage.modeConsentRequired");
  });

  it("does not label an unknown backend mode as free usage", () => {
    const result = resolveBadge("aiMode", "future_mode");
    expect(result.tone).toBe("neutral");
    expect(result.labelKey).toBe("paidUsage.modeUnknown");
  });
});

// "waiting" is the status every anomaly config carries until its first model
// trains. Without a registry entry it fell through to genericEntry, whose label
// is humanize() — English in every locale, and unstyled.
describe("alertStatus: waiting", () => {
  it("resolves from the registry, not the humanize fallback", () => {
    const r = resolveBadge("alertStatus", "waiting");
    expect(r.labelKey).toBe("components.badge.alertStatus.waiting");
    expect(r.tone).toBe("neutral");
  });
});

describe("slackInstallStatus", () => {
  it("AC-12.4 maps every installation status to a coloured, translated badge", () => {
    const expected = {
      healthy: "ok",
      degraded: "warn",
      pending: "info",
      revoked: "err",
    };
    for (const [status, variant] of Object.entries(expected)) {
      const r = resolveBadge("slackInstallStatus", status);
      expect(r.tone).toBe(variant);
      expect(r.labelKey).toBe(`components.badge.slackInstallStatus.${status}`);
    }
  });
});

describe("hookRunStatus", () => {
  it("maps every stored run status to a coloured, translated dot pill", () => {
    const expected = {
      queued: ["warn", "workflow.history.statusQueued"],
      running: ["info", "workflow.history.statusRunning"],
      succeeded: ["ok", "workflow.history.success"],
      failed: ["err", "workflow.history.failed"],
      expired: ["neutral", "workflow.history.statusExpired"],
    };
    for (const [status, [variant, labelKey]] of Object.entries(expected)) {
      const r = resolveBadge("hookRunStatus", status);
      expect(r.tone).toBe(variant);
      expect(r.labelKey).toBe(labelKey);
      expect(r.mode).toBe("dot");
    }
  });
});
