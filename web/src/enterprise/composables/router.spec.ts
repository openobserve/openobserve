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

import { describe, it, expect, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import useEnvRoutes from "./router";

vi.mock("@/utils/zincutils", () => ({
  routeGuard: vi.fn((_to: unknown, _from: unknown, next: () => void) => next()),
}));
vi.mock("@/enterprise/components/billings/Billing.vue", () => ({ default: { name: "Billing" } }));
vi.mock("@/enterprise/components/billings/plans.vue", () => ({ default: { name: "Plans" } }));
vi.mock("@/enterprise/components/billings/invoiceHistory.vue", () => ({
  default: { name: "InvoiceHistory" },
}));
vi.mock("@/enterprise/components/billings/usage.vue", () => ({ default: { name: "Usage" } }));
vi.mock("@/enterprise/components/billings/BillingGroup.vue", () => ({
  default: { name: "BillingGroup" },
}));
vi.mock("@/views/AzureMarketplaceSetup.vue", () => ({ default: { name: "Azure" } }));
vi.mock("@/views/AwsMarketplaceSetup.vue", () => ({ default: { name: "Aws" } }));
vi.mock("@/enterprise/components/OnlineEvals.vue", () => ({ default: { name: "OnlineEvals" } }));
vi.mock("@/views/AIObservability/promptRoutes", () => ({ promptRoutes: [] }));

const resolveMeta = (path: string) => {
  const { homeChildRoutes } = useEnvRoutes();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" }, children: homeChildRoutes }],
  });
  return router.resolve(path).meta;
};

describe("enterprise routes: allowOnEmptyData", () => {
  it.each(["/billings", "/billings/usage", "/billings/plans", "/billings/invoice_history"])(
    "opens %s on an empty org, the children inheriting the billings meta",
    (path) => {
      expect(resolveMeta(path).allowOnEmptyData).toBe(true);
    },
  );
});
