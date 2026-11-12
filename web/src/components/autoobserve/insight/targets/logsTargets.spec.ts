// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/stores", () => ({
  default: { state: { selectedOrganization: { identifier: "demo-org" } } },
}));

import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import config from "@/aws-exports";
import { b64DecodeUnicode } from "@/utils/zincutils";
import { LEAD_US, logsForField, logsForFinding, logsForGap, logsForSources } from "./logsTargets";

const HOUR = 3_600_000_000;
const SIGNAL = 1_793_966_400_000_000;
const NOW = SIGNAL + 2 * HOUR;

const queryOf = (route: any) => route.query as Record<string, string>;
const filterOf = (route: any) => b64DecodeUnicode(queryOf(route).query);

afterEach(() => {
  config.isEnterprise = "true";
});

describe("logsForFinding", () => {
  it("opens the stream from six hours before the signal to now", () => {
    const route = logsForFinding(
      { stream_type: "logs", stream_name: "ingest_a", signal_at: SIGNAL },
      NOW,
    );

    expect(LEAD_US).toBe(6 * HOUR);
    expect(route).toMatchObject({ path: "/logs" });
    expect(queryOf(route)).toMatchObject({
      stream_type: "logs",
      stream: "ingest_a",
      from: String(SIGNAL - 6 * HOUR),
      to: String(NOW),
      sql_mode: "false",
      org_identifier: "demo-org",
    });
    expect(filterOf(route)).toBe("");
  });

  it("groups by sender only when a sender field is known", () => {
    const route = logsForFinding(
      { stream_type: "logs", stream_name: "ingest_a", signal_at: SIGNAL },
      NOW,
      "k8s_cluster",
    );

    expect(queryOf(route).sql_mode).toBe("true");
    expect(filterOf(route)).toBe(
      'SELECT "k8s_cluster", count(*) AS row_count FROM "ingest_a" GROUP BY "k8s_cluster" ORDER BY row_count DESC',
    );
  });

  it("opens a traces stream on the traces page and a metrics stream nowhere", () => {
    const traces = logsForFinding(
      { stream_type: "traces", stream_name: "app", signal_at: SIGNAL },
      NOW,
    );

    expect(traces).toMatchObject({ name: "traces", query: { stream: "app", tab: "traces" } });
    expect(
      logsForFinding({ stream_type: "metrics", stream_name: "up", signal_at: SIGNAL }, NOW),
    ).toBeNull();
  });
});

describe("logsForSources", () => {
  const base = {
    stream_type: "logs",
    stream_name: "k8s_events",
    field: "k8s_cluster",
    from: SIGNAL,
    to: null,
    now: NOW,
  };

  it("filters one source with IN, from six hours before onset to now", () => {
    const route = logsForSources({ ...base, values: ["cluster-d"] });

    expect(filterOf(route)).toBe(`"k8s_cluster" IN ('cluster-d')`);
    expect(queryOf(route)).toMatchObject({ from: String(SIGNAL - 6 * HOUR), to: String(NOW) });
  });

  it("lists many, each escaped, once", () => {
    const route = logsForSources({ ...base, values: ["cluster-d", "o'brien", "cluster-d", ""] });

    expect(filterOf(route)).toBe(`"k8s_cluster" IN ('cluster-d', 'o''brien')`);
  });

  it("strips double quotes from the field and quotes it", () => {
    const route = logsForSources({ ...base, field: 'host"-name', values: ["h1"] });

    expect(filterOf(route)).toBe(`"host-name" IN ('h1')`);
  });

  it("ends at the outage's end when it has one", () => {
    const route = logsForSources({ ...base, to: SIGNAL + HOUR, values: ["cluster-d"] });

    expect(queryOf(route).to).toBe(String(SIGNAL + HOUR));
  });

  it("has nothing to open with no sources", () => {
    expect(logsForSources({ ...base, values: [] })).toBeNull();
  });
});

describe("logsForGap", () => {
  it("is the stop to the recovery", () => {
    const route = logsForGap({
      stream_type: "logs",
      stream_name: "k8s_events",
      field: "k8s_cluster",
      values: ["cluster-f"],
      from: SIGNAL,
      to: SIGNAL + HOUR,
    });

    expect(queryOf(route)).toMatchObject({ from: String(SIGNAL), to: String(SIGNAL + HOUR) });
    expect(filterOf(route)).toBe(`"k8s_cluster" IN ('cluster-f')`);
  });
});

describe("logsForField", () => {
  it("counts the candidate field's values over the window", () => {
    const route = logsForField({
      stream_type: "logs",
      stream_name: "app_logs",
      field: "level",
      from: SIGNAL,
      to: NOW,
    });

    expect(filterOf(route)).toBe(
      'SELECT "level", count(*) AS row_count FROM "app_logs" GROUP BY "level" ORDER BY row_count DESC',
    );
  });
});

describe("a field named like a SQL keyword", () => {
  it("is quoted in every logs filter, so the page can parse it", () => {
    const window = { stream_type: "logs", stream_name: "app_logs", field: "select" };
    const sources = filterOf(
      logsForSources({ ...window, values: ["v"], from: SIGNAL, to: null, now: NOW }),
    );
    const grouped = filterOf(logsForField({ ...window, from: SIGNAL, to: NOW }));

    expect(sources).toBe(`"select" IN ('v')`);
    expect(grouped).toBe(
      'SELECT "select", count(*) AS row_count FROM "app_logs" GROUP BY "select" ORDER BY row_count DESC',
    );
    expect(() => new Parser().astify(grouped)).not.toThrow();
  });
});

describe("on an OSS build", () => {
  it("every logs target is absent", () => {
    config.isEnterprise = "false";
    const window = {
      stream_type: "logs",
      stream_name: "s",
      field: "f",
      values: ["v"],
      from: 1,
      to: 2,
    };

    expect(
      logsForFinding({ stream_type: "logs", stream_name: "s", signal_at: SIGNAL }, NOW),
    ).toBeNull();
    expect(logsForSources(window)).toBeNull();
    expect(logsForGap(window)).toBeNull();
    expect(logsForField(window)).toBeNull();
  });
});
