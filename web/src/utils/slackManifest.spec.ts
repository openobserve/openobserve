// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ONCALL_SLACK_APP_NAME,
  buildOncallSlackManifest,
  buildSlackManifest,
  buildSlackManifestUrl,
  slackBotDisplayName,
  slackManifestJson,
} from "./slackManifest";

describe("Slack app manifest", () => {
  it("builds the exact least-privilege incoming-webhook manifest", () => {
    expect(buildSlackManifest("OpenObserve Alerts")).toEqual({
      _metadata: {
        major_version: 1,
        minor_version: 1,
      },
      display_information: {
        name: "OpenObserve Alerts",
        description: "Send OpenObserve alert notifications to Slack",
      },
      features: {
        bot_user: {
          display_name: "OpenObserve Alerts",
          always_online: false,
        },
      },
      oauth_config: {
        scopes: {
          bot: ["incoming-webhook"],
        },
      },
      settings: {
        incoming_webhooks: {
          incoming_webhooks_enabled: true,
        },
        org_deploy_enabled: false,
        socket_mode_enabled: false,
        token_rotation_enabled: false,
      },
    });
  });

  it("contains no credentials, callback, message-reading, or broader write access", () => {
    const serialized = slackManifestJson("OpenObserve Alerts");

    expect(serialized).not.toMatch(
      /client_secret|access_token|bot_token|webhook_url|redirect_urls|event_subscriptions/i,
    );
    expect(serialized).not.toContain("chat:write");
    expect(serialized).not.toContain("channels:history");
    expect(serialized).not.toContain("groups:history");
  });

  it("trims the app name and embeds the exact manifest in Slack's documented deep link", () => {
    const manifest = buildSlackManifest("  Operations Alerts  ");
    const manifestUrl = buildSlackManifestUrl("  Operations Alerts  ");
    const url = new URL(manifestUrl);

    expect(manifest.display_information.name).toBe("Operations Alerts");
    expect(manifest.features.bot_user.display_name).toBe("Operations Alerts");
    expect(`${url.origin}${url.pathname}`).toBe("https://api.slack.com/apps");
    expect(url.searchParams.get("new_app")).toBe("1");
    expect(JSON.parse(url.searchParams.get("manifest_json") ?? "")).toEqual(manifest);
    expect(manifestUrl).toBe(
      `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(
        JSON.stringify(manifest),
      )}`,
    );
  });
});

describe("On-call Slack app manifest", () => {
  // IN-4: the four bot scopes, /oncall, interactivity and the OAuth redirect, all at this deployment.
  it("builds the exact on-call manifest with this deployment's URLs and no events", () => {
    const urls = {
      command_url: "https://o2.example.com/api/v2/oncall/chat/slack/command",
      interact_url: "https://o2.example.com/api/v2/oncall/chat/slack/interact",
      redirect_url: "https://o2.example.com/web/slack/oauth/callback",
    };

    expect(buildOncallSlackManifest(`  ${DEFAULT_ONCALL_SLACK_APP_NAME}  `, urls)).toEqual({
      display_information: {
        name: "OpenObserve",
      },
      features: {
        bot_user: {
          display_name: "openobserve",
          always_online: true,
        },
        app_home: {
          messages_tab_enabled: true,
          messages_tab_read_only_enabled: true,
        },
        slash_commands: [
          {
            command: "/oncall",
            url: "https://o2.example.com/api/v2/oncall/chat/slack/command",
            description: "On-call: who is on, link your account, set a team's channel",
            should_escape: false,
          },
        ],
      },
      oauth_config: {
        redirect_urls: ["https://o2.example.com/web/slack/oauth/callback"],
        scopes: {
          bot: ["chat:write", "commands", "users:read", "users:read.email"],
        },
      },
      settings: {
        interactivity: {
          is_enabled: true,
          request_url: "https://o2.example.com/api/v2/oncall/chat/slack/interact",
        },
        org_deploy_enabled: false,
        socket_mode_enabled: false,
        token_rotation_enabled: false,
      },
    });
  });
});

describe("Slack bot display name", () => {
  // Slack allows only lowercase letters, digits, hyphens, underscores and periods here.
  it.each([
    ["OpenObserve", "openobserve"],
    ["  Ops   Alerts  ", "ops-alerts"],
    ["On-call (EU) #1", "on-call-eu-1"],
    ["o2_bot.v2", "o2_bot.v2"],
    ["a".repeat(100), "a".repeat(80)],
  ])("turns %j into %j", (appName, displayName) => {
    expect(slackBotDisplayName(appName)).toBe(displayName);
  });
});
