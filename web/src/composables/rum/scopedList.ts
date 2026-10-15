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

import { computed, ref, type Ref } from "vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { I18nText } from "@/types/i18n";
import { rumPaError } from "@/utils/rum/rumPaApiError";

export type ScopedListPermission = "write" | "read" | "none";
export type ScopedListStatus = "loading" | "ready" | "failed" | "forbidden";

export type ScopedListSource<T> = {
  list: (org: string, app: string) => Promise<{ data?: { list?: unknown } }>;
  parse: (row: unknown, app: string) => T | null;
  loadFailed: () => I18nText;
};

export type ScopedList<T> = {
  items: Ref<T[]>;
  permission: Ref<ScopedListPermission>;
  invalidCount: Ref<number>;
  loading: Ref<boolean>;
  loadedAt: Ref<number | null>;
  reset: () => void;
  deny: (org: string, app: string) => void;
  load: (org: string, app: string, force?: boolean, quiet?: boolean) => Promise<boolean>;
  status: (org: string, app: string) => ScopedListStatus;
  ensure: (
    org: string,
    app: string,
    retryFailed?: boolean,
    quiet?: boolean,
  ) => Promise<ScopedListStatus>;
};

/** One app's rows from a RUM Product Analytics list endpoint, with load dedup, superseding and the four-state readiness model. */
export function createScopedList<T extends { name: string }>(
  source: ScopedListSource<T>,
): ScopedList<T> {
  const items = ref([]) as Ref<T[]>;
  // Roles differ per org and app, so a refusal is remembered only for the target it came from.
  const permissions = ref(new Map<string, ScopedListPermission>());
  const shown = ref<string | null>(null);
  const permission = computed<ScopedListPermission>({
    get: () => (shown.value ? permissions.value.get(shown.value) : undefined) ?? "write",
    set: (v) => {
      if (shown.value) permissions.value.set(shown.value, v);
    },
  });
  const invalidCount = ref(0);
  const loading = ref(false);
  const loadedAt = ref<number | null>(null);
  const loadedFor = ref<string | null>(null);
  const failedFor = ref<string | null>(null);
  let inflight: { target: string; run: Promise<void> } | null = null;
  let loadSeq = 0;

  const reset = () => {
    items.value = [];
    permissions.value.clear();
    shown.value = null;
    invalidCount.value = 0;
    loading.value = false;
    loadedAt.value = null;
    loadedFor.value = null;
    failedFor.value = null;
    inflight = null;
    loadSeq++;
  };

  // A failed reload keeps the last list on screen, but its absences can no longer be trusted.
  const current = (target: string): boolean =>
    loadedFor.value === target && failedFor.value !== target;

  const land = (target: string, rows: unknown, app: string) => {
    const list = Array.isArray(rows) ? rows : [];
    const found = list.map((r) => source.parse(r, app)).filter((x): x is T => !!x);
    items.value = found.sort((a, b) => a.name.localeCompare(b.name));
    invalidCount.value = list.length - found.length;
    if (permissions.value.get(target) === "none") permissions.value.delete(target);
    loadedFor.value = target;
    loadedAt.value = Date.now();
  };

  const fail = (target: string, e: unknown, quiet: boolean) => {
    if (rumPaError(e).status === 403) {
      permissions.value.set(target, "none");
      items.value = [];
      invalidCount.value = 0;
      loadedFor.value = target;
      loadedAt.value = Date.now();
      return;
    }
    // Another app's rows must not stand in for this one's after a failed switch.
    if (loadedFor.value !== target) {
      items.value = [];
      invalidCount.value = 0;
      loadedFor.value = null;
      loadedAt.value = null;
    }
    failedFor.value = target;
    if (!quiet) toast({ variant: "error", message: source.loadFailed() });
  };

  /** Marks `org`/`app` read-only after a write refusal, whichever target is on screen by then. */
  const deny = (org: string, app: string) => {
    permissions.value.set(`${org}|${app}`, "read");
  };

  /** Resolves true only when the rows held afterwards are this app's; `quiet` fails without a toast. */
  const load = async (org: string, app: string, force = false, quiet = false): Promise<boolean> => {
    const target = `${org}|${app}`;
    if (!app) return false;
    shown.value = target;
    if (!force && current(target)) {
      // A load still in flight for another app must not land over the rows already shown.
      if (inflight && inflight.target !== target) {
        loadSeq++;
        inflight = null;
        loading.value = false;
      }
      return true;
    }
    if (!force && inflight?.target === target) {
      await inflight.run;
      return current(target);
    }
    const seq = ++loadSeq;
    const run = (async () => {
      loading.value = true;
      failedFor.value = null;
      try {
        const rows = (await source.list(org, app)).data?.list;
        if (seq === loadSeq) land(target, rows, app);
      } catch (e) {
        if (seq === loadSeq) fail(target, e, quiet);
      } finally {
        if (seq === loadSeq) loading.value = false;
      }
    })();
    inflight = { target, run };
    try {
      await run;
    } finally {
      if (inflight?.run === run) inflight = null;
    }
    return current(target);
  };

  /** Only "ready" makes an absent id a deleted row; a load not yet settled or superseded reads as "loading". */
  const status = (org: string, app: string): ScopedListStatus => {
    const target = `${org}|${app}`;
    if (!app) return "loading";
    if (failedFor.value === target) return "failed";
    if (loadedFor.value !== target) return "loading";
    return permissions.value.get(target) === "none" ? "forbidden" : "ready";
  };

  /** Joins or starts this app's load, but retries a failed one only when asked; `quiet` retries without a toast. */
  const ensure = async (
    org: string,
    app: string,
    retryFailed = false,
    quiet = false,
  ): Promise<ScopedListStatus> => {
    if (retryFailed || status(org, app) !== "failed") await load(org, app, false, quiet);
    return status(org, app);
  };

  return { items, permission, invalidCount, loading, loadedAt, reset, deny, load, status, ensure };
}
