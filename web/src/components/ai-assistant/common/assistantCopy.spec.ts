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
import { createI18n } from "vue-i18n";

import enUS from "@/locales/languages/en-US.json";

// Compiled through vue-i18n itself, since a bare `@`, `|` or brace in a message throws only when it is rendered.
const i18n = createI18n({ legacy: false, locale: "en-US", messages: { "en-US": enUS } });

const { t } = i18n.global;

describe("assistant copy renders through vue-i18n", () => {
  it("shows the literal @ in the composer placeholders", () => {
    expect(t("assistant.composer.placeholderAt")).toBe("Ask anything · @ to add context");
    expect(t("assistant.composer.followUpAt")).toBe("Ask a follow-up · @ to add context");
  });

  it("fills the strip and queue copy", () => {
    expect(t("assistant.composer.strip.busyFor", { s: 4 })).toBe("Busy · send again in 4 s");
    expect(t("assistant.composer.strip.offline")).toBe("Offline · draft kept");
    expect(t("assistant.composer.strip.enterQueues")).toBe("Answer running · Enter queues this");
    expect(t("assistant.composer.queued", { count: 1 })).toBe("1 queued");
    expect(t("assistant.composer.strip.pastedLines", { count: 2400 }, 2400)).toBe(
      "Pasted 2400 lines",
    );
  });

  it("fills the interpolated and plural keys", () => {
    expect(t("assistant.message.branchTitle", { title: "Checkout" })).toBe("Branch of Checkout");
    expect(t("assistant.approval.alwaysFor", { action: "pausing alerts" })).toBe(
      "Always for pausing alerts",
    );
    expect(t("home.answersReady", { count: 1 }, 1)).toBe("1 answer ready");
    expect(t("alerts.incidents.rcaRun.cancelConfirmBody", { number: 482 })).toBe(
      "Cancel the analysis for everyone on incident #482?",
    );
  });
  it("fills the chart, query and approval phrases", () => {
    expect(t("assistant.query.openAll", { explorer: "Logs", count: 42 })).toBe(
      "Open in Logs for all 42",
    );
    expect(t("assistant.chart.seriesCount", { count: 3 })).toBe("3 series");
    expect(t("assistant.chart.meta", { range: "Past 1 hour", series: "3 series" })).toBe(
      "Past 1 hour · 3 series",
    );
    expect(t("assistant.chart.name", { title: "5xx rate", series: "3 series" })).toBe(
      "5xx rate, 3 series",
    );
    const alerts = t("assistant.entity.alert", 2);
    const action = t("assistant.approval.actionPhrase.pause", { entity: alerts });
    expect(t("assistant.approval.alwaysFor", { action })).toBe("Always for pausing alerts");
    expect(t("assistant.approval.alwaysAllowed", { action })).toBe(
      "Always allowed: pausing alerts",
    );
    for (const verb of ["create", "resume", "update", "delete"])
      expect(t(`assistant.approval.actionPhrase.${verb}`, { entity: alerts })).toMatch(
        /^[a-z]+ing alerts$/,
      );
  });
  it("fills the threads and Home copy, and greets in sentence case", () => {
    expect(
      t("assistant.history.autoRuns.openName", { title: "Checkout 5xx", state: "Failed" }),
    ).toBe("Open Checkout 5xx, Failed");
    expect(t("aiAssistant.greeting.evening")).toBe("Good evening");
    expect(t("aiAssistant.greetingNamed.night", { name: "Harsh" })).toBe("Working late, Harsh");
  });
});
