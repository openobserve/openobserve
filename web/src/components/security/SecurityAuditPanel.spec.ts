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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import security from "@/services/security";

vi.mock("@/services/security", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/security")>());
});

import SecurityAuditPanel from "./SecurityAuditPanel.vue";

let wrapper: VueWrapper | null = null;

const page = (over: Record<string, unknown> = {}) => ({
  data: { audit_enabled: true, start_time: 1, end_time: 2, events: [], ...over },
});

const mountPanel = async () => {
  wrapper = mount(SecurityAuditPanel, { global: { provide: { store }, plugins: [store] } });
  await flushPromises();
  return wrapper;
};

beforeEach(() => vi.mocked(security.getAudit).mockReset());
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("SecurityAuditPanel", () => {
  it("lists who changed what", async () => {
    vi.mocked(security.getAudit).mockResolvedValue(
      page({
        events: [
          {
            timestamp: 1_700_000_000_000_000,
            user_email: "mallory@example.com",
            method: "PATCH",
            path: "v2/default/alerts/2abc/enable",
            query: "value=false",
            status_code: 200,
            category: "detection",
            body: "",
          },
        ],
      }) as never,
    );
    const w = await mountPanel();
    const table = w.find('[data-test="security-audit-table"]');
    expect(table.text()).toContain("mallory@example.com");
    expect(table.text()).toContain("v2/default/alerts/2abc/enable");
    expect(table.text()).toContain("Turned off");
    expect(table.text()).toContain("Detection");
  });

  it("says so when the deployment keeps no audit trail", async () => {
    vi.mocked(security.getAudit).mockResolvedValue(page({ audit_enabled: false }) as never);
    const w = await mountPanel();
    expect(w.find('[data-test="security-audit-disabled"]').exists()).toBe(true);
    expect(w.find('[data-test="security-audit-table"]').exists()).toBe(false);
  });
});
