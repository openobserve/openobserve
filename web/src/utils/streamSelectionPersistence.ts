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

type StoreWithPersistFlag = {
  state?: {
    zoConfig?: {
      persist_last_selected_stream?: boolean;
    };
    selectedOrganization?: {
      identifier?: string;
    };
  };
};

export const STREAM_SELECTION_STORAGE_KEYS = {
  logs: "o2_last_stream_logs",
  metrics: "o2_last_stream_metrics",
  traces: "o2_last_stream_traces",
} as const;

export const isStreamSelectionPersistenceEnabled = (
  store: StoreWithPersistFlag,
) => store?.state?.zoConfig?.persist_last_selected_stream === true;

/**
 * Returns an org-scoped localStorage key so different organizations maintain
 * independent stream selections. Falls back to the bare key when no org
 * identifier is present.
 */
function buildStorageKey(store: StoreWithPersistFlag, key: string): string {
  const orgId = store?.state?.selectedOrganization?.identifier;
  return orgId ? `${key}_${orgId}` : key;
}

export const getPersistedStreamSelection = (
  store: StoreWithPersistFlag,
  key: string,
): string | null => {
  if (!isStreamSelectionPersistenceEnabled(store)) {
    return null;
  }
  try {
    return localStorage.getItem(buildStorageKey(store, key));
  } catch {
    // Silently fail in environments where localStorage is unavailable
    // (e.g., Safari private mode, storage quota exceeded).
    return null;
  }
};

export const setPersistedStreamSelection = (
  store: StoreWithPersistFlag,
  key: string,
  value?: string | null,
) => {
  if (!isStreamSelectionPersistenceEnabled(store)) {
    return;
  }
  const scopedKey = buildStorageKey(store, key);
  try {
    if (!value) {
      localStorage.removeItem(scopedKey);
      return;
    }
    localStorage.setItem(scopedKey, value);
  } catch {
    // Silently fail in environments where localStorage is unavailable
    // (e.g., Safari private mode, storage quota exceeded).
  }
};
