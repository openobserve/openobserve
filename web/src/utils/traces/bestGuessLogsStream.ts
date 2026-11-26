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

export interface LogsStreamCandidate {
  name: string;
  storageSize: number;
}

export interface BestGuessLogsStreamInput {
  streams: LogsStreamCandidate[];
  recent: string[];
  hasField: (stream: string) => Promise<boolean>;
  maxChecks?: number;
}

// Each candidate costs one schema read, so the walk stops after a handful.
const DEFAULT_MAX_CHECKS = 10;

/** Recently opened streams first, then the largest; the first one whose schema has the field wins. */
export async function pickBestGuessLogsStream(
  input: BestGuessLogsStreamInput,
): Promise<string | null> {
  const known = new Set(input.streams.map((s) => s.name));
  const bySize = [...input.streams]
    .sort((a, b) => b.storageSize - a.storageSize)
    .map((s) => s.name);
  const ordered = [...new Set([...input.recent.filter((n) => known.has(n)), ...bySize])];
  for (const name of ordered.slice(0, input.maxChecks ?? DEFAULT_MAX_CHECKS)) {
    try {
      if (await input.hasField(name)) return name;
    } catch {
      // A stream whose schema cannot be read is skipped, not fatal.
    }
  }
  return null;
}
