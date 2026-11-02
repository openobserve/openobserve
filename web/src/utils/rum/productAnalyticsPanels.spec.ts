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
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import {
  buildFunnelPanel,
  buildFunnelTrendPanel,
  buildTrendsPanel,
} from "@/utils/rum/productAnalyticsPanels";
import {
  assertJoinFree,
  funnelPanelSql,
  funnelTrendPanelSql,
  trendSql,
  type AnalyticsScope,
} from "@/utils/rum/productAnalyticsQueries";

const t = i18n.global.t as unknown as TranslateFn;
const scope: AnalyticsScope = { app: "web", env: [], version: [], schema: { usr_email: true } };
const id = { field: "usr_email" as const, excluded: [] };

type Panel = {
  type: string;
  queryType: string;
  queries: {
    query: string;
    customQuery: boolean;
    fields: { stream: string; x: { alias: string }[]; y: { alias: string; label: string }[] };
  }[];
};

describe("buildTrendsPanel (AC-48)", () => {
  it("is a line panel over the Q21 SQL with Sessions on y_axis_1", () => {
    const p = buildTrendsPanel(
      scope,
      id,
      "sessions",
      [],
      [],
      "1 day",
      "UTC",
      t,
    ) as unknown as Panel;
    expect(p.type).toBe("line");
    expect(p.queryType).toBe("sql");
    expect(p.queries[0].customQuery).toBe(true);
    expect(p.queries[0].fields.stream).toBe("_rumdata");
    expect(p.queries[0].query).toBe(trendSql(scope, id, "1 day", "UTC", [], []));
    expect(p.queries[0].fields.x.map((x) => x.alias)).toEqual(["x_axis_1"]);
    expect(p.queries[0].fields.y.map((y) => y.alias)).toEqual(["y_axis_1"]);
    assertJoinFree(p.queries[0].query);
  });

  it("plots Users from y_axis_2 when the metric is users", () => {
    const p = buildTrendsPanel(scope, id, "users", [], [], "1 week", "UTC", t) as unknown as Panel;
    expect(p.queries[0].fields.y.map((y) => y.alias)).toEqual(["y_axis_2"]);
    expect(p.queries[0].query).toContain("'1 week'");
  });

  it("plots one series per selected key, labelled by the key", () => {
    const series = [
      { kind: "p" as const, key: "/web" },
      { kind: "c" as const, key: "save" },
    ];
    const p = buildTrendsPanel(
      scope,
      null,
      "sessions",
      series,
      [],
      "1 day",
      "UTC",
      t,
    ) as unknown as Panel;
    expect(p.queries[0].fields.y.map((y) => [y.alias, y.label])).toEqual([
      ["y_axis_1", "/web"],
      ["y_axis_2", "save"],
    ]);
  });
});

describe("buildFunnelPanel (AC-53)", () => {
  const def = {
    steps: [
      { kind: "p" as const, key: "/a" },
      { kind: "e" as const, key: "ev1" },
    ],
    unit: "sessions" as const,
    window: "session" as const,
    breakdown: null,
  };
  const events = [
    {
      id: "ev1",
      app: "web",
      name: "Saved",
      rules: [{ t: "view" as const, op: "eq" as const, value: "/b" }],
      version: 1,
      createdBy: "",
      createdAt: 0,
      updatedBy: "",
      updatedAt: 0,
    },
  ];

  it("is a bar panel over the time-relative funnel pivot, titled by its first and last step", () => {
    const p = buildFunnelPanel(scope, def, events, t) as unknown as Panel & { title: string };
    expect(p.type).toBe("bar");
    expect(p.title).toBe("Funnel: /a → Saved");
    expect(p.queries[0].query).toBe(funnelPanelSql(scope, def, { events, sample: 1 }));
    expect(p.queries[0].query).toContain("'2. Saved'");
    expect(p.queries[0].fields.x[0]).toMatchObject({ alias: "x_axis_1", label: "Step" });
    expect(p.queries[0].fields.y[0]).toMatchObject({ alias: "y_axis_1", label: "Sessions" });
    assertJoinFree(p.queries[0].query);
  });

  it("from Trend is a line panel of each session's entry, bucketed by histogram at the chosen interval", () => {
    const three = { ...def, steps: [...def.steps, { kind: "c" as const, key: "buy" }] };
    const p = buildFunnelTrendPanel(
      scope,
      three,
      { a: 2, b: 3 },
      "week",
      events,
      t,
    ) as unknown as Panel & {
      title: string;
    };
    expect(p.type).toBe("line");
    expect(p.title).toBe("Conversion over time: Saved → buy");
    expect((p as unknown as { config: Record<string, unknown> }).config).toMatchObject({
      decimals: 1,
      connect_nulls: false,
    });
    expect(p.queries[0].query).toBe(
      funnelTrendPanelSql(scope, three, { a: 2, b: 3 }, "1 week", { events, sample: 1 }),
    );
    expect(p.queries[0].query).toContain("histogram(entry_ts, '1 week') AS x_axis_1");
    expect(p.queries[0].fields.y[0]).toMatchObject({ alias: "y_axis_1", label: "Conversion (%)" });
    for (const [g, interval] of [
      ["day", "1 day"],
      ["month", "1 month"],
    ] as const)
      expect(
        (buildFunnelTrendPanel(scope, three, { a: 1, b: 3 }, g, events, t) as unknown as Panel)
          .queries[0].query,
      ).toContain(`histogram(entry_ts, '${interval}')`);
    assertJoinFree(p.queries[0].query);
  });
});

describe("P5 gap fixes: frozen exclusions in the panel SQL", () => {
  it("P5-R9: the funnel panel query carries the app's current exclusion rules", () => {
    const ruled = {
      ...scope,
      schema: { ...scope.schema, user_agent_user_agent_family: true, geo_info_country: true },
      exclusions: {
        bots: true,
        builtinBots: { version: 1, families: ["HeadlessChrome"], devices: [] },
        sessions: [{ field: "geo_info_country", op: "eq", values: ["XX"] }],
        pages: [],
      },
    } as AnalyticsScope;
    const def = {
      steps: [
        { kind: "p" as const, key: "/a" },
        { kind: "p" as const, key: "/b" },
      ],
      unit: "sessions" as const,
      window: "session" as const,
      breakdown: null,
    };
    const p = buildFunnelPanel(ruled, def, [], t) as unknown as Panel;
    expect(p.queries[0].query).toContain(
      "(user_agent_user_agent_family IS NULL OR user_agent_user_agent_family NOT IN ('HeadlessChrome'))",
    );
    expect(p.queries[0].query).toContain("(geo_info_country IS NULL OR geo_info_country <> 'XX')");
  });
});
