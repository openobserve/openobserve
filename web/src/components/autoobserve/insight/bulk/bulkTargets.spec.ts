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
import config from "@/aws-exports";
import { raw } from "@/types/i18n";
import {
  errorsAlert,
  latencyAlert,
  noDataAlert,
  type BuilderOptions,
  type FieldPick,
  type ServiceScope,
} from "./bulkTargets";

const original = config.isEnterprise;

const options: BuilderOptions = {
  team: {
    name: "",
    folderId: "default",
    folderName: "default",
    source: "default",
    reason: raw(""),
  },
  notify: { destinations: [], reason: "none" },
};

const scope = (extra: Partial<ServiceScope> = {}): ServiceScope => ({
  service: "svc-a",
  cluster: null,
  namespace: null,
  stream: { type: "logs", name: "app_logs" },
  ...extra,
});

const errorsSql = (pick: FieldPick, schema: string[]) =>
  errorsAlert(scope({ schema: ["service_name", ...schema] }), {
    ...options,
    errorField: pick,
    usualPerHour: 10,
  })!.sql!;

beforeEach(() => {
  config.isEnterprise = "true";
});

afterEach(() => {
  config.isEnterprise = original;
});

describe("errorsAlert — the error predicate follows the field kind", () => {
  it("counts HTTP status codes of 500 and above as errors", () => {
    const sql = errorsSql({ name: "status_code", kind: "status_code" }, ["status_code"]);
    expect(sql).toContain(`"status_code" >= 500`);
    expect(sql).not.toContain(`'error'`);
  });

  it("matches the error levels of a level field in any case", () => {
    const sql = errorsSql({ name: "severity", kind: "level" }, ["severity"]);
    expect(sql).toContain(
      `lower("severity") IN ('error', 'fatal', 'critical', 'err', 'crit', 'alert', 'emerg', 'emergency')`,
    );
  });

  it("matches span status ERROR on traces", () => {
    const sql = errorsSql({ name: "span_status", kind: "span_status" }, ["span_status"]);
    expect(sql).toContain(`"span_status" = 'ERROR'`);
  });

  it("falls back to span status on traces when no field is picked", () => {
    const prefill = errorsAlert(
      scope({ stream: { type: "traces", name: "app_traces" }, schema: ["service_name"] }),
      { ...options, errorField: null, usualPerHour: 10 },
    );
    expect(prefill?.sql).toContain(`"span_status" = 'ERROR'`);
  });
});

describe("scope fields come from the stream schema", () => {
  it("uses the service, cluster and namespace fields the schema has", () => {
    const sql = noDataAlert(
      scope({ cluster: "c-1", namespace: "ns-1", schema: ["service", "cluster", "namespace"] }),
      options,
    )!.sql!;
    expect(sql).toContain(`"service" = 'svc-a'`);
    expect(sql).toContain(`"cluster" = 'c-1'`);
    expect(sql).toContain(`"namespace" = 'ns-1'`);
    expect(sql).not.toContain("k8s_");
  });

  it("uses a span's resource fields on traces", () => {
    const sql = noDataAlert(
      scope({
        stream: { type: "traces", name: "app_traces" },
        cluster: "c-1",
        namespace: "ns-1",
        schema: ["service_name", "service_k8s_cluster_name", "service_k8s_namespace_name"],
      }),
      options,
    )!.sql!;
    expect(sql).toContain(`"service_k8s_cluster_name" = 'c-1'`);
    expect(sql).toContain(`"service_k8s_namespace_name" = 'ns-1'`);
  });

  it("never names a field the schema lacks", () => {
    for (const build of [
      () =>
        noDataAlert(
          scope({ cluster: "c-1", namespace: "ns-1", schema: ["service_name"] }),
          options,
        ),
      () =>
        latencyAlert(scope({ cluster: "c-1", schema: ["service_name", "duration"] }), {
          ...options,
          durationField: "duration",
          p95Ms: 120,
        }),
    ]) {
      expect(build()!.sql).not.toMatch(/k8s_cluster|k8s_namespace/);
    }
  });

  it("blocks an alert on a stream with no service field", () => {
    const prefill = noDataAlert(scope({ schema: ["message"] }), options)!;
    expect(prefill.warnings.some((w) => w.level === "blocking")).toBe(true);
  });

  it("without a schema, keeps to the service and leaves out the unverified cluster field", () => {
    const prefill = noDataAlert(scope({ cluster: "c-1" }), options)!;
    expect(prefill.sql).toContain(`"service_name" = 'svc-a'`);
    expect(prefill.sql).not.toContain("c-1");
    expect(prefill.warnings.some((w) => w.level === "blocking")).toBe(false);
  });
});
