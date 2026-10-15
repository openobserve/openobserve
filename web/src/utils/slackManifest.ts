// Copyright 2026 OpenObserve Inc.

import type { SlackManifestUrls } from "@/ts/interfaces/oncall";

export const DEFAULT_SLACK_APP_NAME = "OpenObserve Alerts";
export const SLACK_APP_NAME_MAX_LENGTH = 35;

export interface SlackAppManifest {
  _metadata: {
    major_version: 1;
    minor_version: 1;
  };
  display_information: {
    name: string;
    description: string;
  };
  features: {
    bot_user: {
      display_name: string;
      always_online: false;
    };
  };
  oauth_config: {
    scopes: {
      bot: ["incoming-webhook"];
    };
  };
  settings: {
    incoming_webhooks: {
      incoming_webhooks_enabled: true;
    };
    org_deploy_enabled: false;
    socket_mode_enabled: false;
    token_rotation_enabled: false;
  };
}

export const buildSlackManifest = (appName: string): SlackAppManifest => {
  const trimmedAppName = appName.trim();

  return {
    _metadata: {
      major_version: 1,
      minor_version: 1,
    },
    display_information: {
      name: trimmedAppName,
      description: "Send OpenObserve alert notifications to Slack",
    },
    // Slack rejects a manifest that requests bot scopes without declaring a bot user.
    features: {
      bot_user: {
        display_name: trimmedAppName,
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
  };
};

export const slackManifestJson = (appName: string): string =>
  JSON.stringify(buildSlackManifest(appName), null, 2);

export const buildSlackManifestUrl = (appName: string): string =>
  slackNewAppUrl(buildSlackManifest(appName));

// Slack's documented deep link that opens "Create an app" prefilled with a manifest.
export const slackNewAppUrl = (manifest: object): string =>
  `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(
    JSON.stringify(manifest),
  )}`;

// The on-call Slack app's name in the manifest the _meta page builds.
export const DEFAULT_ONCALL_SLACK_APP_NAME = "OpenObserve";

// Slack's longest bot display name (https://docs.slack.dev/reference/app-manifest).
const SLACK_BOT_DISPLAY_NAME_MAX_LENGTH = 80;

// The deployment's one on-call Slack app; field names per https://docs.slack.dev/reference/app-manifest.
export interface OncallSlackAppManifest {
  display_information: {
    name: string;
  };
  features: {
    bot_user: {
      display_name: string;
      always_online: true;
    };
    app_home: {
      messages_tab_enabled: true;
      messages_tab_read_only_enabled: true;
    };
    slash_commands: {
      command: "/oncall";
      url: string;
      description: string;
      should_escape: false;
    }[];
  };
  oauth_config: {
    redirect_urls: string[];
    scopes: {
      bot: ["chat:write", "commands", "users:read", "users:read.email"];
    };
  };
  settings: {
    interactivity: {
      is_enabled: true;
      request_url: string;
    };
    org_deploy_enabled: false;
    socket_mode_enabled: false;
    token_rotation_enabled: false;
  };
}

// Slack's bot display name allows only a-z 0-9 - _ . (https://docs.slack.dev/reference/app-manifest).
export const slackBotDisplayName = (appName: string): string =>
  appName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, SLACK_BOT_DISPLAY_NAME_MAX_LENGTH);

// Builds the on-call Slack app manifest pointing at this deployment's URLs (C25, IN-4).
export const buildOncallSlackManifest = (
  appName: string,
  urls: SlackManifestUrls,
): OncallSlackAppManifest => {
  const trimmedAppName = appName.trim();

  return {
    display_information: {
      name: trimmedAppName,
    },
    features: {
      bot_user: {
        display_name: slackBotDisplayName(trimmedAppName),
        always_online: true,
      },
      app_home: {
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: true,
      },
      slash_commands: [
        {
          command: "/oncall",
          url: urls.command_url,
          description: "On-call: who is on, link your account, set a team's channel",
          should_escape: false,
        },
      ],
    },
    // Must match the server's REQUIRED_SCOPES, which refuses an install missing any of them.
    oauth_config: {
      redirect_urls: [urls.redirect_url],
      scopes: {
        bot: ["chat:write", "commands", "users:read", "users:read.email"],
      },
    },
    settings: {
      interactivity: {
        is_enabled: true,
        request_url: urls.interact_url,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
};
