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

/** The one non-empty value every row shares, or null when rows differ or are empty. */
export const uniformValue = <T>(
  rows: readonly T[],
  read: (row: T) => string | null | undefined,
) => {
  const first = rows.length ? read(rows[0]) : null;
  return first && rows.every((row) => read(row) === first) ? first : null;
};

const ENGINE_NAMES: Record<string, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
};

export const engineName = (dbSystem: string) => ENGINE_NAMES[dbSystem] ?? dbSystem;
