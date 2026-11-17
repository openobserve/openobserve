// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "@/composables/query/queryClient";
import settings from "./settings";
import { settingQuery } from "./settings.queries";

vi.mock("./settings", () => ({ default: { getSetting: vi.fn() } }));

const getSetting = settings.getSetting as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  queryClient.clear();
  getSetting.mockReset();
});

describe("settingQuery", () => {
  it.each([403, 404])("caches a %s as null so the next read does not ask again", async (status) => {
    getSetting.mockRejectedValue({ response: { status } });
    expect(await queryClient.fetchQuery(settingQuery("acme", "home"))).toBeNull();
    expect(await queryClient.fetchQuery(settingQuery("acme", "home"))).toBeNull();
    expect(getSetting).toHaveBeenCalledTimes(1);
  });

  it("still fails on a server error", async () => {
    getSetting.mockRejectedValue({ response: { status: 400 } });
    await expect(queryClient.fetchQuery(settingQuery("acme", "home"))).rejects.toBeTruthy();
  });
});
