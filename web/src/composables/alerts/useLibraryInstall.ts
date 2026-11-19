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

import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useMutation } from "@tanstack/vue-query";

import { alertTypeOf } from "@/components/alertLibrary/libraryFacets";
import {
  buildAnomalyInstallPayload,
  buildInstallPayload,
  InstallPayloadError,
  type InstallOverrides,
} from "@/components/alertLibrary/libraryInstall";
import { fileForInstall } from "@/components/alertLibrary/libraryTunables";
import type { StarterScope } from "@/components/create-starter/createStarter.types";
import { useAlertLibrary, useAnomalyLibraryAccess } from "@/composables/alerts/useAlertLibrary";
import { saveAlertMutation } from "@/services/alerts.queries";
import { alertKeys } from "@/services/alerts.querykeys";
import { saveAnomalyConfigMutation } from "@/services/anomaly_detection.queries";
import analytics from "@/services/product_analytics";
import { ALERT_PREFILL_VERSION, type AlertPrefill } from "@/ts/interfaces/alertPrefill";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { scopePrefill } from "@/utils/alerts/starterScope";

export type InstallStatus = "pending" | "running" | "installed" | "failed";

export interface InstallResult {
  id: string;
  title: I18nText;
  status: InstallStatus;
  /** Server text on failure — shown verbatim, so never a catalogue key. */
  message?: I18nText;
}

/** What every alert of one batch shares; read once per run. */
export interface InstallBatch {
  folderId: string;
  overrides?: InstallOverrides;
  /** Destination names; absent or empty keeps the library's empty list. */
  destinations?: string[];
  scope?: StarterScope;
}

export interface InstallRun {
  /** Library entry ids this pass created; a retry reports only its own. */
  installedIds: string[];
  anomalyCount: number;
}

export interface PreparedInstall {
  payload: Record<string, unknown>;
  isAnomaly: boolean;
}

/** A scope the file's query cannot carry; failing the row beats an alert wider than asked. */
export class ScopeUnsupportedError extends Error {
  constructor() {
    super("scope_unsupported");
    this.name = "ScopeUnsupportedError";
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** The file's own query narrowed to the scope; built from the file, not the form prefill, which may rewrite SQL. */
export function scopeLibraryFile(
  entry: AlertLibraryEntry,
  file: AlertLibraryFile,
  scope: StarterScope | undefined,
): AlertLibraryFile {
  if (!scope || scope.kind === "all") return file;
  const query = asRecord(file.query_condition);
  const queryType = query.type === "promql" || query.type === "sql" ? query.type : null;
  if (!queryType) throw new ScopeUnsupportedError();

  const base: AlertPrefill = {
    version: ALERT_PREFILL_VERSION,
    source: "library",
    sourceLabel: entry.title,
    streamType: asText(file.stream_type) ?? entry.stream_type,
    streamName: asText(file.stream_name) ?? entry.stream,
    queryType,
    sql: asText(query.sql),
    promql: asText(query.promql),
    warnings: [],
  };
  // applyScope drops the skip reason; an unnarrowed alert would fire for every service.
  const { prefill, reason } = scopePrefill(base, scope);
  if (reason) throw new ScopeUnsupportedError();
  if (prefill === base) return file;

  const next = JSON.parse(JSON.stringify(file)) as Record<string, unknown>;
  const nextQuery = asRecord(next.query_condition);
  if (queryType === "promql") nextQuery.promql = prefill.promql;
  else nextQuery.sql = prefill.sql;
  next.query_condition = nextQuery;
  return next;
}

/**
 * The library's sequential create loop with its per-row results and retry.
 * `seedFile` hands back a file the caller already tuned, so it is not fetched again.
 */
export function useLibraryInstall(
  options: { seedFile?: (entry: AlertLibraryEntry) => AlertLibraryFile | null } = {},
) {
  const { t } = useI18nTyped();
  const store = useStore();
  const { loadAlertFile } = useAlertLibrary();
  const anomalyAccess = useAnomalyLibraryAccess();

  /** Optional-chained: a missing organization must not throw out of a click handler. */
  const orgIdentifier = (): string => store.state.selectedOrganization?.identifier ?? "";

  // Frozen at run start: the caller can prune its list mid-run, which would drop unread result rows.
  const roster = ref<AlertLibraryEntry[]>([]);
  const results = ref<InstallResult[]>([]);
  const isInstalling = ref(false);
  const hasRun = ref(false);

  const failedIds = computed(() =>
    results.value.filter((result) => result.status === "failed").map((result) => result.id),
  );

  const reset = () => {
    roster.value = [];
    results.value = [];
    hasRun.value = false;
    isInstalling.value = false;
  };

  const errorText = (error: unknown): I18nText => {
    // The builder refuses a file by CODE because it has no `t`; resolving it here keeps it translatable.
    if (error instanceof InstallPayloadError) {
      return error.code === "anomaly_unavailable"
        ? t("alert_library.install.anomalyUnavailable")
        : t("alert_library.install.unreadableConditions");
    }
    if (error instanceof ScopeUnsupportedError) return t("alertStarter.bulk.scopeUnsupported");
    const response = (error as { response?: { data?: { message?: string } } })?.response;
    return (
      raw(response?.data?.message) ||
      raw((error as { message?: string })?.message) ||
      t("alert_library.install.unknownError")
    );
  };

  const setResult = (id: string, patch: Partial<InstallResult>) => {
    results.value = results.value.map((result) =>
      result.id === id ? { ...result, ...patch } : result,
    );
  };

  // Each create drops the scope itself, so nothing refreshes after the batch.
  const installAlert = useMutation(() => saveAlertMutation(orgIdentifier(), () => false));
  // The Alerts list shows anomaly configs too, and the shared mutation drops only the anomaly scope.
  const installAnomaly = useMutation(() => {
    const mutation = saveAnomalyConfigMutation(orgIdentifier(), () => undefined);
    return {
      ...mutation,
      meta: {
        ...mutation.meta,
        invalidates: [...(mutation.meta?.invalidates ?? []), alertKeys.all(orgIdentifier())],
      },
    };
  });

  /** The exact body a create would post, so a dry run tests what will be added. */
  const prepare = async (
    entry: AlertLibraryEntry,
    batch: InstallBatch,
  ): Promise<PreparedInstall> => {
    const file = options.seedFile?.(entry) ?? fileForInstall(entry, await loadAlertFile(entry));
    const shared = batch.destinations?.length ? { destinations: [...batch.destinations] } : {};

    // The file is checked too: on OSS an anomaly body is stored as a broken scheduled alert.
    if (alertTypeOf(entry) === "anomaly" || file.alert_type === "anomaly_detection") {
      if (anomalyAccess.value !== "enabled") throw new InstallPayloadError("anomaly_unavailable");
      if (batch.scope && batch.scope.kind !== "all") throw new ScopeUnsupportedError();
      const payload = buildAnomalyInstallPayload({ entry, file, folderId: batch.folderId });
      return { payload: { ...payload, ...shared }, isAnomaly: true };
    }

    const payload = buildInstallPayload({
      entry,
      file: scopeLibraryFile(entry, file, batch.scope),
      folderId: batch.folderId,
      owner: store.state.userInfo?.email ?? "",
      timezone: store.state.timezone,
      overrides: batch.overrides,
    });
    return { payload: { ...payload, ...shared }, isAnomaly: false };
  };

  const installOne = async (entry: AlertLibraryEntry, batch: InstallBatch): Promise<boolean> => {
    const { payload, isAnomaly } = await prepare(entry, batch);
    const mutation = isAnomaly ? installAnomaly : installAlert;
    await mutation.mutateAsync({ payload, folderId: batch.folderId });
    return isAnomaly;
  };

  /** Installs `ids` out of `candidates`; null when nothing ran (busy, or no such entry). */
  const install = async (
    candidates: AlertLibraryEntry[],
    ids: string[],
    batch: InstallBatch,
  ): Promise<InstallRun | null> => {
    if (isInstalling.value) return null;

    // Freeze the roster on the FIRST run; a retry reports on the same set.
    if (!hasRun.value) roster.value = [...candidates];

    const todo = roster.value.filter((entry) => ids.includes(entry.id));
    // An id with no entry behind it must not flip `hasRun` for a run that never happened.
    if (todo.length === 0) return null;

    // Rows in this pass restart at pending; the rest keep the verdict an earlier pass gave them.
    const previous = new Map(results.value.map((result) => [result.id, result]));
    results.value = roster.value.map((entry) => {
      const carried = previous.get(entry.id);
      if (!ids.includes(entry.id) && carried) return carried;
      return { id: entry.id, title: raw(entry.title), status: "pending" as const };
    });

    isInstalling.value = true;
    hasRun.value = true;
    // Copied once, so a batch cannot change its settings halfway through itself.
    const frozen: InstallBatch = JSON.parse(JSON.stringify(batch));

    const installedIds: string[] = [];
    let anomalyCount = 0;

    // Sequential on purpose: one rejected create must not take the rest with it, and parallel POSTs rate-limit.
    try {
      for (const entry of todo) {
        setResult(entry.id, { status: "running", message: undefined });
        try {
          if (await installOne(entry, frozen)) anomalyCount += 1;
          setResult(entry.id, { status: "installed" });
          installedIds.push(entry.id);
        } catch (error) {
          setResult(entry.id, { status: "failed", message: errorText(error) });
        }
      }
    } finally {
      // Nothing escapes the per-alert catch today; if anything did, the host would be stuck busy.
      isInstalling.value = false;
    }

    if (installedIds.length > 0) {
      analytics.track("library_alert_installed", {
        count: installedIds.length,
        anomaly_count: anomalyCount,
      });
    }
    return { installedIds, anomalyCount };
  };

  return { results, isInstalling, hasRun, failedIds, install, prepare, reset, errorText };
}
