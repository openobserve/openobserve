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

/** A positive whole number from `value`; 1 for anything else (0, negative, NaN, undefined). */
function atLeastOne(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

/** Splits `items` into consecutive chunks of at most `size` items. */
export function chunkItems<T>(items: T[], size: number): T[][] {
  const step = atLeastOne(size);
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += step) {
    chunks.push(items.slice(index, index + step));
  }
  return chunks;
}

/**
 * Runs `task` over `items` with at most `limit` tasks in flight. Results keep
 * the input order. A rejected task rejects the whole call, like `Promise.all`,
 * and no further task starts; callers that want to keep going catch inside
 * `task`.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = await task(items[index], index);
      } catch (err) {
        next = items.length;
        throw err;
      }
    }
  };
  const workers = Math.min(atLeastOne(limit), items.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
