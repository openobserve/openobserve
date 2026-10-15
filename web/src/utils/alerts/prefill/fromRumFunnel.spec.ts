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
import { buildPrefillFromRumFunnel, RUM_STREAM } from "./fromRumFunnel";
import { isPrefillBlocked, normalizePrefill } from "../alertPrefill";
import { getAlertSource } from "../alertSourceRegistry";
import { funnelAlertSql, type FunnelDef } from "@/utils/rum/productAnalyticsQueries";
import en from "@/locales/languages/en-US.json";
import i18n from "@/locales";

const scope = { app: "web", env: [], version: [], schema: { action_id: true } };
const def: FunnelDef = {
  steps: [
    { kind: "p", key: "/web" },
    { kind: "c", key: "save" },
  ],
  unit: "sessions",
  window: "session",
  breakdown: null,
};

describe("buildPrefillFromRumFunnel", () => {
  it("carries the funnel's alert SQL on _rumdata with the count threshold", () => {
    const prefill = buildPrefillFromRumFunnel({
      scope,
      id: null,
      def,
      events: [],
      belowPct: 40,
      timeRange: { type: "relative", relativeTimePeriod: "6h" },
    });
    expect(prefill.source).toBe("rumfunnel");
    expect(prefill.streamName).toBe(RUM_STREAM);
    expect(prefill.queryType).toBe("sql");
    expect(prefill.sql).toBe(funnelAlertSql(scope, null, def, 40, { events: [], sample: 1 }));
    expect(prefill.thresholdShape).toBe("count");
    expect(prefill.periodMinutes).toBe(360);
    expect(prefill.frequencyMinutes).toBe(60);
    expect(prefill.name).toBe("rum_funnel_web_conversion");
    expect(getAlertSource("rumfunnel").id).toBe("rumfunnel");
  });

  it("labels its source in the user's language", () => {
    const g = i18n.global as unknown as {
      locale: string | { value: string };
      setLocaleMessage: (l: string, m: unknown) => void;
    };
    const was = typeof g.locale === "string" ? g.locale : g.locale.value;
    const setLocale = (l: string) =>
      typeof g.locale === "string" ? (g.locale = l) : (g.locale.value = l);
    g.setLocaleMessage("xx-XX", {
      rum: { analytics: { funnel: { alertSource: "Embudo {app}", alertSourceNoApp: "Embudo" } } },
    });
    setLocale("xx-XX");
    try {
      const at = (app: string) =>
        buildPrefillFromRumFunnel({
          scope: { ...scope, app },
          id: null,
          def,
          events: [],
          belowPct: 40,
        }).sourceLabel;
      expect(at("web")).toBe("Embudo web");
      expect(at("")).toBe("Embudo");
    } finally {
      setLocale(was);
    }
  });

  it("states the snapshot rule in its warnings, with the text in en-US", () => {
    const prefill = buildPrefillFromRumFunnel({ scope, id: null, def, events: [], belowPct: 40 });
    expect(prefill.warnings).toContainEqual({ key: "rumFunnelSnapshot", level: "info" });
    expect(en.alerts.prefill.warnings.rumFunnelSnapshot).toContain("keeps a copy");
    expect(isPrefillBlocked(normalizePrefill(prefill))).toBe(false);
  });

  it("blocks a one-step funnel and says why", () => {
    const prefill = normalizePrefill(
      buildPrefillFromRumFunnel({
        scope,
        id: null,
        def: { ...def, steps: [def.steps[0]] },
        events: [],
        belowPct: 40,
      }),
    );
    expect(isPrefillBlocked(prefill)).toBe(true);
    expect(prefill.warnings.map((w) => w.key)).toContain("rumFunnelSteps");
  });

  it("clamps a 7-day funnel range to the alert's longest period and warns", () => {
    const prefill = buildPrefillFromRumFunnel({
      scope,
      id: null,
      def,
      events: [],
      belowPct: 40,
      timeRange: { type: "relative", relativeTimePeriod: "7d" },
    });
    expect(prefill.periodMinutes).toBe(1440);
    expect(prefill.warnings.map((w) => w.key)).toContain("periodClamped");
  });
});
