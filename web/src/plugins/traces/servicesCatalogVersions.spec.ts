import { describe, it, expect } from "vitest";
import { gt } from "@/types/i18n";
import {
  catalogFooterNote,
  envCatalogRows,
  showsEnvColumn,
  mergeCatalogVersions,
  environmentPredicate,
  catalogMatches,
  catalogVerdictRank,
  catalogPlace,
  catalogSummary,
  formatAgoUs,
  rolledBackFrom,
  rowScopes,
  chipEnv,
  healthWithheld,
  isFirstVersion,
  catalogVerdictValue,
  servingStatus,
  servingIdle,
  servingHealthSql,
  versionTrafficKey,
  catalogColumnVisibility,
  CATALOG_COLUMN_SIZES,
  catalogEnvColumn,
} from "./servicesCatalogVersions";
import type { Scope, ServicesResponse } from "@/services/service_versions";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";
const scope = (where_key: string): Scope => ({
  service: "checkout",
  scope_key: where_key,
  where_key,
  env: "prod",
  env_source: "attribute",
  signals: ["traces"],
  active_versions: ["v1"],
});
describe("catalog identity", () => {
  it("keeps two wheres for one service separate", () => {
    const scopes = [scope("east"), scope("west")];
    const rows = mergeCatalogVersions(
      [
        { service_name: "checkout", where_key: "east", error_rate: 7 },
        { service_name: "checkout", where_key: "west", error_rate: 0 },
      ],
      scopes,
    );
    expect(rows.map((row) => row.versionScope?.where_key)).toEqual(["east", "west"]);
    expect(rows.map((row) => row.error_rate)).toEqual([7, 0]);
  });
  it("does not duplicate an unscoped RED aggregate across wheres", () => {
    expect(
      mergeCatalogVersions([{ service_name: "checkout" }], [scope("east"), scope("west")])[0]
        .versionScope,
    ).toBeUndefined();
  });
  it("preserves inferred behavior", () => {
    expect(
      mergeCatalogVersions(
        [{ service_name: "checkout", where_key: "east", infer_service_name: "checkout" }],
        [scope("east")],
      )[0].versionScope,
    ).toBeUndefined();
  });
});
describe("environment filtering", () => {
  const response = (keys: string[]): ServicesResponse => ({
    services: [],
    envs: [{ env: "prod", where_keys: keys }],
  });
  it("uses resolved keys through the 200-key boundary", () => {
    const value = environmentPredicate(
      response(Array.from({ length: 200 }, (_, i) => String(i))),
      "prod",
    );
    expect(value.postfilter).toBe(false);
    expect(value.sql).toContain("o2_service_where IN");
  });
  it("switches at 201 and requires resolved postfiltering", () => {
    expect(
      environmentPredicate(response(Array.from({ length: 201 }, (_, i) => String(i))), "prod"),
    ).toEqual({ sql: "o2_service_env = 'prod'", postfilter: true });
  });
  it("fails closed for an unmatched environment", () =>
    expect(environmentPredicate(response([]), "missing").sql).toBe("1=0"));
  it("escapes SQL literals", () =>
    expect(environmentPredicate(response(["cluster'o"]), "prod").sql).toContain("'cluster''o'"));
});

describe("catalog filters and severity", () => {
  it("preserves RED rows when the registry fails or is pending", () => {
    for (const state of ["loading", "error", "locked"])
      expect(catalogMatches({}, "prod", "regressed", state, false)).toBe(true);
  });
  it("ignores the verdict filter on enrichment failure", () => {
    expect(
      catalogMatches({ versionScope: scope("east") }, "prod", "regressed", "ready", true),
    ).toBe(true);
  });
  it("does not call unknown or inferred identities no-version", () => {
    expect(catalogMatches({}, "", "no_version", "ready", false)).toBe(false);
    expect(catalogMatches({ infer_service_name: "svc" }, "", "no_version", "ready", false)).toBe(
      false,
    );
    expect(catalogMatches({ versionScope: scope("east") }, "", "no_version", "ready", false)).toBe(
      true,
    );
  });
  it("sorts worst verdict first independently from RED health", () => {
    expect(
      ["ok", "watch", "regressed", "not_serving", "insufficient"]
        .map((verdict) => ({ ...scope("east"), newest_version: "v1", newest_verdict: { verdict } }))
        .sort((a, b) => catalogVerdictRank(b as Scope) - catalogVerdictRank(a as Scope))
        .map((row) => row.newest_verdict.verdict),
    ).toEqual(["regressed", "not_serving", "watch", "insufficient", "ok"]);
  });
  it("sorts a rollback by its outcome: still worse under Regressed, recovered above OK", () => {
    const rows = [
      { verdict: "ok" },
      { verdict: "ok", rollback_outcome: "recovered" },
      { verdict: "insufficient" },
      { verdict: "regressed", rollback_outcome: "not_recovered" },
      { verdict: "not_serving" },
      { verdict: "regressed" },
    ].map((verdict) => ({ ...scope("east"), newest_version: "v1", newest_verdict: verdict }));
    expect(
      rows
        .sort((a, b) => catalogVerdictRank(b as Scope) - catalogVerdictRank(a as Scope))
        .map((row) => row.newest_verdict.rollback_outcome || row.newest_verdict.verdict),
    ).toEqual(["regressed", "not_recovered", "not_serving", "insufficient", "recovered", "ok"]);
  });
});
describe("Health of the version serving now", () => {
  // A rollback: 1.0 served, 2.0 failed for a while, 1.0 serves again.
  const rollback: Scope = {
    ...scope("k8s:stage6/web"),
    service: "rollback-api",
    newest_version: "2.0",
    previous_version: "2.0",
    current_version: "1.0",
    active_versions: ["1.0"],
  };
  const row = {
    service_name: "rollback-api",
    where_key: "k8s:stage6/web",
    status: "critical" as const,
    versionScope: rollback,
  };
  const traffic = new Map([
    [versionTrafficKey("rollback-api", "k8s:stage6/web", "1.0"), { requests: 2400, errors: 0 }],
    [versionTrafficKey("rollback-api", "k8s:stage6/web", "2.0"), { requests: 1800, errors: 525 }],
  ]);
  it("reads a recovered rollback Healthy although the whole range is Critical", () => {
    expect(servingStatus(row, traffic)).toBe("healthy");
  });
  it("reads the serving version's own errors when it is the bad one", () => {
    const bad = { ...rollback, current_version: "2.0" };
    expect(servingStatus({ ...row, status: "warning", versionScope: bad }, traffic)).toBe(
      "critical",
    );
  });
  it("keeps the whole-range health without a serving version, its traffic, or the read", () => {
    expect(servingStatus({ ...row, versionScope: undefined }, traffic)).toBe("critical");
    expect(
      servingStatus({ ...row, versionScope: { ...rollback, current_version: "3.0" } }, traffic),
    ).toBe("critical");
    expect(servingStatus(row, new Map())).toBe("critical");
  });
  it("counts only the service's own request spans per where and version", () => {
    const sql = servingHealthSql("default", "(kind)", true, false);
    expect(sql).toContain("GROUP BY o2_service_where, service_name, o2_service_version");
    expect(sql).toContain("COUNT(*) FILTER (WHERE (kind)) AS total_requests");
    expect(sql).toContain("(infer_service_name IS NULL OR infer_service_name = '')");
    expect(servingHealthSql("default", "(kind)", false, false)).not.toContain("infer_service_name");
  });
});
describe("catalog columns at 1600 px", () => {
  it("hides the latency extras and Deployed by default and lets a saved choice restore them", () => {
    expect(catalogColumnVisibility(true, {})).toEqual({
      p50_latency_ns: false,
      p99_latency_ns: false,
      avg_duration_ns: false,
      max_duration_ns: false,
      version_deployed: false,
    });
    expect(catalogColumnVisibility(true, { p99_latency_ns: true }).p99_latency_ns).toBe(true);
    expect(catalogColumnVisibility(true, { version_deployed: true }).version_deployed).toBe(true);
    expect(catalogColumnVisibility(false, {})).toEqual({});
  });
});
describe("catalog Env and Version cells at 1600 px", () => {
  it("drops the env word with Env = All envs and keeps it once one env is picked", () => {
    expect(catalogEnvColumn("")).toEqual({ size: 130, hideKey: true });
    expect(catalogEnvColumn("prod")).toEqual({ size: 157, hideKey: false });
  });
  it("narrows Version so a rebuilt version cuts only its version text", () => {
    expect(CATALOG_COLUMN_SIZES.service_versions).toBe(179);
    expect(CATALOG_COLUMN_SIZES.version_verdict).toBeGreaterThanOrEqual(169);
    expect(CATALOG_COLUMN_SIZES.status).toBeGreaterThanOrEqual(98);
  });
});
describe("a scope seen in more than one env", () => {
  // A real producer scope pinned to prod and also seen in staging.
  const twoEnvs = () => structuredClone(producer.two_env.services.services[0]) as Scope;
  it("matches the Env filter for every env in its set", () => {
    expect(catalogMatches({ versionScope: twoEnvs() }, "staging", "", "ready", false)).toBe(true);
    expect(catalogMatches({ versionScope: twoEnvs() }, "prod", "", "ready", false)).toBe(true);
    expect(catalogMatches({ versionScope: twoEnvs() }, "dev", "", "ready", false)).toBe(false);
  });
  it("counts the scope under each env in its set", () => {
    const response: ServicesResponse = { services: [twoEnvs(), scope("west")], envs: [] };
    expect(catalogSummary(response, "staging").total).toBe(1);
    expect(catalogSummary(response, "prod").total).toBe(2);
  });
  it("falls back to the one env when the response has no set", () => {
    expect(catalogMatches({ versionScope: scope("east") }, "prod", "", "ready", false)).toBe(true);
    expect(catalogMatches({ versionScope: scope("east") }, "staging", "", "ready", false)).toBe(
      false,
    );
  });
});
describe("catalog presentation", () => {
  const t = (key: string, params?: object) => `${key}${params ? JSON.stringify(params) : ""}`;
  it("ranks versions without a verdict above no-version rows", () => {
    expect(catalogVerdictRank(scope("east"))).toBe(0);
    expect(
      catalogVerdictRank({ ...scope("east"), newest_version: "v2", previous_version: "v1" }),
    ).toBe(1);
  });
  it("counts severities per env and no-version scopes", () => {
    const response: ServicesResponse = {
      services: [
        {
          ...scope("east"),
          newest_version: "v1",
          newest_verdict: { verdict: "regressed" } as never,
        },
        {
          ...scope("west"),
          env: "dev",
          newest_version: "v1",
          newest_verdict: { verdict: "ok" } as never,
        },
        scope("north"),
      ],
      envs: [],
      verdict_counts: { regressed: 5 },
    };
    expect(catalogSummary(response, "").counts.regressed).toBe(5);
    const prod = catalogSummary(response, "prod");
    expect(prod).toMatchObject({ total: 2, noVersion: 1, launchDay: false });
    expect(prod.counts).toEqual({ regressed: 1, no_version: 1 });
  });
  it("labels k8s, cluster-less and flat places", () => {
    expect(catalogPlace("k8s:c1/web")).toEqual({ cluster: "c1", namespace: "web" });
    expect(catalogPlace("k8s:/otel-demo")).toEqual({ cluster: "", namespace: "otel-demo" });
    expect(catalogPlace("env:prod")).toEqual({ cluster: "", namespace: "prod", flat: true });
  });
  it("detects a rollback only when the serving version left the newest one", () => {
    const base = { ...scope("east"), newest_version: "v2", previous_version: "v2" };
    expect(rolledBackFrom({ ...base, current_version: "v1" })).toBe("v2");
    expect(rolledBackFrom({ ...base, current_version: "v2" })).toBe("");
  });
  it("formats relative deploy times", () => {
    const now = 1_000_000_000_000;
    expect(formatAgoUs((now - 30_000) * 1000, t as never, now)).toContain("secondsAgo");
    expect(formatAgoUs((now - 600_000) * 1000, t as never, now)).toBe(
      'serviceVersions.catalog.minutesAgo{"count":10}',
    );
    expect(formatAgoUs((now - 2 * 86_400_000) * 1000, t as never, now)).toContain("daysAgo");
  });
});

describe("page summaries under the Env filter (real producer two-env scope)", () => {
  const twoEnvs = () => structuredClone(producer.two_env.services.services[0]) as Scope;
  const pinnedProd = () =>
    ({ ...twoEnvs(), service: "prod-only", scope_key: "p", env: "prod", envs: ["prod"] }) as Scope;
  const row = (scope: Scope) => ({ service_name: scope.service, where_key: scope.where_key });
  it("keeps the launch-day notice the same whichever env is picked", () => {
    const preExisting = { ...twoEnvs(), newest_version: "1.0" } as Scope;
    preExisting.newest_verdict = { verdict: "insufficient", state: "pre_existing" } as never;
    const regressed = { ...pinnedProd(), newest_version: "2.0" } as Scope;
    regressed.newest_verdict = { verdict: "regressed", state: "frozen" } as never;
    const response: ServicesResponse = { services: [preExisting, regressed], envs: [] };
    expect(catalogSummary(response, "").launchDay).toBe(false);
    expect(catalogSummary(response, "staging").launchDay).toBe(false);
    const launch: ServicesResponse = { services: [preExisting], envs: [] };
    expect(catalogSummary(launch, "").launchDay).toBe(true);
    expect(catalogSummary(launch, "staging").launchDay).toBe(true);
  });
  it("counts only the rows inside the picked env", () => {
    const scopes = [twoEnvs(), pinnedProd()];
    const rows = scopes.map(row);
    expect(
      envCatalogRows(rows, scopes, "staging", "ready", false).map((r) => r.service_name),
    ).toEqual([twoEnvs().service]);
    expect(envCatalogRows(rows, scopes, "", "ready", false)).toHaveLength(2);
    expect(envCatalogRows(rows, scopes, "staging", "loading", false)).toHaveLength(2);
  });
  it("shows the Env column when a row matched the pick through an env it is not pinned to", () => {
    expect(showsEnvColumn([twoEnvs()], "")).toBe(true);
    expect(showsEnvColumn([twoEnvs()], "staging")).toBe(true);
    expect(showsEnvColumn([twoEnvs(), pinnedProd()], "prod")).toBe(false);
  });
});

describe("catalog rows a real producer scope feeds", () => {
  // The producer sends a scope's first version with no verdict row and no previous version.
  const first = () => structuredClone(producer.two_env.services.services[0]) as Scope;
  it("calls a lone version with no verdict First version, ranked and filtered like the drawer", () => {
    expect(isFirstVersion(first())).toBe(true);
    expect(catalogVerdictValue(first())).toBe("first_version");
    expect(catalogVerdictRank(first())).toBe(2);
    expect(isFirstVersion({ ...first(), previous_version: "1.0.0" })).toBe(false);
    expect(catalogVerdictValue({ ...first(), previous_version: "1.0.0" })).toBeUndefined();
    const judging = { ...first(), previous_version: "1.0.0", tracking_started: true };
    expect(catalogVerdictValue(judging)).toBe("insufficient");
  });
  it("counts chips from the scopes the table shows, never the org-wide verdict_counts", () => {
    const regressed = {
      ...first(),
      service: "elsewhere",
      scope_key: "elsewhere",
      newest_verdict: { verdict: "regressed" },
    } as Scope;
    const response: ServicesResponse = {
      services: [first(), regressed, scope("north")],
      envs: [],
      verdict_counts: { regressed: 1 },
    };
    const shown = rowScopes([{ versionScope: first() }, { versionScope: first() }, {}]);
    const summary = catalogSummary(response, "", shown);
    expect(summary.total).toBe(1);
    expect(summary.counts).toEqual({ first_version: 1 });
    expect(summary.noVersion).toBe(0);
  });
  it("shows the env that matched the filter on the chip, else the pinned env", () => {
    expect(chipEnv(first(), "staging")).toBe("staging");
    expect(chipEnv(first(), "")).toBe("prod");
    expect(chipEnv(first(), "dev")).toBe("prod");
  });
  it("withholds Health for a version that is not serving and for a row with no requests", () => {
    const shownVersion = first().current_version || first().newest_version;
    const notServing = {
      ...first(),
      newest_verdict: { verdict: "not_serving", version: shownVersion },
    } as Scope;
    expect(healthWithheld({ total_requests: 900, versionScope: notServing })).toBe(true);
    expect(healthWithheld({ total_requests: 0, versionScope: first() })).toBe(true);
    expect(healthWithheld({ total_requests: 900, versionScope: first() })).toBe(false);
    expect(healthWithheld({ total_requests: 900 })).toBe(false);
  });
  it("keeps the serving version's Health when the Not serving verdict belongs to another version", () => {
    const mixed = {
      ...scope("east"),
      newest_version: "2.0",
      current_version: "1.0",
      active_versions: ["2.0", "1.0"],
      newest_verdict: { verdict: "not_serving", version: "2.0" },
    } as Scope;
    expect(healthWithheld({ total_requests: 900, versionScope: mixed })).toBe(false);
    const shownIsIdle = { ...mixed, current_version: "2.0" } as Scope;
    expect(healthWithheld({ total_requests: 900, versionScope: shownIsIdle })).toBe(true);
  });
});

describe("catalogFooterNote", () => {
  const view = { env: "", byVerdict: true, locale: "en-US" };
  const launch = { counts: {}, total: 2, noVersion: 0, launchDay: true };
  it("lists every verdict state the sort orders, rollbacks, First version and Pre-existing included", () => {
    expect(catalogFooterNote({ ...launch, launchDay: false }, view, gt)).toBe(
      "Sorted by deploy verdict: Regressed, Rolled back · still worse, Not serving, Possible regression, Not enough data, Rolled back · recovered, OK, First version, Pre-existing, No version",
    );
  });
  it("stays silent while the launch-day or warm-up banner explains the missing verdicts", () => {
    expect(catalogFooterNote(launch, view, gt)).toBe("");
    expect(catalogFooterNote(launch, { ...view, byVerdict: false }, gt)).toBe("");
  });
  it("leaves the No version count to the notice above the table, beside the pager", () => {
    expect(
      catalogFooterNote(
        { counts: {}, total: 1, noVersion: 1, launchDay: false },
        { ...view, verdict: "no_version", env: "prod" },
        gt,
      ),
    ).toBe("");
  });
});
describe("a deploy recorded after tracking started but not judged yet", () => {
  const unjudged = (): Scope =>
    ({
      ...scope("east"),
      newest_version: "2.0",
      current_version: "2.0",
      previous_version: "1.0",
      tracking_started: true,
    }) as Scope;
  it("reads Not enough data, never First version, and sorts and filters as one", () => {
    expect(isFirstVersion(unjudged())).toBe(false);
    expect(catalogVerdictValue(unjudged())).toBe("insufficient");
    expect(catalogVerdictRank(unjudged())).toBe(4);
    expect(catalogMatches({ versionScope: unjudged() }, "", "insufficient", "ready", false)).toBe(
      true,
    );
  });
  it("leaves a scope tracking has not reached to the warm-up state", () => {
    expect(catalogVerdictValue({ ...unjudged(), tracking_started: false } as Scope)).toBe(
      undefined,
    );
  });
});
describe("one classification for the verdict chip and the verdict filter", () => {
  const beta = (): Scope =>
    ({
      ...scope("east"),
      newest_version: "2.4.0",
      newest_verdict: {
        verdict: "insufficient",
        reason_code: "no_previous_version",
        state: "evaluating",
        version: "2.4.0",
      },
    }) as Scope;
  it("files a first version's stored Not enough data verdict under First version, as its chip reads", () => {
    expect(catalogVerdictValue(beta())).toBe("first_version");
    expect(catalogSummary({ services: [beta()], envs: [] }, "", [beta()]).counts).toEqual({
      first_version: 1,
    });
    expect(catalogMatches({ versionScope: beta() }, "", "first_version", "ready", false)).toBe(
      true,
    );
    expect(catalogMatches({ versionScope: beta() }, "", "insufficient", "ready", false)).toBe(
      false,
    );
  });
  it("keeps Not enough data for a compare against a picked baseline", () => {
    const picked = beta();
    picked.newest_verdict!.baseline = { version: "2.3.0", rule: "picked" };
    expect(catalogVerdictValue(picked)).toBe("insufficient");
  });
});
describe("a scope deploy tracking has not reached yet", () => {
  const untracked = (): Scope =>
    ({ ...scope("east"), newest_version: "2.0", tracking_started: false }) as Scope;
  it("is never First version and takes no verdict filter value or count", () => {
    expect(isFirstVersion(untracked())).toBe(false);
    expect(catalogVerdictValue(untracked())).toBeUndefined();
    expect(catalogVerdictRank(untracked())).toBe(1);
    const response: ServicesResponse = { services: [untracked()], envs: [] };
    expect(catalogSummary(response, "").counts).toEqual({});
  });
  it("is still First version once the processor has reached it", () => {
    expect(isFirstVersion({ ...untracked(), tracking_started: true } as Scope)).toBe(true);
  });
  it("turns the launch notice on only when no versioned scope is tracked", () => {
    const tracked = { ...scope("west"), newest_version: "1.0" };
    const none: ServicesResponse = { services: [untracked()], envs: [] };
    expect(catalogSummary(none, "")).toMatchObject({ launchDay: true, preTracking: true });
    const mixed: ServicesResponse = { services: [untracked(), tracked], envs: [] };
    expect(catalogSummary(mixed, "")).toMatchObject({ launchDay: false, preTracking: false });
  });
});
describe("Health when the shown version sent nothing in the window", () => {
  const row = (current: string) => ({
    service_name: "orders",
    where_key: "east",
    total_requests: 900,
    versionScope: { ...scope("east"), newest_version: "3.0", current_version: current },
  });
  const traffic = new Map([
    [versionTrafficKey("orders", "east", "1.0"), { requests: 900, errors: 0 }],
  ]);
  it("withholds Health from a complete read with no requests for the shown version", () => {
    expect(servingIdle(row("3.0"), traffic, true)).toBe(true);
    expect(healthWithheld({ ...row("3.0"), servingIdle: true })).toBe(true);
  });
  it("keeps Health when the shown version served, or when the read was incomplete", () => {
    expect(servingIdle(row("1.0"), traffic, true)).toBe(false);
    expect(servingIdle(row("3.0"), traffic, false)).toBe(false);
  });
  it("keeps Health for a version known only from browser data", () => {
    const rum = row("3.0");
    rum.versionScope.signals = ["rum"];
    expect(servingIdle(rum, traffic, true)).toBe(false);
  });
});
describe("Health of one build beside another build of the same version text", () => {
  const builds = {
    ...scope("east"),
    newest_version: "2.4.0",
    current_version: "2.4.0",
    current_image: "8ebf1f7",
    newest_image: "8ebf1f7",
    active_versions: ["2.4.0"],
    signals: ["traces"],
    newest_verdict: { verdict: "not_serving", version: "2.4.0", image: "1f08369" },
  } as Scope;
  const row = {
    service_name: "orders",
    where_key: "east",
    total_requests: 900,
    status: "critical" as const,
    versionScope: builds,
  };
  const traffic = new Map([
    [versionTrafficKey("orders", "east", "2.4.0", "8ebf1f7"), { requests: 1000, errors: 0 }],
    [versionTrafficKey("orders", "east", "2.4.0", "1f08369"), { requests: 400, errors: 300 }],
  ]);
  it("keeps the serving build's Health when the Not serving verdict is the stopped build's", () => {
    expect(healthWithheld(row)).toBe(false);
    const stopped = { ...builds, newest_verdict: { ...builds.newest_verdict!, image: "8ebf1f7" } };
    expect(healthWithheld({ ...row, versionScope: stopped })).toBe(true);
  });
  it("reads the serving build's own errors, not the stopped build's", () => {
    expect(servingStatus(row, traffic)).toBe("healthy");
    expect(servingIdle(row, traffic, true)).toBe(false);
    const idle = new Map([[...traffic][1]]);
    expect(servingIdle(row, idle, true)).toBe(true);
  });
  it("groups the Health read by build, and reads streams without the image field as imageless", () => {
    const sql = servingHealthSql("default", "(kind)", true, true);
    expect(sql).toContain("NULLIF(o2_service_image, '') AS image");
    expect(sql).toContain(
      "GROUP BY o2_service_where, service_name, o2_service_version, NULLIF(o2_service_image, '')",
    );
    const plain = servingHealthSql("default", "(kind)", true, false);
    expect(plain).toContain("CAST(NULL AS VARCHAR) AS image");
    expect(plain).not.toContain("o2_service_image");
    expect(versionTrafficKey("orders", "east", "2.4.0", "")).toBe(
      versionTrafficKey("orders", "east", "2.4.0", null),
    );
  });
});
