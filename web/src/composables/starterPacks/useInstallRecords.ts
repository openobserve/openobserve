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

const keyPrefix = (packId: string) => `starter_pack.${packId}.`;

export const recordKey = (packId: string, installId: string) => `${keyPrefix(packId)}${installId}`;

// FNV-1a: a change detector for item bodies, and `crypto.subtle` is absent on plain http.
const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16);
};

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      // Code-unit order: the hash must match across browser locales.
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, sortKeys(entry)]),
  );
};

/** Independent of key order, since the server does not promise one. */
export const contentHash = (value: unknown): string => {
  const text = JSON.stringify(sortKeys(value));
  return `${text.length.toString(16)}-${fnv1a(text)}`;
};

// The KV store is shared and user-writable, so a stored value is not trusted to be a record.
const parseRecord = (value: string): PackInstallRecord | null => {
  try {
    const record = JSON.parse(value);
    const valid =
      typeof record?.packId === "string" &&
      typeof record?.installId === "string" &&
      Array.isArray(record?.items);
    return valid ? record : null;
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
