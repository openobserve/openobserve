// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "@/composables/query/queryClient";
import organizations from "./organizations";
import { orgSettingsQuery } from "./organizations.queries";

vi.mock("./organizations", () => ({ default: { get_organization_settings: vi.fn() } }));

const getSettings = organizations.get_organization_settings as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  queryClient.clear();
  getSettings.mockReset();
});

describe("orgSettingsQuery", () => {
  it.each([403, 404])("caches a %s as no settings, asking only once", async (status) => {
    getSettings.mockRejectedValue({ response: { status } });
    expect(await queryClient.fetchQuery(orgSettingsQuery("acme"))).toBeNull();
    expect(await queryClient.fetchQuery(orgSettingsQuery("acme"))).toBeNull();
    expect(getSettings).toHaveBeenCalledTimes(1);
  });

  it("returns the server's settings", async () => {
    getSettings.mockResolvedValue({ data: { data: { scrape_interval: 30 } } });
    expect(await queryClient.fetchQuery(orgSettingsQuery("acme"))).toEqual({
      data: { scrape_interval: 30 },
    });
  });
});
