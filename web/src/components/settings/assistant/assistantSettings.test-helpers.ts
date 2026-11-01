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

import { createStore } from "vuex";

import { fakeRouter } from "@/components/ai-assistant/__tests__/fakeAssistant";
import type { OrgAiSettings } from "@/services/assistant_settings";
import { createTestQueryClient, withQueryClient } from "@/test/unit/helpers/queryClient";

export const ORG_SETTINGS: OrgAiSettings = {
  enabled: true,
  permission_tier: "act_with_approval",
  org_sharing: true,
  public_sharing: true,
  data_sharing_level: "raw",
  updated_by: "ada@example.com",
  updated_at: 1_767_225_600_000,
};

/** A store, a router with every route the tabs link to, and a fresh query client. */
export function settingsHarness(zoConfig: Record<string, unknown> = {}) {
  const store = createStore({
    state: {
      selectedOrganization: { identifier: "acme", label: "Acme" },
      zoConfig: {
        ai_enabled: true,
        rbac_enabled: true,
        public_ai_chat_enabled: true,
        ai_chat_persistence_enabled: false,
        meta_org: "_meta",
        ...zoConfig,
      },
    },
  });
  const blank = { render: () => null };
  const router = fakeRouter([
    { path: "/settings/assistant/:tab?", name: "assistantSettings", component: blank, props: true },
    { path: "/billings/plans", name: "plans", component: blank },
    { path: "/settings/organization_management", name: "orgnizationManagement", component: blank },
    { path: "/iam/mcp", name: "mcpServer", component: blank },
    { path: "/iam/roles/edit/:role_name", name: "editRole", component: blank },
    { path: "/iam/roles", name: "roles", component: blank },
    { path: "/assistant/:chatId?", name: "assistant", component: blank },
    { path: "/logs", name: "logs", component: blank },
  ]);
  const queryClient = createTestQueryClient();
  return { store, router, queryClient, plugins: [store, router, withQueryClient(queryClient)] };
}
