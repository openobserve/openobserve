// Copyright 2026 OpenObserve Inc.

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
  `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(
    JSON.stringify(buildSlackManifest(appName)),
  )}`;
