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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, KeepAlive } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { mockMeteringResponse } from "./meteringMock";

let releaseSchema!: (value: unknown) => void;
vi.mock("@/composables/query/queryClient", () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
    fetchQuery: vi.fn(() => new Promise((resolve) => (releaseSchema = resolve))),
  },
}));
vi.mock("./useUsageSearch", () => ({
  useUsageSearch: () => ({ search: vi.fn().mockResolvedValue([]), cancel: vi.fn() }),
}));

const { default: UsageMeterBreakdown } = await import("./UsageMeterBreakdown.vue");
const { queryClient } = await import("@/composables/query/queryClient");

enableAutoUnmount(afterEach);

describe("UsageMeterBreakdown group-by sections", () => {
  it("sends every grouping once the schema is read, marking the unrecorded ones", async () => {
    const wrapper = mount(UsageMeterBreakdown, {
      props: { meterKey: "query", details: mockMeteringResponse().upcoming!, refreshToken: 0 },
      global: { plugins: [i18n, store], stubs: { OTable: true } },
    });
    await flushPromises();

    // Before the schema lands nothing is sent, so the control never shows a list it then greys out.
    expect(wrapper.emitted("sections")).toBeUndefined();

    // This org's usage has streams and alerts, but no user, dashboard or scheduled pipeline yet.
    releaseSchema({
      schema: ["stream_name", "alert_name", "event", "size"].map((name) => ({ name })),
    });
    await flushPromises();

    const [payload] = wrapper.emitted("sections")!.at(-1) as any[];
    expect(payload.sections.map((item: { id: string }) => item.id)).toContain("dashboard");
    expect(payload.unavailable).toEqual(expect.arrayContaining(["user", "dashboard", "scheduled"]));
    expect(payload.unavailable).not.toContain("alert");
    expect(payload.activeId).not.toBe("dashboard");
  });
});

describe("UsageMeterBreakdown kept alive", () => {
  const details = mockMeteringResponse().upcoming!;
  const schema = {
    schema: ["stream_name", "alert_name", "event", "size"].map((name) => ({ name })),
  };

  // The page credits every report to the meter on screen, as the real Overview does.
  const heard: string[] = [];
  const Page = defineComponent({
    props: { meter: { type: String, required: true } },
    setup: (props) => () =>
      h(KeepAlive, null, [
        h(UsageMeterBreakdown, {
          key: props.meter,
          meterKey: props.meter as any,
          details,
          refreshToken: 0,
          onSections: () => heard.push(`sections for ${props.meter}`),
          "onTop-names": () => heard.push(`top-names for ${props.meter}`),
        }),
      ]),
  });

  it("stays quiet while hidden, then reports its results when shown again", async () => {
    const page = mount(Page, {
      props: { meter: "query" },
      global: { plugins: [i18n, store], stubs: { OTable: true } },
    });
    await flushPromises();
    const releaseSearchSchema = releaseSchema;

    // The user moves to Ingestion before Search has read its schema.
    await page.setProps({ meter: "ingestion" });
    await flushPromises();
    releaseSearchSchema(schema);
    await flushPromises();
    expect(heard).toEqual([]);

    // Back on Search, its groupings and top names arrive for the right meter.
    await page.setProps({ meter: "query" });
    await flushPromises();
    expect(heard).toEqual(["sections for query", "top-names for query"]);
  });
});

describe("UsageMeterBreakdown for an org with no bill", () => {
  it("lists volume and share only, with no cost column", async () => {
    const wrapper = mount(UsageMeterBreakdown, {
      props: {
        meterKey: "ingestion",
        details: mockMeteringResponse().upcoming!,
        refreshToken: 0,
        volumeOnly: true,
      },
      global: { plugins: [i18n, store], stubs: { OTable: true } },
    });
    await flushPromises();

    const columns = wrapper.findComponent({ name: "OTable" }).props("columns") as { id: string }[];
    expect(columns.map((column) => column.id)).toEqual(["name", "volume", "share"]);
  });
});

describe("UsageMeterBreakdown inside a member org", () => {
  // In cloud a 401 signs the session out, and a super org admin need not belong to its members.
  const listKeys = () =>
    (queryClient.fetchQuery as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
      JSON.stringify((call[0] as { queryKey: unknown }).queryKey),
    );

  const openPipelines = async (memberIsMine: boolean) => {
    (queryClient.fetchQuery as ReturnType<typeof vi.fn>).mockClear();
    store.state.organizations = memberIsMine
      ? [{ identifier: "member-org", name: "Member" }]
      : [{ identifier: store.state.selectedOrganization.identifier, name: "Payer" }];
    mount(UsageMeterBreakdown, {
      props: {
        meterKey: "pipeline",
        details: mockMeteringResponse().upcoming!,
        refreshToken: 0,
        scopeOrgId: "member-org",
      },
      global: { plugins: [i18n, store], stubs: { OTable: true } },
    });
    releaseSchema({ schema: ["stream_name", "event", "size"].map((name) => ({ name })) });
    await flushPromises();
  };

  it("does not ask a member org the admin does not belong to for its pipeline names", async () => {
    await openPipelines(false);
    expect(listKeys().some((key) => key.includes("member-org"))).toBe(false);
  });

  it("still names the pipelines of a member org the admin belongs to", async () => {
    await openPipelines(true);
    expect(listKeys().some((key) => key.includes("member-org"))).toBe(true);
  });
});
