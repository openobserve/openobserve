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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/locales";
import config from "@/aws-exports";
import { noDataAlert as singleNoData } from "@/utils/alerts/prefill/fromAutoObserve";
import { findExisting, type ExistingAlert } from "./existingAlerts";
import { noDataAlert as bulkNoData, type ServiceScope } from "./bulkTargets";

const STREAM = { type: "logs", name: "app_logs" };
const SCOPE: ServiceScope = {
  service: "svc-a",
  cluster: null,
  namespace: null,
  stream: STREAM,
  schema: ["_timestamp", "service_name", "level"],
};
const TEAM = {
  name: "ops",
  folderId: "f-ops",
  folderName: "ops",
  source: "folder" as const,
  reason: "" as never,
};
const NOTIFY = { destinations: [] as [], reason: "none" as const };

const saved = (sql: string, over: Partial<ExistingAlert> = {}): ExistingAlert => ({
  id: "3Lwzv4Am8XjWhczJYN0m32tpiUK",
  name: "on-call watch",
  folderId: "f-other",
  folderName: "other",
  streamType: STREAM.type,
  streamName: STREAM.name,
  sql,
  ...over,
});

const draft = (sql: string) => ({
  name: "svc-a-no-data",
  folderId: "f-ops",
  streamType: STREAM.type,
  streamName: STREAM.name,
  sql,
});

let enterprise: string;
beforeEach(() => {
  enterprise = config.isEnterprise;
  config.isEnterprise = "true";
});
afterEach(() => {
  config.isEnterprise = enterprise;
});

describe("findExisting: an alert watching the same thing is the same check", () => {
  it("knows a no-data alert the single Add saved when Review and add drafts it, and the other way", () => {
    const bulk = bulkNoData(SCOPE, { team: TEAM, notify: NOTIFY })!.sql!;
    const single = singleNoData(SCOPE, { team: TEAM, notify: NOTIFY })!.sql!;
    expect(findExisting([saved(single)], draft(bulk))?.id).toBe("3Lwzv4Am8XjWhczJYN0m32tpiUK");
    expect(findExisting([saved(bulk)], draft(single))?.id).toBe("3Lwzv4Am8XjWhczJYN0m32tpiUK");
  });

  it("builds the same no-data query on both paths", () => {
    const bulk = bulkNoData(SCOPE, { team: TEAM, notify: NOTIFY })!.sql;
    const single = singleNoData(SCOPE, { team: TEAM, notify: NOTIFY })!.sql;
    expect(bulk).toBe(single);
  });

  it("ignores the SELECT alias, spacing and the threshold value", () => {
    const alert = saved(
      `SELECT count(*) AS seen FROM "app_logs" WHERE "service_name"='svc-a' HAVING count(*)=0`,
    );
    expect(
      findExisting(
        [alert],
        draft(
          `select count(*) as row_count from app_logs where service_name = 'svc-a' having count(*) = 0`,
        ),
      ),
    ).toBe(alert);
  });

  it("matches a latency alert whichever path built it, though one reads ms and the other µs", () => {
    const where = `"service_name" = 'svc-a'`;
    const p95 = `approx_percentile_cont("duration", 0.95)`;
    const alert = saved(
      `SELECT ${p95} AS p95 FROM "app_traces" WHERE ${where} HAVING ${p95} > 400000`,
      { streamType: "traces", streamName: "app_traces" },
    );
    expect(
      findExisting([alert], {
        ...draft(
          `SELECT ${p95} / 1000 AS p95_ms, count(*) AS requests FROM "app_traces" WHERE ${where} HAVING ${p95} / 1000 > 250 AND count(*) >= 20`,
        ),
        streamType: "traces",
        streamName: "app_traces",
      }),
    ).toBe(alert);
  });

  it("does not match another signal, another service or another stream on the same filter", () => {
    const noData = `SELECT count(*) AS row_count FROM "app_logs" WHERE "service_name" = 'svc-a' HAVING count(*) = 0`;
    const alert = saved(noData);
    const latency = `SELECT approx_percentile_cont("duration", 0.95) AS p95 FROM "app_logs" WHERE "service_name" = 'svc-a' HAVING approx_percentile_cont("duration", 0.95) > 500`;
    const volume = `SELECT count(*) AS n FROM "app_logs" WHERE "service_name" = 'svc-a' HAVING count(*) > 100`;
    expect(findExisting([alert], draft(latency))).toBeNull();
    expect(findExisting([alert], draft(volume))).toBeNull();
    expect(findExisting([alert], draft(noData.replace("svc-a", "svc-b")))).toBeNull();
    expect(findExisting([alert], { ...draft(noData), streamName: "other_logs" })).toBeNull();
  });

  it("does not match an errors alert to a no-data alert of the same service", () => {
    const alert = saved(
      `SELECT count(*) AS row_count FROM "app_logs" WHERE "service_name" = 'svc-a' HAVING count(*) = 0`,
    );
    expect(
      findExisting(
        [alert],
        draft(
          `SELECT count(*) AS errors FROM "app_logs" WHERE "service_name" = 'svc-a' AND lower("level") IN ('error') HAVING count(*) > 12`,
        ),
      ),
    ).toBeNull();
  });
});

describe("findExisting: quoted identifiers keep their case", () => {
  const upper = `SELECT count(*) AS row_count FROM "app_logs" WHERE "SERVICE_NAME" = 'svc-a' HAVING count(*) = 0`;
  const lower = `SELECT count(*) AS row_count FROM "app_logs" WHERE "service_name" = 'svc-a' HAVING count(*) = 0`;

  it('tells "SERVICE_NAME" from "service_name", which are two fields', () => {
    expect(findExisting([saved(upper)], draft(lower))).toBeNull();
    expect(findExisting([saved(lower)], draft(upper))).toBeNull();
  });

  it("still folds an unquoted identifier, which SQL reads in lower case", () => {
    const alert = saved(lower);
    expect(findExisting([alert], draft(lower.replace(`"service_name"`, "SERVICE_NAME")))).toBe(
      alert,
    );
  });
});
