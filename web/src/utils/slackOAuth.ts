// Copyright 2026 OpenObserve Inc.

export const SLACK_OAUTH_MESSAGE_TYPE = "openobserve:slack-oauth" as const;

export type SlackOAuthCallbackMessage =
  | {
      type: typeof SLACK_OAUTH_MESSAGE_TYPE;
      code: string;
      state: string;
    }
  | {
      type: typeof SLACK_OAUTH_MESSAGE_TYPE;
      error: string;
    };

export const isSlackOAuthCallbackMessage = (value: unknown): value is SlackOAuthCallbackMessage => {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.type !== SLACK_OAUTH_MESSAGE_TYPE) return false;
  if (typeof message.error === "string" && message.error.length > 0) return true;
  return (
    typeof message.code === "string" &&
    message.code.length > 0 &&
    typeof message.state === "string" &&
    message.state.length > 0
  );
};
