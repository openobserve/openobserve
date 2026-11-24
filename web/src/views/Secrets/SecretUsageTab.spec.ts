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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import SecretUsageTab from "./SecretUsageTab.vue";
import secrets, { type SecretDetail, type UsageEntry } from "@/services/secrets";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/secrets", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, default: { usage: vi.fn() } };
});

const detail = {
  id: "s1",
  name: "SERVICENOW_BASIC",
  kind: "secret",
  state: "active",
  pin_mode: "hosts",
  private_locations: "off",
} as unknown as SecretDetail;

const entry = (over: Partial<UsageEntry>): UsageEntry => ({
  path: [
    { consumer_type: "alert_destination", consumer_id: "d1", consumer_name: "snow-incidents" },
  ],
  field: "/headers/Authorization",
  status: "bound",
  token_name: "SERVICENOW_BASIC",
  ...over,
});

const mountTab = async (items: UsageEntry[]) => {
  vi.mocked(secrets.usage).mockResolvedValue({ data: { items } } as any);
  const w = mount(SecretUsageTab, {
    props: { detail },
    global: { plugins: [i18n, store], provide: { store } },
  });
  await flushPromises();
  return w;
};

describe("SecretUsageTab (L4)", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("shows a bound consumer as OK, not as an error", async () => {
    const w = await mountTab([entry({})]);
    const status = w.find("[data-test='secret-usage-row-0-status']");
    expect(status.text()).toBe("OK");
    expect(status.classes().join(" ")).not.toContain("error");
  });

  it("names each consumer's type", async () => {
    const w = await mountTab([
      entry({}),
      entry({
        path: [
          { consumer_type: "synthetics_check", consumer_id: "c1", consumer_name: "checkout-flow" },
        ],
      }),
    ]);
    expect(w.find("[data-test='secret-usage-row-0-type']").text()).toBe("Alert destination");
    expect(w.find("[data-test='secret-usage-row-1-type']").text()).toBe("Synthetics check");
  });

  it("shows the old spelling while a rename is respelled", async () => {
    const w = await mountTab([entry({ token_name: "SNOW_BASIC" })]);
    expect(w.find("[data-test='secret-usage-row-0']").text()).toContain(
      "Spelled SNOW_BASIC, now SERVICENOW_BASIC",
    );
  });
});
