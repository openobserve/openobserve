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

import { qualifiedName } from "@/types/serviceRef";
import { sqlIn, sqlLiteral } from "@/utils/query/sqlFilterBuilder";

const SIGNAL_ORDER = ["logs", "metrics", "traces"];
const SERVICE_UNITS = ["service", "socket", "target", "slice"];
// One pattern serves TS and SQL so both fold alike; [\s\S] spans newlines in both engines without a flag.
const SERVICE_KEY_PATTERN = `^\\s*(?:([\\s\\S]*?\\S)\\s*\\.(?:${SERVICE_UNITS.join("|")})|([\\s\\S]*?))\\s*$`;
const SERVICE_KEY_RE = new RegExp(SERVICE_KEY_PATTERN);

interface NamedRecord {
  service_name: string;
  display_name?: string | null;
  display_qualifier?: string | null;
}

/** The service a discovered record belongs to: its display name, kept apart from a same-named one by its qualifier. */
export function serviceIdentityOf(record: NamedRecord) {
  return qualifiedName(record.display_name || record.service_name, record.display_qualifier);
}

/** The name the service registries match by (backend service_key): trimmed, lowercased, one unit suffix off. */
export function serviceKey(name: string) {
  return name.toLowerCase().replace(SERVICE_KEY_RE, "$1$2");
}

/** serviceKey as a SQL expression over a span column, so a search groups every spelling of a service together. */
export function serviceKeySql(column: string) {
  return `regexp_replace(lower(${column}), '${SERVICE_KEY_PATTERN}', '\\1\\2')`;
}

/** A span filter on every raw spelling of one service, so a folded catalog row reads all of its spans. */
export function serviceNamesSql(column: string, names: readonly string[]) {
  const spellings = [...new Set(names)];
  return spellings.length === 1
    ? `${column} = ${sqlLiteral(spellings[0])}`
    : sqlIn(column, spellings);
}

/** Services as a reader counts them in the discovered list: two detected keys of one qualified trace service count once. */
export function serviceNameCount(records: readonly NamedRecord[]) {
  return new Set(records.map(serviceIdentityOf)).size;
}

/** Services of the discovered list that carry one dimension value, counted like serviceNameCount so it never exceeds that count. */
export function serviceValueCount(
  records: readonly (NamedRecord & {
    all_dimensions?: Record<string, string> | null;
    disambiguation?: Record<string, string> | null;
  })[],
  dimension: string,
  value: string,
) {
  return serviceNameCount(
    records.filter(
      (record) =>
        (record.all_dimensions?.[dimension] ?? record.disambiguation?.[dimension]) === value ||
        (dimension === "service" && record.service_name === value),
    ),
  );
}

/** Orders per-signal entries Logs, Metrics, Traces, then any other signal by name, whatever order a response used. */
export function bySignalOrder<T>(items: readonly T[], signal: (item: T) => string): T[] {
  const rank = (item: T) => {
    const index = SIGNAL_ORDER.indexOf(signal(item));
    return index === -1 ? SIGNAL_ORDER.length : index;
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || signal(a).localeCompare(signal(b)));
}
