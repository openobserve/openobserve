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

import { queryOptions } from "@tanstack/vue-query";
import billings from "./billings";
import { billingKeys } from "./billings.querykeys";

export const subscriptionQuery = (org: string) =>
  queryOptions({
    queryKey: billingKeys.subscription(org),
    queryFn: async () => (await billings.list_subscription(org)).data,
    refetchOnWindowFocus: true,
  });

export const invoiceHistoryQuery = (org: string) =>
  queryOptions({
    queryKey: billingKeys.invoices(org),
    queryFn: async () => (await billings.list_invoice_history(org)).data,
    refetchOnWindowFocus: true,
  });

export const aiUsageQuery = (org: string) =>
  queryOptions({
    queryKey: billingKeys.aiUsage(org),
    queryFn: async () => (await billings.get_ai_usage(org)).data,
    refetchOnWindowFocus: true,
  });

export const billingGroupMembersQuery = (org: string) =>
  queryOptions({
    queryKey: billingKeys.groupMembers(org),
    queryFn: async () => (await billings.list_billing_group_members(org)).data,
    refetchOnWindowFocus: true,
  });
