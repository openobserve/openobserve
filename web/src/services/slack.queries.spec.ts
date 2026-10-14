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
import { queryClient } from "@/composables/query/queryClient";
import { destinationKeys } from "./alert_destination.querykeys";
import slack from "./slack";
import {
  confirmConnectionMutation,
  confirmLinkRequestMutation,
  connectInstallationMutation,
  deleteChannelDefaultMutation,
  deleteLinkMutation,
  disconnectInstallationMutation,
  installExchangeMutation,
  linkAllMutation,
  putChannelDefaultMutation,
  putHelpContactMutation,
  slackChannelsQuery,
  slackInstallationsQuery,
  slackLinkMatchesQuery,
  slackLinksQuery,
  slackManifestQuery,
  slackMyLinksQuery,
  uninstallInstallationMutation,
  updateCredentialsMutation,
  updateLinkingMutation,
  createInstallationMutation,
} from "./slack.queries";
import { slackKeys } from "./slack.querykeys";

vi.mock("./slack", () => {
  const ok = () => Promise.resolve({ data: {} });
  const names = [
    "installExchange",
    "createInstallation",
    "updateCredentials",
    "listInstallations",
    "updateLinking",
    "listLinkMatches",
    "linkAll",
    "confirmConnection",
    "connectInstallation",
    "disconnectInstallation",
    "uninstallInstallation",
    "listChannels",
    "putChannelDefault",
    "deleteChannelDefault",
    "putHelpContact",
    "confirmLinkRequest",
    "getMyLinks",
    "deleteLink",
    "listLinks",
    "getManifest",
  ];
  return { default: Object.fromEntries(names.map((name) => [name, vi.fn(ok)])) };
});

const ORG = "acme";
const OTHER = "other-org";
const ID = "inst-1";
const ID2 = "inst-2";

// Runs a mutation through the real MutationCache, so its `meta.invalidates` goes through the same key matching the app uses.
const run = async (options: any, variables: unknown) => {
  const mutation = queryClient.getMutationCache().build(queryClient, options);
  await mutation.execute(variables);
};

const isInvalidated = (queryKey: readonly unknown[]) =>
  queryClient.getQueryState(queryKey)?.isInvalidated ?? false;

const seeded = [
  slackKeys.installations(ORG),
  slackKeys.linking(ORG, ID),
  slackKeys.linking(ORG, ID2),
  slackKeys.linkMatches(ORG, ID),
  slackKeys.channelDefaults(ORG, ID),
  slackKeys.channelDefault(ORG, ID, "C1"),
  slackKeys.channelDefaults(ORG, ID2),
  slackKeys.helpContact(ORG, ID),
  slackKeys.linksMe(ORG),
  slackKeys.links(ORG, ID),
  slackKeys.installations(OTHER),
  destinationKeys.list(ORG, "alert"),
];

describe("slackKeys", () => {
  it("roots every key at the org and under the domain's `all` scope", () => {
    const all = slackKeys.all(ORG);
    for (const key of seeded.slice(0, 10)) {
      expect(key.slice(0, all.length)).toEqual([...all]);
    }
    expect(all).toEqual(["org", ORG, "slack"]);
  });

  it("keeps one installation's entries apart from another's and from the list", () => {
    const one = slackKeys.installation(ORG, ID);
    expect(slackKeys.linking(ORG, ID).slice(0, one.length)).toEqual([...one]);
    expect(slackKeys.linking(ORG, ID2).slice(0, one.length)).not.toEqual([...one]);
    expect(slackKeys.installations(ORG).slice(0, one.length)).not.toEqual([...one]);
  });

  it("puts query inputs in the key so two searches never share an entry", () => {
    expect(slackKeys.channels(ORG, ID, "ale")).not.toEqual(slackKeys.channels(ORG, ID, "ops"));
    expect(slackKeys.manifest(ORG, { mode: "socket", name: "A" })).not.toEqual(
      slackKeys.manifest(ORG, { mode: "http", name: "A" }),
    );
    expect(slackKeys.links(ORG, ID)).not.toEqual(slackKeys.links(ORG));
  });
});

describe("slack queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes silentForbidden through for background callers only", async () => {
    await (slackInstallationsQuery(ORG, { silentForbidden: true }).queryFn as any)();
    expect(slack.listInstallations).toHaveBeenLastCalledWith(ORG, { silentForbidden: true });

    await (slackInstallationsQuery(ORG).queryFn as any)();
    expect(slack.listInstallations).toHaveBeenLastCalledWith(ORG, undefined);
    expect(slackInstallationsQuery(ORG).queryKey).toEqual(slackKeys.installations(ORG));
  });

  it("pages cursor lists by `next_cursor` and stops on an empty cursor", () => {
    for (const options of [
      slackLinkMatchesQuery(ORG, ID),
      slackChannelsQuery(ORG, ID, "ale"),
      slackLinksQuery(ORG, ID),
    ]) {
      const next = options.getNextPageParam as (last: { next_cursor: string | null }) => unknown;
      expect(options.initialPageParam).toBe("");
      expect(next({ next_cursor: "c2" })).toBe("c2");
      expect(next({ next_cursor: "" })).toBeUndefined();
      expect(next({ next_cursor: null })).toBeUndefined();
    }
  });

  it("sends the page cursor and search text to the service", async () => {
    vi.mocked(slack.listChannels).mockResolvedValueOnce({
      data: { channels: [], next_cursor: null },
    } as any);
    await (slackChannelsQuery(ORG, ID, "ale").queryFn as any)({ pageParam: "c2" });
    expect(slack.listChannels).toHaveBeenCalledWith(ORG, ID, { q: "ale", cursor: "c2" });

    await (slackLinkMatchesQuery(ORG, ID).queryFn as any)({ pageParam: "" });
    expect(slack.listLinkMatches).toHaveBeenCalledWith(ORG, ID, "");

    await (slackLinksQuery(ORG, ID).queryFn as any)({ pageParam: "c3" });
    expect(slack.listLinks).toHaveBeenCalledWith(ORG, { installation_id: ID, cursor: "c3" });
  });

  it("asks for the manifest with the chosen mode, name and history option", async () => {
    const params = { mode: "http" as const, name: "OpenObserve", channel_history: false };
    await (slackManifestQuery(ORG, params).queryFn as any)();
    expect(slack.getManifest).toHaveBeenCalledWith(ORG, params);
    expect(slackMyLinksQuery(ORG).queryKey).toEqual(slackKeys.linksMe(ORG));
  });
});

describe("slack mutations", () => {
  beforeEach(() => {
    queryClient.clear();
    for (const key of seeded) queryClient.setQueryData(key, {});
  });

  const invalidatedOf = () => seeded.filter((key) => isInvalidated(key));

  it.each([
    ["install exchange", () => installExchangeMutation(ORG), { code: "c", state: "s" }],
    [
      "connect",
      () => connectInstallationMutation(ORG),
      { installationId: ID, body: { connect_ticket: "t" } },
    ],
    ["disconnect", () => disconnectInstallationMutation(ORG), ID],
    ["uninstall", () => uninstallInstallationMutation(ORG), ID],
  ])("%s drops every Slack entry of the org and its destinations", async (_l, build, vars) => {
    await run(build(), vars);

    expect(invalidatedOf()).toEqual(seeded.filter((key) => key[1] === ORG));
  });

  it.each([
    [
      "create installation",
      () => createInstallationMutation(ORG),
      { mode: "socket", config_refresh_token: "x" },
    ],
    [
      "connection confirm",
      () => confirmConnectionMutation(ORG),
      { oidc_code: "c", oidc_state: "s" },
    ],
    ["unlink", () => deleteLinkMutation(ORG), "link-1"],
  ])("%s drops the org's Slack entries but not its destinations", async (_l, build, vars) => {
    await run(build(), vars);

    expect(invalidatedOf()).toEqual(seeded.filter((key) => key[1] === ORG && key[2] === "slack"));
  });

  it("update credentials drops the installations list and that installation only", async () => {
    await run(updateCredentialsMutation(ORG, ID), { app_token: "xapp-1" });

    expect(isInvalidated(slackKeys.installations(ORG))).toBe(true);
    expect(isInvalidated(slackKeys.linking(ORG, ID))).toBe(true);
    expect(isInvalidated(slackKeys.linking(ORG, ID2))).toBe(false);
    expect(isInvalidated(slackKeys.linksMe(ORG))).toBe(false);
  });

  it.each([
    ["linking", () => updateLinkingMutation(ORG, ID), { enabled: true }],
    ["link all", () => linkAllMutation(ORG, ID), undefined],
  ])("%s drops that installation's linking, matches and the links list", async (_l, build, v) => {
    await run(build(), v);

    expect(isInvalidated(slackKeys.linking(ORG, ID))).toBe(true);
    expect(isInvalidated(slackKeys.linkMatches(ORG, ID))).toBe(true);
    expect(isInvalidated(slackKeys.links(ORG, ID))).toBe(true);
    expect(isInvalidated(slackKeys.linking(ORG, ID2))).toBe(false);
    expect(isInvalidated(slackKeys.channelDefaults(ORG, ID))).toBe(true);
  });

  it.each([
    [
      "put",
      () => putChannelDefaultMutation(ORG, ID),
      { channelId: "C1", body: { org_id: ORG, answer_mode: "thread" } },
    ],
    ["delete", () => deleteChannelDefaultMutation(ORG, ID), "C1"],
  ])("%s channel default drops only that installation's defaults", async (_l, build, vars) => {
    await run(build(), vars);

    expect(invalidatedOf()).toEqual([
      slackKeys.channelDefaults(ORG, ID),
      slackKeys.channelDefault(ORG, ID, "C1"),
    ]);
  });

  it("help contact drops only that installation's help contact", async () => {
    await run(putHelpContactMutation(ORG, ID), "#ops");

    expect(slack.putHelpContact).toHaveBeenCalledWith(ORG, ID, { help_contact: "#ops" });
    expect(invalidatedOf()).toEqual([slackKeys.helpContact(ORG, ID)]);
  });

  it("link confirm drops the caller's own links and renders its errors itself", async () => {
    const options = confirmLinkRequestMutation(ORG);
    await run(options, { oidc_code: "c", oidc_state: "s" });

    expect(isInvalidated(slackKeys.linksMe(ORG))).toBe(true);
    expect(options.meta?.silentError).toBe(true);
  });

  it("the popup flows render their own errors, so their writes stay silent", () => {
    expect(installExchangeMutation(ORG).meta?.silentError).toBe(true);
    expect(confirmConnectionMutation(ORG).meta?.silentError).toBe(true);
  });

  it("calls the service with the mutation variables", async () => {
    await run(connectInstallationMutation(ORG), {
      installationId: ID,
      body: { connect_ticket: "t" },
    });
    await run(putChannelDefaultMutation(ORG, ID), {
      channelId: "C1",
      body: { org_id: ORG, answer_mode: "thread" },
    });

    expect(slack.connectInstallation).toHaveBeenCalledWith(ORG, ID, { connect_ticket: "t" });
    expect(slack.putChannelDefault).toHaveBeenCalledWith(ORG, ID, "C1", {
      org_id: ORG,
      answer_mode: "thread",
    });
  });
});
