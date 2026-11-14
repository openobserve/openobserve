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

import type { IdentityValues } from "./streamCandidates";
import { inBatches, readSchemaColumns } from "./packMatchData";

/** A log stream holding unparsed Nginx lines, named until parse repair ships (R57). */
export interface RawLogNotice {
  stream: string;
  column: string;
}

/** Most recently written log streams checked, so a large org pays a bounded number of reads. */
export const RAW_LOG_SCAN_LIMIT = 50;

const TEXT_COLUMNS = ["message", "log", "body", "msg"];

const NGINX_LINES = [
  /^\S+ \S+ \S+ \[[^\]]+\] "[A-Z]+ \S+ HTTP\/[\d.]+" \d{3} \d+/,
  /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \[(debug|info|notice|warn|error|crit|alert|emerg)\] \d+#\d+: /,
];

// Underscore columns are the server's own, so only the rest say whether anything was parsed.
export const plainTextColumn = (columns: string[]): string | null => {
  const own = columns.filter((name) => !name.startsWith("_"));
  return own.length === 1 && TEXT_COLUMNS.includes(own[0]) ? own[0] : null;
};

export const isNginxLine = (line: string) => NGINX_LINES.some((pattern) => pattern.test(line));

/** Most samples must read as Nginx, so one stray line never names a stream. */
export const looksLikeNginx = (samples: string[]) =>
  samples.length > 0 && samples.filter(isNginxLine).length * 2 >= samples.length;

export const findRawNginxLogs = async (
  org: string,
  logs: Map<string, number>,
  readValues: (stream: string, fields: string[]) => Promise<IdentityValues>,
): Promise<RawLogNotice[]> => {
  const streams = [...logs]
    .sort(([, a], [, b]) => b - a)
    .slice(0, RAW_LOG_SCAN_LIMIT)
    .map(([name]) => name);
  const found = await inBatches(streams, async (stream): Promise<RawLogNotice | null> => {
    const column = plainTextColumn(await readSchemaColumns(org, "logs", stream).catch(() => []));
    if (!column) return null;
    const samples = (await readValues(stream, [column]))[column] ?? [];
    return looksLikeNginx(samples) ? { stream, column } : null;
  });
  return found.filter((notice): notice is RawLogNotice => notice !== null);
};
