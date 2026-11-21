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

const LABEL_FIELDS = ["name", "email", "id"] as const;
type LabelField = (typeof LABEL_FIELDS)[number];
export type RumSessionUserIdentity = Partial<Record<`user_${LabelField}`, string | null>>;

export const RUM_SESSION_USER_LABEL_ORDERS = [
  "name-email-id",
  "name-id-email",
  "email-name-id",
  "email-id-name",
  "id-name-email",
  "id-email-name",
] as const;
export type RumSessionUserLabelOrder = (typeof RUM_SESSION_USER_LABEL_ORDERS)[number];
export const DEFAULT_RUM_SESSION_USER_LABEL_ORDER = RUM_SESSION_USER_LABEL_ORDERS[0];

export const RUM_SESSION_USER_IDENTITY_COLUMNS = LABEL_FIELDS.map(
  (field) => `usr_${field}` as const,
);

export function rumSessionUserIdentitySelect(schema: Record<string, unknown>): string[] {
  return LABEL_FIELDS.map((field) => {
    const column = `usr_${field}`;
    const expression = schema[column]
      ? `MAX(NULLIF(regexp_replace(CAST(${column} AS VARCHAR), '^\\s+|\\s+$', '', 'g'), ''))`
      : "CAST(NULL AS VARCHAR)";
    return `${expression} AS user_${field}`;
  });
}

export function resolveRumSessionUserLabel(
  identity: RumSessionUserIdentity,
  order: RumSessionUserLabelOrder,
): string | null {
  for (const field of order.split("-") as LabelField[]) {
    const value = identity[`user_${field}`]?.trim();
    if (value) return value;
  }
  return null;
}
