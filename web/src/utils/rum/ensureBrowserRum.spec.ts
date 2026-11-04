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

const rumInit = vi.hoisted(() => vi.fn());
const rumSdk = vi.hoisted(() => ({
  setUser: vi.fn(),
  startSessionReplayRecording: vi.fn(),
}));
const logsInit = vi.hoisted(() => vi.fn());
const getConfigFull = vi.hoisted(() => vi.fn());

vi.mock("@openobserve/browser-rum", () => ({ openobserveRum: { init: rumInit, ...rumSdk } }));
vi.mock("@openobserve/browser-logs", () => ({ openobserveLogs: { init: logsInit } }));
vi.mock("@/services/config", () => ({ default: { get_config_full: getConfigFull } }));

import { queryClient } from "@/composables/query/queryClient";
import store from "@/stores";
import { resetBrowserRumForTests } from "./initBrowserRum";
import { ensureBrowserRum } from "./ensureBrowserRum";

const RUM = {
  enabled: true,
  client_token: "token",
  application_id: "app",
  site: "rum.example.com",
  service: "web",
  env: "test",
  organization_identifier: "org",
};

const USER = { email: "user@example.com", given_name: "Ada", family_name: "Lovelace" };

beforeEach(() => {
  resetBrowserRumForTests();
  queryClient.clear();
  rumInit.mockReset();
  logsInit.mockReset();
  Object.values(rumSdk).forEach((fn) => fn.mockReset());
  store.state.userInfo = USER;
  getConfigFull.mockReset();
  getConfigFull.mockResolvedValue({ data: { version: "v1", rum: RUM } });
});

describe("ensureBrowserRum", () => {
  it("starts RUM from the org's full config and identifies the user without replay", async () => {
    await ensureBrowserRum("acme");

    expect(getConfigFull).toHaveBeenCalledWith("acme");
    expect(rumInit).toHaveBeenCalledTimes(1);
    expect(logsInit).toHaveBeenCalledTimes(1);
    expect(rumSdk.setUser).toHaveBeenCalledWith({
      id: "user@example.com",
      name: "Ada Lovelace",
      email: "user@example.com",
    });
    expect(rumSdk.startSessionReplayRecording).not.toHaveBeenCalled();
  });

  it("does not fetch the config again once RUM has started", async () => {
    await ensureBrowserRum("acme");
    await ensureBrowserRum("beta");

    expect(getConfigFull).toHaveBeenCalledTimes(1);
    expect(rumInit).toHaveBeenCalledTimes(1);
  });

  it("does nothing without an org", async () => {
    await ensureBrowserRum(undefined);
    await ensureBrowserRum("");

    expect(getConfigFull).not.toHaveBeenCalled();
    expect(rumInit).not.toHaveBeenCalled();
  });

  it("neither starts RUM nor sets the user when the full config has it disabled", async () => {
    getConfigFull.mockResolvedValue({ data: { version: "v1", rum: { ...RUM, enabled: false } } });

    await ensureBrowserRum("acme");

    expect(rumInit).not.toHaveBeenCalled();
    expect(rumSdk.setUser).not.toHaveBeenCalled();
  });

  it("never rejects when the full config cannot be fetched", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    getConfigFull.mockRejectedValue(new Error("403"));

    await expect(ensureBrowserRum("acme")).resolves.toBeUndefined();

    expect(rumInit).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
