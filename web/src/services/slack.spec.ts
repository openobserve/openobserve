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

import http from "./http";
import slack from "./slack";

vi.mock("./http", () => {
  const ok = () => Promise.resolve({ data: {} });
  const mockClient = {
    get: vi.fn(ok),
    post: vi.fn(ok),
    put: vi.fn(ok),
    delete: vi.fn(ok),
  };
  return { default: vi.fn(() => mockClient) };
});

const client = (http as unknown as ReturnType<typeof vi.fn>)();
const ORG = "acme";
const ID = "inst-1";
const BASE = `/api/${ORG}/slack`;

type Method = "get" | "post" | "put" | "delete";
type Case = [label: string, call: () => Promise<unknown>, method: Method, args: unknown[]];

const cases: Case[] = [
  [
    "row 1 install/start",
    () => slack.installStart(ORG, { source: "settings" }),
    "post",
    [`${BASE}/install/start`, { source: "settings" }],
  ],
  [
    "row 2 install/exchange",
    () => slack.installExchange(ORG, { code: "c", state: "s" }),
    "post",
    [`${BASE}/install/exchange`, { code: "c", state: "s" }],
  ],
  ["row 3 prerequisites", () => slack.getPrerequisites(ORG), "get", [`${BASE}/prerequisites`]],
  [
    "row 4 connectivity",
    () => slack.checkConnectivity(ORG, { installation_id: ID }),
    "post",
    [`${BASE}/connectivity`, { installation_id: ID }],
  ],
  [
    "row 5 manifest",
    () => slack.getManifest(ORG, { mode: "socket", name: "OpenObserve", channel_history: false }),
    "get",
    [
      `${BASE}/manifest`,
      { params: { mode: "socket", name: "OpenObserve", channel_history: false } },
    ],
  ],
  [
    "row 6 create installation",
    () => slack.createInstallation(ORG, { mode: "socket", config_refresh_token: "xoxe-1" }),
    "post",
    [`${BASE}/installations`, { mode: "socket", config_refresh_token: "xoxe-1" }],
  ],
  [
    "row 7 install-url",
    () => slack.getInstallUrl(ORG, ID),
    "post",
    [`${BASE}/installations/${ID}/install-url`],
  ],
  [
    "row 8 credentials",
    () => slack.updateCredentials(ORG, ID, { config_refresh_token: null }),
    "put",
    [`${BASE}/installations/${ID}/credentials`, { config_refresh_token: null }],
  ],
  [
    "row 10 test",
    () => slack.testInstallation(ORG, ID, { channel_id: "C1" }),
    "post",
    [`${BASE}/installations/${ID}/test`, { channel_id: "C1" }],
  ],
  [
    "row 11 GET linking",
    () => slack.getLinking(ORG, ID),
    "get",
    [`${BASE}/installations/${ID}/linking`],
  ],
  [
    "row 11 PUT linking",
    () => slack.updateLinking(ORG, ID, { enabled: true, domains: ["acme.com"] }),
    "put",
    [`${BASE}/installations/${ID}/linking`, { enabled: true, domains: ["acme.com"] }],
  ],
  [
    "row 12 link matches",
    () => slack.listLinkMatches(ORG, ID, "cur"),
    "get",
    [`${BASE}/installations/${ID}/links/matches`, { params: { cursor: "cur" } }],
  ],
  [
    "row 13 link-all",
    () => slack.linkAll(ORG, ID),
    "post",
    [`${BASE}/installations/${ID}/link-all`],
  ],
  [
    "row 14 connection/start",
    () => slack.startConnection(ORG, ID, { purpose: "test" }),
    "post",
    [`${BASE}/installations/${ID}/connection/start`, { purpose: "test" }],
  ],
  [
    "row 15 connection/confirm",
    () => slack.confirmConnection(ORG, { oidc_code: "c", oidc_state: "s" }),
    "post",
    [`${BASE}/connection/confirm`, { oidc_code: "c", oidc_state: "s" }],
  ],
  [
    "row 16 connect",
    () => slack.connectInstallation(ORG, ID, { connect_ticket: "t" }),
    "post",
    [`${BASE}/installations/${ID}/connection`, { connect_ticket: "t" }],
  ],
  [
    "row 17 disconnect",
    () => slack.disconnectInstallation(ORG, ID),
    "delete",
    [`${BASE}/installations/${ID}/connection`],
  ],
  [
    "row 19 uninstall",
    () => slack.uninstallInstallation(ORG, ID),
    "delete",
    [`${BASE}/installations/${ID}`],
  ],
  [
    "row 20 channels",
    () => slack.listChannels(ORG, ID, { q: "ale", cursor: "cur" }),
    "get",
    [`${BASE}/installations/${ID}/channels`, { params: { q: "ale", cursor: "cur" } }],
  ],
  [
    "row 21 channel defaults",
    () => slack.listChannelDefaults(ORG, ID),
    "get",
    [`${BASE}/installations/${ID}/channel-defaults`],
  ],
  [
    "row 22 GET channel default",
    () => slack.getChannelDefault(ORG, ID, "C1"),
    "get",
    [`${BASE}/installations/${ID}/channel-defaults/C1`],
  ],
  [
    "row 22 PUT channel default",
    () => slack.putChannelDefault(ORG, ID, "C1", { org_id: ORG, answer_mode: "private" }),
    "put",
    [`${BASE}/installations/${ID}/channel-defaults/C1`, { org_id: ORG, answer_mode: "private" }],
  ],
  [
    "row 22 DELETE channel default",
    () => slack.deleteChannelDefault(ORG, ID, "C1"),
    "delete",
    [`${BASE}/installations/${ID}/channel-defaults/C1`],
  ],
  [
    "row 23 GET help contact",
    () => slack.getHelpContact(ORG, ID),
    "get",
    [`${BASE}/installations/${ID}/help-contact`],
  ],
  [
    "row 23 PUT help contact",
    () => slack.putHelpContact(ORG, ID, { help_contact: "#ops" }),
    "put",
    [`${BASE}/installations/${ID}/help-contact`, { help_contact: "#ops" }],
  ],
  [
    "7.3 link request start",
    () => slack.startLinkRequest(ORG, "req-1", { sig: "sg" }),
    "post",
    [`${BASE}/link-requests/req-1/start`, { sig: "sg" }],
  ],
  [
    "7.3 link request confirm",
    () => slack.confirmLinkRequest(ORG, { oidc_code: "c", oidc_state: "s" }),
    "post",
    [`${BASE}/link-requests/confirm`, { oidc_code: "c", oidc_state: "s" }],
  ],
  [
    "7.3 link request resend",
    () => slack.resendLinkRequest(ORG, "req-1", { sig: "sg" }),
    "post",
    [`${BASE}/link-requests/req-1/resend`, { sig: "sg" }],
  ],
  ["7.3 links/me", () => slack.getMyLinks(ORG), "get", [`${BASE}/links/me`]],
  ["7.3 unlink", () => slack.deleteLink(ORG, "link-1"), "delete", [`${BASE}/links/link-1`]],
  [
    "7.3 links list",
    () => slack.listLinks(ORG, { installation_id: ID, cursor: "cur" }),
    "get",
    [`${BASE}/links`, { params: { installation_id: ID, cursor: "cur" } }],
  ],
];

describe("slack service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(cases)("%s hits the right method, path and body", async (_label, call, method, args) => {
    await call();

    expect(client[method]).toHaveBeenCalledTimes(1);
    expect(client[method]).toHaveBeenCalledWith(...args);
  });

  it("routes nothing for the deferred home-region move (row 18)", () => {
    expect(Object.keys(slack).some((name) => /home.?region/i.test(name))).toBe(false);
  });

  it("lists installations with the caller's silentForbidden flag for background calls", async () => {
    await slack.listInstallations(ORG, { silentForbidden: true });
    expect(client.get).toHaveBeenCalledWith(`${BASE}/installations`, { silentForbidden: true });

    await slack.listInstallations(ORG);
    expect(client.get).toHaveBeenLastCalledWith(`${BASE}/installations`, undefined);
  });

  it("encodes org, installation, channel and link ids into the path", async () => {
    await slack.getChannelDefault("a/b", "i d", "C#1");
    await slack.deleteLink("a/b", "l?1");

    expect(client.get).toHaveBeenCalledWith(
      "/api/a%2Fb/slack/installations/i%20d/channel-defaults/C%231",
    );
    expect(client.delete).toHaveBeenCalledWith("/api/a%2Fb/slack/links/l%3F1");
  });

  it("omits absent or first-page paging params instead of sending empty strings", async () => {
    await slack.listLinkMatches(ORG, ID, "");
    await slack.listChannels(ORG, ID, { q: "", cursor: "" });
    await slack.listLinks(ORG, { cursor: "" });

    expect(client.get).toHaveBeenNthCalledWith(1, `${BASE}/installations/${ID}/links/matches`, {
      params: {},
    });
    expect(client.get).toHaveBeenNthCalledWith(2, `${BASE}/installations/${ID}/channels`, {
      params: {},
    });
    expect(client.get).toHaveBeenNthCalledWith(3, `${BASE}/links`, { params: {} });
  });

  it("returns the response untouched so callers read `data`", async () => {
    client.post.mockResolvedValueOnce({ data: { authorization_url: "https://slack.com/x" } });

    const res = await slack.installStart(ORG, { source: "destination_form" });

    expect(res.data.authorization_url).toBe("https://slack.com/x");
  });
});
