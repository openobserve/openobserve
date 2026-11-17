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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import securitySigma from "@/services/securitySigma";
import securitySources from "@/services/securitySources";
import { okResponse } from "@/views/Security/__fixtures__/securityFixtures";

vi.mock("@/services/securitySigma", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/securitySigma")>());
});
vi.mock("@/services/securitySources", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/securitySources")>());
});

import SecurityCaseFiringEvidence from "./SecurityCaseFiringEvidence.vue";

let wrapper: VueWrapper | null = null;
const FIRED_US = 1_762_760_000_000_000;

const mountEvidence = async (extra: Record<string, unknown> = {}) => {
  wrapper = mount(SecurityCaseFiringEvidence, {
    props: { org: "acme", alertId: "a-spray", firedAt: FIRED_US, periodMinutes: 30, ...extra },
    global: { plugins: [withQueryClient()] },
  });
  await flushPromises();
  return wrapper;
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityCaseFiringEvidence", () => {
  it("renders the firing's evidence rows with their key fields", async () => {
    vi.mocked(securitySigma.evidence).mockResolvedValue(
      okResponse({
        stream: "entra_signin",
        correlation: false,
        stored: true,
        groups: [
          {
            values: { ipAddress: "185.220.101.47" },
            first_seen: FIRED_US - 60_000_000,
            last_seen: FIRED_US,
            event_count: 2,
            sql: "SELECT * FROM entra_signin",
            rows: [
              { _timestamp: FIRED_US, src_ip: "185.220.101.47", user: "carlos.palmer" },
              { _timestamp: FIRED_US - 1, src_ip: "185.220.101.47", user: "nina.lin" },
            ],
          },
        ],
      }) as never,
    );
    const w = await mountEvidence();
    expect(securitySigma.evidence).toHaveBeenCalledWith("acme", "a-spray", {
      firing_time: FIRED_US,
      start_time: FIRED_US - 31 * 60_000_000,
      end_time: FIRED_US + 1,
    });
    const rows = w.findAll('[data-test="security-case-firing-evidence-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("185.220.101.47");
    expect(rows[1].text()).toContain("nina.lin");
  });

  it("says so when the firing has no matching events", async () => {
    vi.mocked(securitySigma.evidence).mockResolvedValue(
      okResponse({ stream: "s", correlation: false, stored: false, groups: [] }) as never,
    );
    const w = await mountEvidence();
    expect(w.find('[data-test="security-case-firing-evidence-empty"]').exists()).toBe(true);
    expect(securitySources.types).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the evidence cannot be rebuilt", async () => {
    vi.mocked(securitySigma.evidence).mockResolvedValue(
      okResponse({
        stream: "s",
        correlation: true,
        stored: false,
        groups: [],
        error: "rule no longer compiles",
      }) as never,
    );
    const w = await mountEvidence();
    expect(w.find('[data-test="security-case-firing-evidence-error"]').text()).toBe(
      "rule no longer compiles",
    );
  });

  it("shows only the case entity's rows, with a toggle to show the rest", async () => {
    vi.mocked(securitySigma.evidence).mockResolvedValue(
      okResponse({
        stream: "vpc_flow",
        correlation: false,
        stored: true,
        groups: [
          {
            values: {},
            first_seen: FIRED_US,
            last_seen: FIRED_US,
            event_count: 3,
            sql: "SELECT * FROM vpc_flow",
            rows: [
              { _timestamp: FIRED_US, srcaddr: "10.30.1.13", dstaddr: "142.250.80.1" },
              { _timestamp: FIRED_US - 1, srcaddr: "10.40.0.11", dstaddr: "142.250.80.1" },
              { _timestamp: FIRED_US - 2, srcaddr: "10.30.3.14", dstaddr: "142.250.80.1" },
            ],
          },
        ],
      }) as never,
    );
    const w = await mountEvidence({ entities: [{ kind: "ip", value: "10.30.1.13" }] });
    expect(w.findAll('[data-test="security-case-firing-evidence-row"]')).toHaveLength(1);
    expect(w.find('[data-test="security-case-firing-evidence-filter"]').text()).toContain(
      "2 rows about other entities are hidden",
    );
    await w.find('[data-test="security-case-firing-evidence-toggle"]').trigger("click");
    expect(w.findAll('[data-test="security-case-firing-evidence-row"]')).toHaveLength(3);
  });

  it("keeps a correlation group keyed on the entity whole", async () => {
    vi.mocked(securitySigma.evidence).mockResolvedValue(
      okResponse({
        stream: "linux_syslog",
        correlation: true,
        stored: true,
        groups: [
          {
            values: { host: "bastion01" },
            first_seen: FIRED_US,
            last_seen: FIRED_US,
            event_count: 2,
            sql: "SELECT * FROM linux_syslog",
            rows: [
              { _timestamp: FIRED_US, message: "Failed password for root" },
              { _timestamp: FIRED_US - 1, message: "Failed password for admin" },
            ],
          },
        ],
      }) as never,
    );
    const w = await mountEvidence({ entities: [{ kind: "host", value: "bastion01" }] });
    expect(w.findAll('[data-test="security-case-firing-evidence-row"]')).toHaveLength(2);
    expect(w.find('[data-test="security-case-firing-evidence-filter"]').exists()).toBe(false);
  });
});
