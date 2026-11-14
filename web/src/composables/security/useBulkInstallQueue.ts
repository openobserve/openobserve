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

import { computed, getCurrentScope, onScopeDispose, ref, shallowRef } from "vue";
import type { CatalogRule } from "@/services/securitySigma";
import {
  runBulkInstall,
  type BulkDeps,
  type BulkResult,
  type BulkSettings,
  type BulkTarget,
} from "@/utils/security/bulkInstall";

/** A target as stored for a later resume; the rule and schema are looked up again then. */
export interface StoredTarget {
  ruleKey: string;
  stream: string;
  sourceType: string;
}

/** The install a closed tab left unfinished, kept per org and admin in this browser for a day. */
export interface BulkInstallRecord {
  settings: BulkSettings;
  pending: StoredTarget[];
  /** Microseconds; when the record was last written. */
  savedAt: number;
}

export interface StreamInfo {
  fields: string[];
  fieldTypes: Record<string, string>;
  sourceId: string | null;
}

/** Who a record belongs to: another admin in the same browser never resumes it. */
export interface BulkRecordScope {
  org: string;
  user: string;
}

/** A record older than this is stale: rules and streams have likely changed, so it is dropped. */
export const BULK_RECORD_TTL_US = 24 * 60 * 60 * 1_000_000;

const STORAGE_PREFIX = "o2.security.bulkInstall.";
export const bulkRecordKey = ({ org, user }: BulkRecordScope) => `${STORAGE_PREFIX}${org}.${user}`;

function local(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Earlier builds kept the record per tab; it is dropped so it never resumes under the wrong admin. */
function dropTabRecord(org: string) {
  try {
    window.sessionStorage.removeItem(`${STORAGE_PREFIX}${org}`);
  } catch {
    // Blocked storage has nothing to drop.
  }
}

/** The unfinished install record for this org and admin, or null when none, expired or unreadable. */
export function readBulkRecord(
  scope: BulkRecordScope,
  nowUs: number = Date.now() * 1000,
): BulkInstallRecord | null {
  if (!scope.org || !scope.user) return null;
  dropTabRecord(scope.org);
  try {
    const store = local();
    const text = store?.getItem(bulkRecordKey(scope));
    if (!text) return null;
    const parsed = JSON.parse(text) as BulkInstallRecord;
    const valid = Array.isArray(parsed?.pending) && parsed.pending.length > 0 && !!parsed.settings;
    if (!valid || !(nowUs - Number(parsed.savedAt) < BULK_RECORD_TTL_US)) {
      store?.removeItem(bulkRecordKey(scope));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Null clears the record. */
export function writeBulkRecord(scope: BulkRecordScope, record: BulkInstallRecord | null): void {
  if (!scope.org || !scope.user) return;
  try {
    const store = local();
    if (record?.pending.length) store?.setItem(bulkRecordKey(scope), JSON.stringify(record));
    else store?.removeItem(bulkRecordKey(scope));
  } catch {
    // Private windows and blocked storage refuse writes; the install itself still runs.
  }
}

const storedOf = (t: BulkTarget): StoredTarget => ({
  ruleKey: t.rule.key,
  stream: t.stream,
  sourceType: t.sourceType,
});

/** Rebuilds stored targets against the current catalog and streams; ones that no longer exist are dropped. */
export function restoreTargets(
  pending: StoredTarget[],
  catalog: CatalogRule[],
  streams: Map<string, StreamInfo>,
): BulkTarget[] {
  const rules = new Map(catalog.map((r) => [r.key, r]));
  return pending.flatMap((p) => {
    const rule = rules.get(p.ruleKey);
    const info = streams.get(p.stream);
    if (!rule || !info) return [];
    return [
      {
        rule,
        stream: p.stream,
        sourceType: info.sourceId ?? p.sourceType,
        fields: info.fields,
        fieldTypes: info.fieldTypes,
      },
    ];
  });
}

/** Runs a bulk install with live counts, a tab-close warning while it runs, and a resumable record. */
export function useBulkInstallQueue() {
  const phase = ref<"idle" | "running" | "done">("idle");
  const targets = shallowRef<BulkTarget[]>([]);
  const results = ref<(BulkResult | null)[]>([]);

  const counts = computed(() => {
    const settled = results.value.filter((r): r is BulkResult => !!r);
    return {
      installed: settled.filter((r) => r.status === "installed").length,
      skipped: settled.filter((r) => r.status === "skipped").length,
      failed: settled.filter((r) => r.status === "failed").length,
      pending: results.value.length - settled.length,
      total: results.value.length,
    };
  });

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    // Older browsers only prompt when returnValue is set.
    e.returnValue = "";
  };
  let guarded = false;
  function guard(on: boolean) {
    if (on === guarded || typeof window === "undefined") return;
    guarded = on;
    if (on) window.addEventListener("beforeunload", onBeforeUnload);
    else window.removeEventListener("beforeunload", onBeforeUnload);
  }
  if (getCurrentScope()) onScopeDispose(() => guard(false));

  function persist(scope: BulkRecordScope, settings: BulkSettings) {
    writeBulkRecord(scope, {
      settings,
      pending: targets.value.filter((_, i) => !results.value[i]).map(storedOf),
      savedAt: Date.now() * 1000,
    });
  }

  /** Settles every target before it resolves; the record is cleared only then. */
  async function start(
    scope: BulkRecordScope,
    batch: BulkTarget[],
    settings: BulkSettings,
    deps: BulkDeps,
  ): Promise<BulkResult[]> {
    targets.value = batch;
    results.value = batch.map(() => null);
    phase.value = "running";
    persist(scope, settings);
    guard(true);
    try {
      const done = await runBulkInstall(batch, settings, deps, (result, i) => {
        results.value[i] = result;
        persist(scope, settings);
      });
      results.value = done;
      writeBulkRecord(scope, null);
      return done;
    } finally {
      guard(false);
      phase.value = "done";
    }
  }

  /** Marks every target failed without running, e.g. when the folder could not be resolved. */
  function failAll(batch: BulkTarget[], toResult: (t: BulkTarget) => BulkResult) {
    targets.value = batch;
    results.value = batch.map(toResult);
    phase.value = "done";
  }

  function reset() {
    phase.value = "idle";
    targets.value = [];
    results.value = [];
  }

  return { phase, targets, results, counts, start, failAll, reset };
}
