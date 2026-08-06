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

/**
 * Billing (enterprise) — only the reads that are safe to cache.
 *
 * Most billing GETs are NOT here on purpose, and must never be added:
 *
 *   hosted_subscription_url, billing_portal, hosted_page_status/{id},
 *   change_payment_detail/{id}   → single-use URLs and page tokens
 *   list_paymentsource           → payment instrument data
 *   unsubscribe, resume_subscription → these mutate through a GET
 *
 * Nothing here persists: subscription state and usage counters are exactly the
 * things that must not be served from disk after a reload.
 */

import BillingService from "@/services/billings";
import { qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";

const root = (org: string) => [...qk.org(org), "billing"] as const;

const make = (name: string, fn: (org: string) => Promise<any>) => {
  const options = (org: string) => ({
    queryKey: [...root(org), name] as const,
    queryFn: () => fn(org),
    ...tierOptions("ENTITY_LIST", { persist: "none" }),
  });
  return {
    fetch: (org: string) => queryClient.fetchQuery(options(org)),
    refetch: (org: string) => queryClient.fetchQuery({ ...options(org), staleTime: 0 }),
  };
};

export const subscriptionQuery = make(
  "subscription",
  async (org) => (await BillingService.list_subscription(org)).data,
);
export const invoiceHistoryQuery = make(
  "invoices",
  async (org) => (await BillingService.list_invoice_history(org)).data,
);
export const aiUsageQuery = make(
  "aiUsage",
  async (org) => (await BillingService.get_ai_usage(org)).data,
);
export const billingGroupMembersQuery = make(
  "groupMembers",
  async (org) => (await BillingService.list_billing_group_members(org)).data,
);

/** Any subscription or membership change invalidates the whole billing prefix. */
export const invalidateBilling = (org: string) =>
  queryClient.invalidateQueries({ queryKey: root(org) });
