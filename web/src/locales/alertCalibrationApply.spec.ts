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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import enMessages from "@/locales/languages/en-US.json";
import { applyCopy } from "@/components/alert_calibration/applySuggestion";
import type { PlannedField } from "@/utils/alerts/alertEditHandoff";

const SOURCE = resolve(__dirname, "../components/alert_calibration/applySuggestion.ts");

const RAW_NAMES =
  /pending_period_secs|keep_firing_for_secs|silence_minutes|apply_suggestion|pendingPeriodSecs|keepFiringForSecs|silenceMinutes/;

const resolveKey = (key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      enMessages,
    );

describe("alert calibration apply copy", () => {
  it("every apply copy key resolves and no raw field name shows", () => {
    const keys = [
      ...readFileSync(SOURCE, "utf8").matchAll(/"((?:alertCalibration|alerts|common)\.[\w.]+)"/g),
    ].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.filter((key) => typeof resolveKey(key) !== "string")).toEqual([]);

    const copy = applyCopy(i18n.global.t as unknown as TranslateFn, "en-US");
    const fields: PlannedField[] = [
      { key: "pendingPeriodSecs", from: 60, to: 120, live: 60 },
      { key: "keepFiringForSecs", from: 0, to: 300, live: 0 },
      { key: "silenceMinutes", from: 10, to: 45, live: 10 },
      {
        key: "destinations",
        from: [],
        to: ["ops-pager", "ops-mail", "ops-chat", "ops-sms"],
        live: [],
      },
    ];
    const texts = [
      copy.button(),
      copy.title("ops_cpu"),
      copy.note(),
      copy.continueLabel(),
      copy.cancel(),
      copy.reviewInstead(),
      copy.setting(),
      copy.current(),
      copy.suggested(),
      copy.deleted(),
      copy.denied(),
      copy.failed(),
      copy.retry(),
      copy.unsupported(),
      copy.review(),
      copy.applied(fields),
      ...fields.map((field) => copy.stale(field)),
      ...fields.map((field) => copy.consequence(field.key, field.to)),
      ...fields.map((field) => copy.fieldLabel(field.key)),
      copy.notApplied("draft"),
      copy.notApplied("stale"),
      copy.notApplied("invalid"),
      copy.notApplied("missingDestination", ["gone"]),
    ].map(String);
    for (const text of texts) {
      expect(text).not.toMatch(RAW_NAMES);
      expect(text).not.toMatch(/^(alertCalibration|alerts|common)\./);
      expect(text).not.toMatch(/\{\w+\}/);
    }
    expect(copy.applied(fields)).toContain("ops-pager, ops-mail, ops-chat, and 1 more");
  });
});
