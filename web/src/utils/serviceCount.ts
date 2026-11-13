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

const SIGNAL_ORDER = ["logs", "metrics", "traces"];

/** Services as a reader counts them in the discovered list: one per display name, so two detected keys of one trace service count once. */
export function serviceNameCount(
  records: readonly { service_name: string; display_name?: string | null }[],
) {
  return new Set(records.map((record) => record.display_name || record.service_name)).size;
}

/** Services of the discovered list that carry one dimension value, counted like serviceNameCount so it never exceeds that count. */
export function serviceValueCount(
  records: readonly {
    service_name: string;
    display_name?: string | null;
    all_dimensions?: Record<string, string> | null;
    disambiguation?: Record<string, string> | null;
  }[],
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
