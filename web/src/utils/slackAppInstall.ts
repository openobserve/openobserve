// Copyright 2026 OpenObserve Inc.

const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";

// Public app id (it ships in every install URL), overridable so a fork or a
// self-hosted deployment can point the button at its own Slack app.
const DEFAULT_SLACK_APP_CLIENT_ID = "8813870305985.12123050003686";

export const SLACK_APP_BOT_SCOPES = ["channels:history", "chat:write", "commands"] as const;

export const getSlackAppClientId = (): string => {
  const configured = import.meta.env.VITE_SLACK_APP_CLIENT_ID;
  return typeof configured === "string" && configured.trim().length > 0
    ? configured.trim()
    : DEFAULT_SLACK_APP_CLIENT_ID;
};

export const buildSlackInstallUrl = (clientId: string = getSlackAppClientId()): string => {
  const url = new URL(SLACK_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SLACK_APP_BOT_SCOPES.join(","));
  return url.toString();
};
