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

import type { FetchQueryOptions, QueryClient, QueryKey } from "@tanstack/vue-query";
import { alertKeys } from "./alerts.querykeys";

interface OrgFence {
  generation: number;
  writes: Set<Promise<void>>;
}

// Enough for a burst of writes landing one after another; past it the read fails rather than return a stale answer.
const MAX_REREADS = 5;

const fences = new Map<string, OrgFence>();

const fenceOf = (org: string): OrgFence => {
  let fence = fences.get(org);
  if (!fence) {
    fence = { generation: 0, writes: new Set() };
    fences.set(org, fence);
  }
  return fence;
};

/** Runs a write that changes alerts outside the editor; alert reads in flight across it are cancelled and read again. */
export async function fenceAlertWrite<T>(
  client: QueryClient,
  org: string,
  write: () => Promise<T>,
): Promise<T> {
  const fence = fenceOf(org);
  let release!: () => void;
  const settled = new Promise<void>((resolve) => (release = resolve));
  fence.writes.add(settled);
  fence.generation += 1;
  try {
    await client.cancelQueries({ queryKey: alertKeys.all(org) });
    return await write();
  } finally {
    // A read the server answered before the write landed would otherwise refill the cache as fresh.
    fence.generation += 1;
    await client.cancelQueries({ queryKey: alertKeys.all(org) });
    void client.invalidateQueries({ queryKey: alertKeys.all(org) });
    fence.writes.delete(settled);
    release();
  }
}

/** Thrown when fenced writes keep crossing a read, so the caller shows its failure path rather than a stale alert. */
export class AlertReadUnsettledError extends Error {
  constructor(org: string) {
    super(`alert reads in ${org} kept crossing writes`);
    this.name = "AlertReadUnsettledError";
  }
}

const idle = async (fence: OrgFence): Promise<void> => {
  // A write can start while an earlier one is awaited, so wait until none is left.
  while (fence.writes.size) await Promise.all(fence.writes);
};

/** `fetchQuery` for alert reads that seed an editor or a store: only an answer read with no fenced write pending or landing is returned. */
export async function fetchAlertRead<TData, TKey extends QueryKey>(
  client: QueryClient,
  org: string,
  options: FetchQueryOptions<TData, Error, TData, TKey>,
): Promise<TData> {
  const fence = fenceOf(org);
  for (let read = 0; read <= MAX_REREADS; read += 1) {
    await idle(fence);
    const generation = fence.generation;
    const settled = () => generation === fence.generation && fence.writes.size === 0;
    try {
      const data = await client.fetchQuery(options);
      if (settled()) return data;
    } catch (error) {
      if (settled()) throw error;
    }
  }
  throw new AlertReadUnsettledError(org);
}
