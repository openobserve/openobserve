// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";

import type { CatalogRule, SigmaCompileResponse } from "@/services/securitySigma";
import { raw } from "@/types/i18n";

import { runBulkInstall, type BulkDeps, type BulkTarget } from "./bulkInstall";
import { buildDetectionAlert } from "./detection";

const rule = (key: string, extra: Partial<CatalogRule> = {}): CatalogRule => ({
  key,
  id: key,
  title: `Rule ${key}`,
  description: "d",
  status: "stable",
  author: null,
  date: null,
  modified: null,
  level: "high",
  tags: [],
  techniques: ["T1078"],
  tactics: ["initial-access"],
  falsepositives: [],
  references: [],
  logsource: { product: "github", service: "audit" },
  logsourceLabel: "product=github service=audit",
  correlation: false,
  timespanMinutes: null,
  yaml: `title: Rule ${key}`,
  sources: ["github_audit"],
  ...extra,
});

const target = (r: CatalogRule, stream = "gh"): BulkTarget => ({
  rule: r,
  stream,
  sourceType: "github_audit",
  fields: ["action", "actor"],
  fieldTypes: { action: "Utf8" },
});

const compiled = (runnable = true, extra: Partial<SigmaCompileResponse> = {}) =>
  ({
    rule: null,
    compiled: {
      where: "\"action\" = 'git.clone'",
      runnable,
      unsupported: [],
      assumedAbsent: [],
      fields: ["action"],
      reason: runnable ? undefined : "missing column actor_ip",
      sql: 'SELECT * FROM "gh" WHERE "action" = \'git.clone\'',
    },
    correlation: null,
    applies: true,
    ocsfBridge: null,
    applicable: [],
    parseError: null,
    ...extra,
  }) as SigmaCompileResponse;

function deps(over: Partial<BulkDeps> = {}): BulkDeps {
  return {
    compile: vi.fn(async () => compiled()),
    validate: vi.fn(async () => null),
    create: vi.fn(async () => undefined),
    takenNames: new Set(),
    failureReason: (e) => raw(String((e as Error).message)),
    messages: { duplicate: (name) => raw(`taken ${name}`), correlationBlocked: raw("blocked") },
    ...over,
  };
}

const settings = {
  period: 30,
  frequency: 10,
  silence: 60,
  destinations: ["slack"],
  folderId: "f1",
};

describe("runBulkInstall", () => {
  it("waits for each stream's schema so every compile carries its field types", async () => {
    const k8s = (r: CatalogRule): BulkTarget => ({
      ...target(r, "k8s_audit"),
      fields: [],
      fieldTypes: {},
    });
    let release!: () => void;
    const late = new Promise<void>((resolve) => (release = resolve));
    const loadSchema = vi.fn(async () => {
      await late;
      return {
        fields: ["verb", "requestobject_spec_hostpid"],
        fieldTypes: { verb: "Utf8", requestobject_spec_hostpid: "Utf8View" },
      };
    });
    const d = deps({ loadSchema });
    const run = runBulkInstall([k8s(rule("a")), k8s(rule("b"))], settings, d);
    await Promise.resolve();
    expect(d.compile).not.toHaveBeenCalled();
    release();
    await run;
    expect(loadSchema).toHaveBeenCalledTimes(1);
    expect(d.compile).toHaveBeenCalledTimes(2);
    for (const [body] of vi.mocked(d.compile).mock.calls) {
      expect(body.fields).toEqual(["verb", "requestobject_spec_hostpid"]);
      expect(body.field_types).toMatchObject({ requestobject_spec_hostpid: "Utf8View" });
    }
  });

  it("compiles on the page's copy of the schema when the load fails", async () => {
    const d = deps({ loadSchema: vi.fn(async () => Promise.reject(new Error("down"))) });
    const [result] = await runBulkInstall([target(rule("a"))], settings, d);
    expect(result.status).toBe("installed");
    expect(d.compile).toHaveBeenCalledWith(
      expect.objectContaining({ fields: ["action", "actor"], field_types: { action: "Utf8" } }),
    );
  });

  it("creates the columns a rule reads before its first event, then validates", async () => {
    const unseen = [{ name: "eventtype", type: "Utf8" }];
    const res = compiled();
    res.compiled!.unseenFields = unseen;
    const order: string[] = [];
    const d = deps({
      compile: vi.fn(async () => res),
      addColumns: vi.fn(async () => void order.push("add")),
      validate: vi.fn(async () => (order.push("validate"), null)),
    });
    const [result] = await runBulkInstall([target(rule("a"))], settings, d);
    expect(result.status).toBe("installed");
    expect(d.addColumns).toHaveBeenCalledWith("gh", unseen);
    expect(order).toEqual(["add", "validate"]);
  });

  it("creates exactly what the dialog builder produces, in the chosen folder", async () => {
    const d = deps();
    const results = await runBulkInstall([target(rule("a"))], settings, d);
    expect(results[0].status).toBe("installed");
    const expected = buildDetectionAlert({
      rule: rule("a"),
      where: compiled().compiled!.where,
      fields: ["action"],
      stream: "gh",
      destinations: ["slack"],
      sourceType: "github_audit",
      period: 30,
      frequency: 10,
      silence: 60,
      sql: compiled().compiled!.sql,
    });
    expect(d.create).toHaveBeenCalledWith(expected, "f1");
    expect(d.compile).toHaveBeenCalledWith({
      rule_id: "a",
      source_type: "github_audit",
      stream: "gh",
      fields: ["action", "actor"],
      field_types: { action: "Utf8" },
    });
  });

  it("reports a rule that cannot run with the compile's reason", async () => {
    const d = deps({ compile: vi.fn(async () => compiled(false)) });
    const [result] = await runBulkInstall([target(rule("a"))], settings, d);
    expect(result.status).toBe("failed");
    expect(String(result.reason)).toBe("missing column actor_ip");
    expect(d.create).not.toHaveBeenCalled();
  });

  it("skips a name already taken, including one claimed earlier in the same batch", async () => {
    const d = deps({ takenNames: new Set(["Rule_b__gh"]) });
    const results = await runBulkInstall(
      [target(rule("a")), target(rule("b")), target(rule("a"))],
      settings,
      d,
    );
    expect(results.map((r) => r.status)).toEqual(["installed", "skipped", "skipped"]);
    expect(d.create).toHaveBeenCalledTimes(1);
  });

  it("does not save SQL that fails to plan, and frees its name", async () => {
    const d = deps({ validate: vi.fn(async () => "no such column") });
    const [result] = await runBulkInstall([target(rule("a"))], settings, d);
    expect(result).toMatchObject({ status: "failed", name: "Rule_a__gh" });
    expect(d.takenNames.has("Rule_a__gh")).toBe(false);
  });

  it("turns a server refusal into a failed row and keeps going", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("duplicate alert name"))
      .mockResolvedValue(undefined);
    const d = deps({ create, concurrency: 1 });
    const results = await runBulkInstall([target(rule("a")), target(rule("b"))], settings, d);
    expect(results.map((r) => r.status)).toEqual(["failed", "installed"]);
    expect(String(results[0].reason)).toBe("duplicate alert name");
  });

  it("installs a correlation with its own window and refuses one that cannot run", async () => {
    const corr = rule("c", { correlation: true, timespanMinutes: 10 });
    const correlation = {
      sql: "SELECT user FROM gh GROUP BY user HAVING count(*) > 5",
      where: "",
      groupColumns: ["user"],
      timespanMinutes: 10,
      runnable: true,
      reason: "",
    };
    const d = deps({ compile: vi.fn(async () => compiled(true, { correlation })) });
    const [ok] = await runBulkInstall([target(corr)], settings, d);
    expect(ok.status).toBe("installed");
    const payload = (d.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).toEqual(
      buildDetectionAlert({
        rule: corr,
        where: compiled().compiled!.where,
        fields: ["action"],
        stream: "gh",
        destinations: ["slack"],
        sourceType: "github_audit",
        period: 30,
        frequency: 10,
        silence: 60,
        correlation,
        sql: compiled().compiled!.sql,
      }),
    );
    expect(payload.query_condition.sql).toBe(correlation.sql);

    const blocked = deps({
      compile: vi.fn(async () =>
        compiled(true, { correlation: { ...correlation, runnable: false, reason: "no user" } }),
      ),
    });
    const [refused] = await runBulkInstall([target(corr)], settings, blocked);
    expect(refused.status).toBe("failed");
    expect(String(refused.reason)).toBe("no user");
  });

  it("keeps results in target order with several lanes", async () => {
    const compile = vi.fn(async (body) => {
      await new Promise((r) => setTimeout(r, body.rule_id === "a" ? 20 : 0));
      return compiled();
    });
    const results = await runBulkInstall(
      [target(rule("a")), target(rule("b")), target(rule("c"))],
      settings,
      deps({ compile }),
    );
    expect(results.map((r) => r.key)).toEqual(["a", "b", "c"]);
  });
});
