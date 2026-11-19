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
import { destinationsQuery, saveDestinationMutation } from "@/services/alert_destination.queries";

/** Why the Email me destination could not be saved; the install then runs with alerts off. */
export type EmailMeFailure = "email" | "forbidden";

export type EmailMeResult = { name: string } | { failure: EmailMeFailure };

// The server refuses these in a destination name (config/src/utils/str.rs RE_OFGA_UNSUPPORTED_NAME, plus "/").
const UNSAFE_NAME = /[:#?\s'"%&/]/;
const UNSAFE_NAME_ALL = /[:#?\s'"%&/]/g;
const MAX_ATTEMPTS = 5;
const ALREADY_EXISTS = "Destination with the same name already exists";

// The user record carries no id, so a refused address keeps its readable parts instead.
export const emailMeName = (email: string) => {
  const address = email.trim().toLowerCase();
  return UNSAFE_NAME.test(address)
    ? `email-me-${address.replace(UNSAFE_NAME_ALL, "-")}`
    : `email-${address}`;
};

const messageOf = (error: any): string => String(error?.response?.data?.message ?? "");

// A refused recipient (not an org member) is an email failure, not a missing permission.
const failureOf = (error: any): EmailMeFailure =>
  error?.response?.status === 403 ? "forbidden" : "email";

const sendsOnlyTo = (row: Record<string, any>, address: string) =>
  row.type === "email" &&
  Array.isArray(row.emails) &&
  row.emails.length === 1 &&
  String(row.emails[0]).trim().toLowerCase() === address;

/** Finds or makes the alert destination that emails only the signed-in user. */
export function useEmailMeDestination(org: string) {
  const save = useMutation(() => saveDestinationMutation(org, () => false));

  const create = async (name: string, address: string) =>
    save.mutateAsync({
      destination_name: name,
      module: "alert",
      data: {
        name,
        type: "email",
        template: "prebuilt_email",
        skip_tls_verify: false,
        output_format: "json",
        destination_type_name: "email",
        emails: [address],
      },
    });

  const ensure = async (email: string): Promise<EmailMeResult> => {
    const address = email.trim().toLowerCase();
    if (!address) return { failure: "email" };
    // Without the list a reusable destination is invisible, and creating would duplicate it.
    const rows = await readQuery(destinationsQuery(org, "alert"), true).catch(() => null);
    if (!rows) return { failure: "email" };
    const mine = rows.find((row) => sendsOnlyTo(row, address));
    if (mine) return { name: mine.name };
    const base = emailMeName(address);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const name = attempt === 1 ? base : `${base}-${attempt}`;
      try {
        await create(name, address);
        return { name };
      } catch (error) {
        if (messageOf(error) !== ALREADY_EXISTS) return { failure: failureOf(error) };
      }
    }
    return { failure: "email" };
  };

  return { ensure };
}
