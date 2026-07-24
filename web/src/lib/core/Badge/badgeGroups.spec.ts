// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { resolveBadge, normalizeKey, BADGE_GROUPS } from "./badgeGroups";

describe("badgeGroups", () => {
  it("normalizes separators and case", () => {
    expect(normalizeKey("Real-Time")).toBe("realtime");
    expect(normalizeKey("real_time")).toBe("realtime");
    expect(normalizeKey("realTime")).toBe("realtime");
  });

  it("resolves alertType to icon mode with the right colour + icon", () => {
    const r = resolveBadge("alertType", "realTime");
    expect(r.mode).toBe("icon");
    expect(r.variant).toBe("blue-soft");
    expect(r.icon).toBe("bolt");
    expect(r.dot).toBe(false);
    expect(r.label).toBe("Real-time");
  });

  it("resolves alertStatus to dot mode (no icon)", () => {
    const r = resolveBadge("alertStatus", "active");
    expect(r.mode).toBe("dot");
    expect(r.variant).toBe("success-soft");
    expect(r.dot).toBe(true);
    expect(r.icon).toBeUndefined();
  });

  it("resolves logLevel to plain mode (no dot, no icon)", () => {
    const r = resolveBadge("logLevel", "error");
    expect(r.mode).toBe("plain");
    expect(r.variant).toBe("error-soft");
    expect(r.dot).toBe(false);
    expect(r.icon).toBeUndefined();
  });

  it("uses generic semantic mapping for unknown group", () => {
    expect(resolveBadge(undefined, "failed").variant).toBe("error-soft");
    expect(resolveBadge("nope", "active").variant).toBe("success-soft");
  });

  it("resolves enrichmentJobStatus 1:1 (dot, solid)", () => {
    expect(resolveBadge("enrichmentJobStatus", "completed").variant).toBe("success");
    expect(resolveBadge("enrichmentJobStatus", "failed").variant).toBe("error");
    expect(resolveBadge("enrichmentJobStatus", "processing").variant).toBe("primary");
    expect(resolveBadge("enrichmentJobStatus", "whatever").variant).toBe("default");
    expect(resolveBadge("enrichmentJobStatus", "completed").dot).toBe(true);
  });
  it("resolves backfillJobStatus 1:1 (plain, solid, deletion overlay)", () => {
    const cases: Record<string, string> = {
      running: "success",
      completed: "success",
      failed: "error",
      pending: "warning",
      canceled: "default",
      deletionfailed: "error",
      weird: "default",
    };
    for (const [v, variant] of Object.entries(cases)) {
      expect(resolveBadge("backfillJobStatus", v).variant, v).toBe(variant);
      expect(resolveBadge("backfillJobStatus", v).dot, `${v} dot`).toBe(false);
    }
  });
  it("resolves fieldNameChip (highlight→primary, muted→default-soft, pill, sm)", () => {
    expect(resolveBadge("fieldNameChip", "highlight").variant).toBe("primary");
    expect(resolveBadge("fieldNameChip", "muted").variant).toBe("default-soft");
    expect(resolveBadge("fieldNameChip", "highlight").shape).toBe("pill");
    expect(resolveBadge("fieldNameChip", "highlight").size).toBe("sm");
  });

  it("resolves diffCategory (new→success, modified→warning, unchanged→default)", () => {
    expect(resolveBadge("diffCategory", "new").variant).toBe("success");
    expect(resolveBadge("diffCategory", "modified").variant).toBe("warning");
    expect(resolveBadge("diffCategory", "unchanged").variant).toBe("default");
    expect(resolveBadge("diffCategory", "new").shape).toBe("pill");
  });

  it("resolves normalizeState boolean → primary/Normalized, default/Not Normalized", () => {
    const t = resolveBadge("normalizeState", true);
    expect(t.variant).toBe("primary");
    expect(t.label).toBe("Normalized");
    const f = resolveBadge("normalizeState", false);
    expect(f.variant).toBe("default");
    expect(f.label).toBe("Not Normalized");
  });

  it("resolves fieldDiffStatus (new→success, existing→default, sm)", () => {
    expect(resolveBadge("fieldDiffStatus", "new").variant).toBe("success");
    expect(resolveBadge("fieldDiffStatus", "existing").variant).toBe("default");
    expect(resolveBadge("fieldDiffStatus", "new").size).toBe("sm");
  });

  it("resolves templateDefaultFlag (default, pill, md, no dot)", () => {
    const r = resolveBadge("templateDefaultFlag", "default");
    expect(r.variant).toBe("default");
    expect(r.shape).toBe("pill");
    expect(r.size).toBe("md");
    expect(r.dot).toBe(false);
  });

  it("resolves readonlyFlag (default, pill, sm, no dot)", () => {
    const r = resolveBadge("readonlyFlag", "readonly");
    expect(r.variant).toBe("default");
    expect(r.shape).toBe("pill");
    expect(r.size).toBe("sm");
    expect(r.dot).toBe(false);
  });

  it("resolves cliPreset to its uniform fallback colour (pill, md) for any value", () => {
    for (const v of ["kubectl", "gh", "anything"]) {
      const r = resolveBadge("cliPreset", v);
      expect(r.variant, v).toBe("primary-soft");
      expect(r.shape, v).toBe("pill");
      expect(r.size, v).toBe("md");
      expect(r.dot, v).toBe(false);
    }
  });

  it("resolves destinationKind 1:1 (prebuilt→primary, custom→default, pill)", () => {
    expect(resolveBadge("destinationKind", "prebuilt").variant).toBe("primary");
    expect(resolveBadge("destinationKind", "custom").variant).toBe("default");
    expect(resolveBadge("destinationKind", "prebuilt").shape).toBe("pill");
    expect(resolveBadge("destinationKind", "prebuilt").dot).toBe(false);
  });

  it("resolves modelSource 1:1 (org/meta_org/builtin)", () => {
    expect(resolveBadge("modelSource", "org").variant).toBe("primary");
    expect(resolveBadge("modelSource", "meta_org").variant).toBe("default-outline");
    expect(resolveBadge("modelSource", "builtin").variant).toBe("default");
  });

  it("resolves observationType 1:1 with main's solid variant map (pill, no dot)", () => {
    const cases: Record<string, string> = {
      chat: "success",
      text_completion: "success",
      generate_content: "success",
      embeddings: "primary",
      invoke_agent: "primary",
      execute_tool: "warning",
      guardrail: "error",
      span: "default",
      event: "warning",
      somethingUnknown: "default", // fallback
    };
    for (const [value, variant] of Object.entries(cases)) {
      const r = resolveBadge("observationType", value);
      expect(r.variant, `${value} variant`).toBe(variant);
      expect(r.mode, `${value} mode`).toBe("plain");
      expect(r.dot, `${value} dot`).toBe(false);
      expect(r.shape, `${value} shape`).toBe("pill");
    }
  });

  it("falls back to generic engine for unknown value in a known group", () => {
    const r = resolveBadge("alertStatus", "weird");
    expect(r.mode).toBe("dot");
    expect(r.variant).toBe("default-soft");
  });

  it("invoice 'open' is informational (blue), not a warning", () => {
    expect(resolveBadge("invoiceStatus", "open").variant).toBe("blue-soft");
  });

  it("every registry value config has a variant", () => {
    for (const group of Object.values(BADGE_GROUPS)) {
      for (const cfg of Object.values(group.values)) {
        expect(cfg.variant).toBeTruthy();
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

  it("alert 'condition_not_satisfied' resolves to the Ok label", () => {
    expect(resolveBadge("alertState", "condition_not_satisfied").label).toBe("Ok");
    expect(resolveBadge("alertState", "Condition Not Satisfied").label).toBe("Ok");
  });

  it("resolves the groups added in the OTag type/value sweep", () => {
    expect(resolveBadge("billingTag", "discount").variant).toBe("primary-soft");
    expect(resolveBadge("billingTag", "subscribed").variant).toBe("primary-soft");

    expect(resolveBadge("tabChip", "active").variant).toBe("primary");
    expect(resolveBadge("tabChip", "inactive").variant).toBe("default");

    expect(resolveBadge("userStatus", "invited").variant).toBe("warning-soft");
    expect(resolveBadge("userStatus", "invited").label).toBe("Invited");

    expect(resolveBadge("evalBadge", "weakest").variant).toBe("warning");
    expect(resolveBadge("evalBadge", "template").variant).toBe("primary-outline");

    expect(resolveBadge("featureStatus", "enabled").variant).toBe("success");
    expect(resolveBadge("featureStatus", "disabled").variant).toBe("error");

    expect(resolveBadge("toolMeta", "tool").variant).toBe("warning");
    expect(resolveBadge("toolMeta", "callid").variant).toBe("default");

    expect(resolveBadge("exampleChip", "dim").variant).toBe("primary");
    expect(resolveBadge("exampleChip", "value").variant).toBe("success");

    expect(resolveBadge("reportTag", "png").variant).toBe("primary-outline");
    expect(resolveBadge("reportTag", "preview").variant).toBe("default-outline");
  });

  it("correlationChip: overflow plain, subject amber-outline WITH dot, md", () => {
    expect(resolveBadge("correlationChip", "overflow").variant).toBe("default-soft");
    expect(resolveBadge("correlationChip", "overflow").dot).toBe(false);
    expect(resolveBadge("correlationChip", "subject").variant).toBe("amber-outline");
    expect(resolveBadge("correlationChip", "subject").dot).toBe(true);
    expect(resolveBadge("correlationChip", "subject").size).toBe("md");
  });

  it("wildcardChip is a bare sm shell (colour comes from a dynamic class)", () => {
    expect(resolveBadge("wildcardChip", "anything").variant).toBe("default");
    expect(resolveBadge("wildcardChip", "anything").size).toBe("sm");
  });

  it("resolves the per-value additions (fieldTag / countChip / logsResultChip)", () => {
    expect(resolveBadge("fieldTag", "primary").variant).toBe("primary");
    expect(resolveBadge("fieldTag", "primarysoft").variant).toBe("primary-soft");
    expect(resolveBadge("countChip", "errorstrong").variant).toBe("error");
    expect(resolveBadge("logsResultChip", "error").variant).toBe("error-soft");
    expect(resolveBadge("logsResultChip", "error").shape).toBe("rounded");
  });
});
