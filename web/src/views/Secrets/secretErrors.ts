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

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import { secretErrorCode, type UsageEntry } from "@/services/secrets";

const CODE_KEYS: Record<string, I18nKey> = {
  pin_override_reason_required: "secrets.errors.pinOverrideReasonRequired",
  private_locations_reason_required: "secrets.errors.privateLocationsReasonRequired",
  pin_hosts_empty: "secrets.errors.pinHostsEmpty",
  pin_entry_invalid: "secrets.errors.pinEntryInvalid",
  secret_name_taken: "secrets.errors.nameTaken",
  secret_name_invalid: "secrets.errors.nameInvalid",
  secret_in_use: "secrets.errors.inUse",
  secret_not_deleted: "secrets.errors.notDeleted",
  variable_feeds_secret_consumer: "secrets.errors.variableFeedsConsumer",
  secret_recovery_expired: "secrets.errors.recoveryExpired",
  store_gate_closed: "secrets.errors.gateClosed",
  store_disabled: "secrets.errors.storeDisabled",
  policy_changed: "secrets.errors.policyChanged",
  secret_access_required: "secrets.errors.accessRequired",
  secret_deleted: "secrets.errors.deleted",
  secret_missing: "secrets.errors.missing",
  secret_unbound: "secrets.errors.unbound",
  consumer_not_allowed: "secrets.errors.consumerNotAllowed",
  allowed_consumers_empty: "secrets.errors.allowedConsumersEmpty",
  pin_mismatch: "secrets.errors.pinMismatch",
  secret_pin_required: "secrets.errors.pinRequired",
  secret_unset: "secrets.errors.unset",
  delivery_stale: "secrets.errors.deliveryStale",
  fga_disabled: "secrets.errors.fgaDisabled",
  secret_private_location_refused: "secrets.errors.privateLocationRefused",
  slot_value_required: "secrets.errors.slotValueRequired",
  slot_value_required_on_host_change: "secrets.errors.slotOnHostChange",
  duplicate_slot_identity: "secrets.errors.duplicateSlot",
  ref_not_allowed_in_field: "secrets.errors.refNotAllowed",
};

/** Copy for a store error code, or `undefined` when the code has none. */
export const secretCodeText = (t: TranslateFn, code: string | undefined): I18nText | undefined =>
  code && CODE_KEYS[code] ? t(CODE_KEYS[code]) : undefined;

/** A failed store call as one line: our copy for a known code, else the server's message. */
export const secretErrorText = (t: TranslateFn, error: unknown, fallback: I18nText): I18nText => {
  const known = secretCodeText(t, secretErrorCode(error));
  if (known) return known;
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data
    ?.message;
  return message ? raw(message) : fallback;
};

/** A failed create; any 403 there means the caller lacks the org create grant. */
export const createErrorText = (t: TranslateFn, error: unknown, fallback: I18nText): I18nText =>
  (error as { response?: { status?: number } })?.response?.status === 403
    ? t("secrets.create.forbidden")
    : secretErrorText(t, error, fallback);

/** The consumers a 409 names (`secret_in_use`, `variable_feeds_secret_consumer`); empty when it names none. */
export const secretErrorUsage = (error: unknown): UsageEntry[] => {
  const usage = (error as { response?: { data?: { usage?: unknown } } })?.response?.data?.usage;
  return Array.isArray(usage) ? (usage as UsageEntry[]) : [];
};

export interface ParsedSecretError {
  code: string;
  name: string;
}

/** Splits the `secret_error:{code}:{name}` string a consumer records when a send is refused. */
export const parseSecretError = (text: string): ParsedSecretError | null => {
  const m = /^secret_error:([a-z_]+)(?::(.+))?$/.exec(text.trim());
  return m ? { code: m[1], name: m[2] ?? "" } : null;
};
