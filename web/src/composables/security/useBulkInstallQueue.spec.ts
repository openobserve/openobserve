// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";

import type { CatalogRule, SigmaCompileResponse } from "@/services/securitySigma";
import { raw } from "@/types/i18n";
import type { BulkDeps, BulkTarget } from "@/utils/security/bulkInstall";

import {
  BULK_RECORD_TTL_US,
  bulkRecordKey,
  readBulkRecord,
  restoreTargets,
  useBulkInstallQueue,
  writeBulkRecord,
} from "./useBulkInstallQueue";

const ORG = { org: "acme", user: "admin@acme.io" };

const rule = (key: string): CatalogRule =>
  ({
    key,
    id: key,
    title: `Rule ${key}`,
    level: "high",
    techniques: [],
    tactics: [],
    logsource: { product: "github", service: "audit" },
    logsourceLabel: "product=github service=audit",
    correlation: false,
    sources: ["github_audit"],
    yaml: `title: Rule ${key}`,
  }) as unknown as CatalogRule;

const target = (key: string, stream = "gh"): BulkTarget => ({
  rule: rule(key),
  stream,
  sourceType: "github_audit",
  fields: ["action"],
  fieldTypes: { action: "Utf8" },
});

const compiled = (runnable: boolean) =>
  ({
    rule: null,
    compiled: {
      where: "\"action\" = 'x'",
      runnable,
      unsupported: [],
      assumedAbsent: [],
      fields: ["action"],
      reason: runnable ? undefined : "missing column",
      sql: 'SELECT * FROM "gh" WHERE "action" = \'x\'',
    },
    correlation: null,
    applies: true,
    ocsfBridge: null,
    applicable: [],
    parseError: null,
  }) as SigmaCompileResponse;

const settings = { period: 30, frequency: 10, silence: 60, destinations: [], folderId: "f1" };

/** Each create waits for its own release, so a test decides when every install settles. */
function gatedDeps(runnableKeys: Set<string>) {
  const gates = new Map<string, () => void>();
  const deps: BulkDeps = {
    compile: vi.fn(async (body) => compiled(runnableKeys.has(body.rule_id ?? ""))),
    validate: vi.fn(async () => null),
    create: vi.fn(
      (payload: Record<string, any>) =>
        new Promise<void>((resolve) => gates.set(String(payload.name), resolve)),
    ),
    takenNames: new Set(),
    failureReason: (e) => raw(String((e as Error).message)),
    messages: { duplicate: (n) => raw(`taken ${n}`), correlationBlocked: raw("blocked") },
    concurrency: 4,
  };
  return { deps, gates };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("useBulkInstallQueue", () => {
  it("counts installed, failed and pending live and settles only when every target has", async () => {
    const scope = effectScope();
    const queue = scope.run(() => useBulkInstallQueue())!;
    const { deps, gates } = gatedDeps(new Set(["a", "b"]));
    const run = queue.start(ORG, [target("a"), target("b"), target("c")], settings, deps);
    await flush();

    expect(queue.phase.value).toBe("running");
    expect(queue.counts.value).toMatchObject({ installed: 0, failed: 1, pending: 2, total: 3 });

    [...gates.values()][0]();
    await flush();
    expect(queue.counts.value).toMatchObject({ installed: 1, failed: 1, pending: 1 });
    expect(queue.phase.value).toBe("running");

    [...gates.values()][1]();
    const done = await run;
    expect(done.map((r) => r.status)).toEqual(["installed", "installed", "failed"]);
    expect(queue.phase.value).toBe("done");
    expect(queue.counts.value).toMatchObject({ installed: 2, failed: 1, pending: 0 });
    scope.stop();
  });

  it("keeps a record of the unsettled targets while running and clears it at the end", async () => {
    const scope = effectScope();
    const queue = scope.run(() => useBulkInstallQueue())!;
    const { deps, gates } = gatedDeps(new Set(["a", "b"]));
    const run = queue.start(ORG, [target("a"), target("b")], settings, deps);
    await flush();

    expect(readBulkRecord(ORG)?.pending.map((p) => p.ruleKey)).toEqual(["a", "b"]);
    expect(readBulkRecord(ORG)?.settings).toEqual(settings);
    gates.get([...gates.keys()][0])!();
    await flush();
    expect(readBulkRecord(ORG)?.pending).toHaveLength(1);

    gates.get([...gates.keys()][1])!();
    await run;
    expect(readBulkRecord(ORG)).toBeNull();
    scope.stop();
  });

  it("warns before the tab closes only while installs are pending", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const scope = effectScope();
    const queue = scope.run(() => useBulkInstallQueue())!;
    const { deps, gates } = gatedDeps(new Set(["a"]));
    const run = queue.start(ORG, [target("a")], settings, deps);
    await flush();

    const handler = add.mock.calls.find(([type]) => type === "beforeunload")?.[1] as (
      e: Event,
    ) => void;
    expect(handler).toBeTypeOf("function");
    const event = new Event("beforeunload", { cancelable: true });
    handler(event);
    expect(event.defaultPrevented).toBe(true);

    [...gates.values()][0]();
    await run;
    expect(remove).toHaveBeenCalledWith("beforeunload", handler);
    scope.stop();
  });

  it("drops the tab-close warning when its component unmounts mid-run", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const scope = effectScope();
    const queue = scope.run(() => useBulkInstallQueue())!;
    const { deps } = gatedDeps(new Set(["a"]));
    void queue.start(ORG, [target("a")], settings, deps);
    await flush();
    scope.stop();
    expect(remove).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });
});

describe("resume record", () => {
  it("is scoped to the org and survives unreadable storage", () => {
    writeBulkRecord(ORG, {
      settings,
      pending: [{ ruleKey: "a", stream: "gh", sourceType: "github_audit" }],
      savedAt: Date.now() * 1000,
    });
    expect(readBulkRecord(ORG)?.pending).toHaveLength(1);
    expect(readBulkRecord({ ...ORG, org: "other" })).toBeNull();
    expect(readBulkRecord({ ...ORG, user: "someone@acme.io" })).toBeNull();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readBulkRecord(ORG)).toBeNull();
  });

  it("rebuilds pending targets from the current catalog and drops ones that are gone", () => {
    const restored = restoreTargets(
      [
        { ruleKey: "a", stream: "gh", sourceType: "github_audit" },
        { ruleKey: "gone", stream: "gh", sourceType: "github_audit" },
        { ruleKey: "a", stream: "deleted_stream", sourceType: "github_audit" },
      ],
      [rule("a")],
      new Map([["gh", { fields: ["action", "actor"], fieldTypes: {}, sourceId: "github_audit" }]]),
    );
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ stream: "gh", fields: ["action", "actor"] });
    expect(restored[0].rule.key).toBe("a");
  });

  it("resumes only the pending targets with the saved settings", async () => {
    const scope = effectScope();
    const queue = scope.run(() => useBulkInstallQueue())!;
    writeBulkRecord(ORG, {
      settings,
      pending: [{ ruleKey: "b", stream: "gh", sourceType: "github_audit" }],
      savedAt: Date.now() * 1000,
    });
    const record = readBulkRecord(ORG)!;
    const targets = restoreTargets(
      record.pending,
      [rule("a"), rule("b")],
      new Map([["gh", { fields: ["action"], fieldTypes: {}, sourceId: "github_audit" }]]),
    );
    const { deps, gates } = gatedDeps(new Set(["b"]));
    const run = queue.start(ORG, targets, record.settings, deps);
    await flush();
    expect(deps.compile).toHaveBeenCalledTimes(1);
    expect(deps.compile).toHaveBeenCalledWith(expect.objectContaining({ rule_id: "b" }));
    [...gates.values()][0]();
    await run;
    expect(readBulkRecord(ORG)).toBeNull();
    scope.stop();
  });

  it("lives in localStorage, so it survives a closed tab, and expires after a day", () => {
    const savedAt = 1_000_000_000_000_000;
    writeBulkRecord(ORG, {
      settings,
      pending: [{ ruleKey: "a", stream: "gh", sourceType: "github_audit" }],
      savedAt,
    });
    expect(window.localStorage.getItem(bulkRecordKey(ORG))).not.toBeNull();
    expect(window.sessionStorage.getItem(bulkRecordKey(ORG))).toBeNull();
    expect(readBulkRecord(ORG, savedAt + BULK_RECORD_TTL_US - 1)?.pending).toHaveLength(1);
    expect(readBulkRecord(ORG, savedAt + BULK_RECORD_TTL_US)).toBeNull();
    expect(window.localStorage.getItem(bulkRecordKey(ORG))).toBeNull();
  });

  it("drops the per-tab record earlier builds kept, so it never resumes under another admin", () => {
    window.sessionStorage.setItem(
      "o2.security.bulkInstall.acme",
      JSON.stringify({ settings, pending: [{ ruleKey: "a" }], savedAt: Date.now() * 1000 }),
    );
    expect(readBulkRecord(ORG)).toBeNull();
    expect(window.sessionStorage.getItem("o2.security.bulkInstall.acme")).toBeNull();
  });

  it("is not written or read without a signed-in user", () => {
    const anon = { org: "acme", user: "" };
    writeBulkRecord(anon, {
      settings,
      pending: [{ ruleKey: "a", stream: "gh", sourceType: "github_audit" }],
      savedAt: Date.now() * 1000,
    });
    expect(window.localStorage.length).toBe(0);
    expect(readBulkRecord(anon)).toBeNull();
  });
});
