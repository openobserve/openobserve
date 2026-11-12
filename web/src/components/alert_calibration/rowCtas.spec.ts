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

import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/locales";
import config from "@/aws-exports";
import type { TranslateFn } from "@/types/i18n";
import type { FindingRecord } from "./digests";
import { rowCtas } from "./rowCtas";

const t = i18n.global.t as unknown as TranslateFn;
const HOUR = 3_600_000_000;
const AT = 1_793_966_400_000_000;
const NOW = AT + 2 * HOUR;
const originalBuild = config.isEnterprise;

const finding = (extra: Partial<FindingRecord> = {}): FindingRecord =>
  ({
    _timestamp: AT,
    org: "default",
    config_id: "c1",
    schema_version: 2,
    kind: "finding",
    rule_id: "failure",
    severity: "High",
    confidence: "High",
    title: "payments filters on upstream_bucket, a field its stream doesn't have",
    alert_id: "a1",
    alert_name: "payments",
    finding_id: "f1",
    insight_actions: JSON.stringify([
      { type: "review_alert", alert_id: "a1", focus: "query" },
      { type: "review_source", stream_type: "logs", stream_name: "ingress" },
    ]),
    ...extra,
  }) as FindingRecord;

afterEach(() => {
  config.isEnterprise = originalBuild;
});

describe("rowCtas", () => {
  it("a not-working alert gets Review alert at its focus, its source in Logs and a draft-only AI request", () => {
    config.isEnterprise = "true";
    const ctas = rowCtas(t, finding(), NOW);
    expect(ctas.review).toEqual({ type: "review_alert", alert_id: "a1", focus: "query" });
    expect(ctas.logs).toMatchObject({
      path: "/logs",
      query: { stream: "ingress", stream_type: "logs", to: String(NOW) },
    });
    expect(ctas.ai?.subject).toBe("payments");
    expect(String(ctas.ai?.request)).toBe(
      "Alert payments filters on upstream_bucket, a field its stream doesn't have. " +
        "Suggest a corrected query, show it to me, and don't save until I say so.",
    );
    expect(ctas.ai?.facts).toContainEqual(["Alert", "payments"]);
  });

  it("other rules get Review alert only, and only when the record carries one", () => {
    const failed = rowCtas(
      t,
      finding({
        rule_id: "notify_failed",
        insight_actions: JSON.stringify([{ type: "review_alert", alert_id: "a1" }]),
      }),
      NOW,
    );
    expect(failed.review).toEqual({ type: "review_alert", alert_id: "a1" });
    expect(failed.logs).toBeNull();
    expect(failed.ai).toBeNull();
    const none = rowCtas(t, finding({ rule_id: "noise", insight_actions: "[]" }), NOW);
    expect(none).toEqual({ review: null, logs: null, ai: null });
  });

  it("a version-1 record has no typed actions, so only Ask AI can show", () => {
    const v1 = rowCtas(t, finding({ schema_version: undefined, actions: "FixAlertQuery" }), NOW);
    expect(v1.review).toBeNull();
    expect(v1.logs).toBeNull();
    expect(v1.ai).not.toBeNull();
  });

  it("the open-source build gets no Logs target", () => {
    config.isEnterprise = "false";
    expect(rowCtas(t, finding(), NOW).logs).toBeNull();
  });
});
