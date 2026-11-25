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

import { readQuery } from "@/composables/query/readQuery";
import { deleteKvMutation, kvKeysQuery, kvValueQuery, setKvMutation } from "@/services/kv.queries";

import type { PackInstallRecord } from "./types";

/** A run rewrites its record after every item, so one quiet this long has lost its tab. */
export const RUN_STALE_US = 5 * 60 * 1_000_000;

// A live run on a fast clock must not be taken over; a stamp further ahead would lock the pack.
const MAX_CLOCK_SKEW_US = 5 * 60 * 1_000_000;

const keyPrefix = (packId: string) => `starter_pack.${packId}.`;

const recordKey = (packId: string, installId: string) => `${keyPrefix(packId)}${installId}`;

// Only a run writes `installing`; its last write says `complete` or `incomplete`.
export const isRunning = (record: PackInstallRecord, nowUs: number): boolean => {
  const quietUs = nowUs - (record.updatedAt ?? record.installedAt ?? 0);
  return record.status === "installing" && quietUs < RUN_STALE_US && quietUs >= -MAX_CLOCK_SKEW_US;
};

const stamp = (value: unknown) => (Number.isFinite(value) ? (value as number) : undefined);

// The KV store is shared and user-writable, so a stored value is not trusted to be a record.
const parseRecord = (value: string): PackInstallRecord | null => {
  try {
    const record = JSON.parse(value);
    const valid =
      typeof record?.packId === "string" &&
      typeof record?.installId === "string" &&
      record.status !== "removed" &&
      Array.isArray(record?.items);
    if (!valid) return null;
    return {
      ...record,
      installedAt: stamp(record.installedAt),
      updatedAt: stamp(record.updatedAt),
    };
  } catch {
    return null;
  }
};

export function useInstallRecords(org: string) {
  const setKv = useMutation(() => setKvMutation(org));
  const deleteKv = useMutation(() => deleteKvMutation(org));

  const write = (record: PackInstallRecord) =>
    setKv.mutateAsync({
      key: recordKey(record.packId, record.installId),
      value: JSON.stringify(record),
    });

  const remove = (record: PackInstallRecord) =>
    deleteKv.mutateAsync(recordKey(record.packId, record.installId));

  const read = async (packId: string, installId: string): Promise<PackInstallRecord | null> => {
    const value = await readQuery(kvValueQuery(org, recordKey(packId, installId)), true);
    return value ? parseRecord(value) : null;
  };

  const list = async (packId: string): Promise<PackInstallRecord[]> => {
    const prefix = keyPrefix(packId);
    const keys = await readQuery(kvKeysQuery(org, prefix), true);
    const records = await Promise.all(
      // The backend prefix match is a LIKE, where `_` matches any character.
      keys
        .filter((key) => key.startsWith(prefix))
        .map((key) => read(packId, key.slice(prefix.length))),
    );
    return records.filter((record): record is PackInstallRecord => record !== null);
  };

  return { write, remove, read, list };
}
