// Copyright 2026 OpenObserve Inc.

// Pins the menu wording so a translation-pipeline rewrite shows up as a failing spec.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (code: string): string =>
  readFileSync(resolve(__dirname, `./languages/${code}.json`), "utf8");
const load = (code: string): any => JSON.parse(read(code));

describe("menu terms (AC-12)", () => {
  it("ar-SA uses the main-page and infrastructure senses for Home and Infra", () => {
    const ar = load("ar-SA");
    expect(ar.menu.home).toBe("الرئيسية");
    expect(ar.menu.infra).toBe("البنية التحتية");
    // The same term is already used for infrastructure elsewhere in the file.
    expect(read("ar-SA").split("البنية التحتية").length - 1).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ["fr-FR", "Pipelines de données"],
    ["es-ES", "Pipelines de datos"],
    ["pt-PT", "Pipelines de dados"],
    ["nl-NL", "Datapipelines"],
  ])("%s function.streamPipeline is a data pipeline, not a physical pipe", (code, value) => {
    expect(load(code).function.streamPipeline).toBe(value);
  });

  it("de-DE says Alarme in the header and the menu, like its items", () => {
    const de = load("de-DE");
    expect(de.menu.alerts).toBe("Alarme");
    expect(de.alerts.header).toBe("Alarme");
    expect(de.alerts.allAlerts).toBe("Alle Alarme");
  });

  it("nl-NL says alarm across the header, the menu and the library", () => {
    const nl = load("nl-NL");
    expect(nl.menu.alerts).toBe("Alarmen");
    expect(nl.alerts.header).toBe("Alarmen");
    expect(nl.alerts.allAlerts).toBe("Alle alarmen");
    expect(nl.alert_library.header).toBe("Alarmbibliotheek");
  });

  it("en-US defines the trial copy the rail, flyout and toast read", () => {
    const en = load("en-US");
    expect(en.menu.trialEndedTitle).toBe("Your trial has ended");
    expect(en.menu.trialPageNeedsPlan).toBe("{page} needs a plan");
    expect(en.menu.trialPageNeedsPlanToast).toContain("{page} needs a plan");
    expect(en.menu.trialChoosePlanToast).toContain("{product}");
    expect(en.menu.trialFlyoutNote).toBe("Your trial has ended. Pages with a lock need a plan.");
  });
});
