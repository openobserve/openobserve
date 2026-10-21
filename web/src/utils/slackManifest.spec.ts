// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import {
  buildSlackManifest,
  buildSlackManifestUrl,
  buildSlackManifestUrlFrom,
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

describe("buildSlackManifestUrlFrom", () => {
  // Shape of the server-built two-way manifest (spec section 8.2), trimmed.
  const serverManifest = {
    display_information: { name: "OpenObserve" },
    features: {
      bot_user: { display_name: "OpenObserve", always_online: true },
      app_home: { home_tab_enabled: true, messages_tab_enabled: true },
      slash_commands: [{ command: "/o2", description: "Ask OpenObserve" }],
    },
    oauth_config: {
      redirect_urls: ["https://o2.example.com/web/slack/oauth/callback"],
      scopes: { bot: ["app_mentions:read", "chat:write", "im:history"], user: ["openid"] },
    },
    settings: {
      event_subscriptions: { bot_events: ["app_mention", "message.im"] },
      interactivity: { is_enabled: true },
      org_deploy_enabled: true,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  };

  it("embeds any server manifest unchanged in Slack's documented deep link", () => {
    const url = new URL(buildSlackManifestUrlFrom(serverManifest));

    expect(`${url.origin}${url.pathname}`).toBe("https://api.slack.com/apps");
    expect(url.searchParams.get("new_app")).toBe("1");
    expect(JSON.parse(url.searchParams.get("manifest_json") ?? "")).toEqual(serverManifest);
  });

  it("produces the webhook builder's exact link for the webhook manifest", () => {
    expect(buildSlackManifestUrlFrom(buildSlackManifest("  Ops  "))).toBe(
      buildSlackManifestUrl("  Ops  "),
    );
  });

  it("percent-encodes characters that would break the query string", () => {
    const manifestUrl = buildSlackManifestUrlFrom({
      display_information: { name: "Ops & Alerts #1 = 100%?" },
    });

    expect(manifestUrl).not.toMatch(/[ #]/);
    expect(manifestUrl.split("&")).toHaveLength(2);
    expect(
      JSON.parse(new URL(manifestUrl).searchParams.get("manifest_json") ?? "").display_information
        .name,
    ).toBe("Ops & Alerts #1 = 100%?");
  });
});
