// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { buildSlackManifest, buildSlackManifestUrl, slackManifestJson } from "./slackManifest";

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
