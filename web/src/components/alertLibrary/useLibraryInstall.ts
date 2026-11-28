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

import { useMutation } from "@tanstack/vue-query";

import { useAlertLibrary, useAnomalyLibraryAccess } from "@/composables/alerts/useAlertLibrary";
import { saveAlertMutation } from "@/services/alerts.queries";
import { alertKeys } from "@/services/alerts.querykeys";
import { saveAnomalyConfigMutation } from "@/services/anomaly_detection.queries";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";

import { alertTypeOf } from "./libraryFacets";
import {
  buildAnomalyInstallPayload,
  buildInstallPayload,
  InstallPayloadError,
  type InstallOverrides,
} from "./libraryInstall";
import { fileForInstall } from "./libraryTunables";

export interface LibraryInstallOptions {
  folderId: string;
  owner: string;
  timezone: string;
  overrides?: InstallOverrides;
  /** The alert the drawer already tuned; its file is used instead of a fresh fetch. */
  seed?: { entry: AlertLibraryEntry; file: AlertLibraryFile } | null;
  /** Refuses anomaly alerts, for callers that manage alerts through the scheduled API alone. */
  scheduledOnly?: boolean;
  /** Last edit of a scheduled alert's body before it is created. */
  decoratePayload?: (
    payload: Record<string, unknown>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Receives the id the create response carries for a scheduled alert. */
  onSaved?: (id: string) => void;
}

export interface LibraryInstallHooks {
  onStart?: (entry: AlertLibraryEntry) => void;
  onInstalled?: (entry: AlertLibraryEntry) => void;
  onFailed?: (entry: AlertLibraryEntry, error: unknown) => void;
}

export function useLibraryInstall(org: () => string) {
  const { loadAlertFile } = useAlertLibrary();
  const anomalyAccess = useAnomalyLibraryAccess();

  // Each create drops the scope itself, so nothing refreshes after the batch.
  const installAlert = useMutation(() => saveAlertMutation(org(), () => false));
  // The Alerts list shows anomaly configs too, and the shared mutation drops only the anomaly scope.
  const installAnomaly = useMutation(() => {
    const options = saveAnomalyConfigMutation(org(), () => undefined);
    return {
      ...options,
      meta: {
        ...options.meta,
        invalidates: [...(options.meta?.invalidates ?? []), alertKeys.all(org())],
      },
    };
  });

  /** Resolves true when the created alert was an anomaly config. */
  const installOne = async (
    entry: AlertLibraryEntry,
    options: LibraryInstallOptions,
  ): Promise<boolean> => {
    const { folderId, owner, timezone, overrides, seed, scheduledOnly, decoratePayload, onSaved } =
      options;
    const file =
      seed && seed.entry.id === entry.id
        ? seed.file
        : fileForInstall(entry, await loadAlertFile(entry));

    // The file is checked too: on OSS an anomaly body is stored as a broken scheduled alert.
    const isAnomaly = alertTypeOf(entry) === "anomaly" || file.alert_type === "anomaly_detection";
    if (isAnomaly) {
      if (scheduledOnly || anomalyAccess.value !== "enabled") {
        throw new InstallPayloadError("anomaly_unavailable");
      }
      const payload = buildAnomalyInstallPayload({ entry, file, folderId });
      await installAnomaly.mutateAsync({ payload, folderId });
      return true;
    }

    const payload = buildInstallPayload({ entry, file, folderId, owner, timezone, overrides });
    const saved = await installAlert.mutateAsync({
      payload: decoratePayload ? await decoratePayload(payload) : payload,
      folderId,
    });
    if (saved?.data?.id) onSaved?.(saved.data.id);
    return false;
  };

  const installBatch = async (
    entries: AlertLibraryEntry[],
    options: LibraryInstallOptions,
    hooks: LibraryInstallHooks = {},
  ): Promise<{ installedIds: string[]; anomalyCount: number }> => {
    // Only what this pass created. Re-announcing everything would make a retry repeat ids the parent already counted.
    const installedIds: string[] = [];
    let anomalyCount = 0;

    // Sequential: one rejected create must not abort the batch, and parallel POSTs trip rate limits.
    for (const entry of entries) {
      hooks.onStart?.(entry);
      try {
        if (await installOne(entry, options)) anomalyCount += 1;
        hooks.onInstalled?.(entry);
        installedIds.push(entry.id);
      } catch (error) {
        hooks.onFailed?.(entry, error);
      }
    }
    return { installedIds, anomalyCount };
  };

  return { installOne, installBatch };
}
