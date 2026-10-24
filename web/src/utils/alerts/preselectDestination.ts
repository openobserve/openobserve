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

import { hasDeliveryTarget, type DeliveryTargets } from "./deliveryTarget";

export interface PreselectInput {
  isNew: boolean;
  alert: DeliveryTargets & { creates_incident?: boolean };
  orgDestinations: readonly string[];
  defaultDestination?: string | null;
  /** `undefined` means the server did not say, so Email stays offered. */
  smtpEnabled?: boolean;
  userEmail?: string;
}

/** What a new alert's Destination field starts with; `none` adds nothing. */
export type Preselection =
  { kind: "orgDefault"; destination: string } | { kind: "emailMe" } | { kind: "none" };

/** Org default, else Email me for a first alert in an org with nowhere to send, else nothing. */
export const preselectDestination = (input: PreselectInput): Preselection => {
  const { alert } = input;
  // A route set on purpose (prefill, on-call, incident) keeps the alert's recipients as they are.
  if (!input.isNew || hasDeliveryTarget(alert) || alert.creates_incident) return { kind: "none" };
  const fallback = input.defaultDestination?.trim();
  if (fallback && input.orgDestinations.includes(fallback)) {
    return { kind: "orgDefault", destination: fallback };
  }
  const canEmail = input.smtpEnabled !== false && !!input.userEmail?.trim();
  return canEmail && input.orgDestinations.length === 0 ? { kind: "emailMe" } : { kind: "none" };
};
