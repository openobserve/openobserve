// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { buildSlackInstallUrl, getSlackAppClientId, SLACK_APP_BOT_SCOPES } from "./slackAppInstall";

describe("buildSlackInstallUrl", () => {
  it("targets Slack's v2 authorize endpoint", () => {
    const url = new URL(buildSlackInstallUrl("123.456"));
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
  });

  it("carries the given client id", () => {
    const url = new URL(buildSlackInstallUrl("123.456"));
    expect(url.searchParams.get("client_id")).toBe("123.456");
  });

  it("requests the bot scopes as a comma-separated list", () => {
    const url = new URL(buildSlackInstallUrl("123.456"));
    expect(url.searchParams.get("scope")).toBe("channels:history,chat:write,commands");
  });

  it("omits user_scope so no user token is requested", () => {
    const url = new URL(buildSlackInstallUrl("123.456"));
    expect(url.searchParams.has("user_scope")).toBe(false);
  });

  it("falls back to the configured client id", () => {
    const url = new URL(buildSlackInstallUrl());
    expect(url.searchParams.get("client_id")).toBe(getSlackAppClientId());
  });

  it("exposes exactly the three scopes the Slack app declares", () => {
    expect([...SLACK_APP_BOT_SCOPES]).toEqual(["channels:history", "chat:write", "commands"]);
  });
});
