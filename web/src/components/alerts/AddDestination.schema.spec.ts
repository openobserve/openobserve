// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { addDestinationDefaults, makeAddDestinationSchema } from "./AddDestination.schema";

const t = (key: string): string => key;
const validWebhook = "https://hooks.slack.com/services/T000/B000/secret";

const slackValues = (overrides: Record<string, unknown> = {}) => ({
  ...addDestinationDefaults(),
  destination_type: "slack",
  type: "http",
  name: "slack-alerts",
  slack_setup_method: "oauth",
  credentials: { webhookUrl: "", channel: "" },
  ...overrides,
});

describe("AddDestination schema Slack OAuth flow", () => {
  it("defaults new destinations to OAuth", () => {
    expect(addDestinationDefaults().slack_setup_method).toBe("oauth");
  });

  it("validates destination names for Slack destinations", () => {
    const schema = makeAddDestinationSchema(t, true);
    const emptyName = schema.safeParse(
      slackValues({
        name: "",
        credentials: { webhookUrl: validWebhook, channel: "alerts" },
      }),
    );
    const invalidName = schema.safeParse(
      slackValues({
        name: "bad name?",
        credentials: { webhookUrl: validWebhook, channel: "alerts" },
      }),
    );

    expect(emptyName.success).toBe(false);
    expect(invalidName.success).toBe(false);
    if (!emptyName.success) {
      expect(emptyName.error.issues.some((issue) => issue.path.join(".") === "name")).toBe(true);
    }
    if (!invalidName.success) {
      expect(invalidName.error.issues.some((issue) => issue.path.join(".") === "name")).toBe(true);
    }
  });

  it("requires a valid OAuth-returned webhook before save", () => {
    const schema = makeAddDestinationSchema(t, true);

    expect(schema.safeParse(slackValues()).success).toBe(false);
    expect(
      schema.safeParse(
        slackValues({
          credentials: { webhookUrl: validWebhook, channel: "alerts" },
        }),
      ).success,
    ).toBe(false);
    expect(
      schema.safeParse(
        slackValues({
          credentials: { webhookUrl: validWebhook, channel: "alerts" },
          slack_team_id: "T000",
          slack_team_name: "Acme",
          slack_channel_id: "B000",
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    ["channel label", { credentials: { webhookUrl: validWebhook, channel: "" } }],
    ["team ID", { slack_team_id: "" }],
    ["team name", { slack_team_name: "" }],
    ["channel ID", { slack_channel_id: "" }],
  ])("requires the OAuth %s", (_case, omission) => {
    const result = makeAddDestinationSchema(t, true).safeParse(
      slackValues({
        credentials: { webhookUrl: validWebhook, channel: "alerts" },
        slack_team_id: "T000",
        slack_team_name: "Acme",
        slack_channel_id: "B000",
        ...omission,
      }),
    );

    expect(result.success).toBe(false);
  });

  it.each([
    ["non-Slack host", "https://example.com/services/T000/B000/secret"],
    ["query string", `${validWebhook}?leak=true`],
    ["fragment", `${validWebhook}#leak`],
  ])("rejects an OAuth webhook with a %s", (_case, webhookUrl) => {
    const result = makeAddDestinationSchema(t, true).safeParse(
      slackValues({
        credentials: { webhookUrl, channel: "alerts" },
        slack_team_id: "T000",
        slack_team_name: "Acme",
        slack_channel_id: "B000",
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.join(".") === "credentials.webhookUrl"),
      ).toBe(true);
    }
  });

  it("requires a valid webhook for existing-webhook setup and edits", () => {
    const createSchema = makeAddDestinationSchema(t, true);
    const editSchema = makeAddDestinationSchema(t, true);

    expect(createSchema.safeParse(slackValues({ slack_setup_method: "webhook" })).success).toBe(
      false,
    );
    expect(editSchema.safeParse(slackValues({ slack_setup_method: "webhook" })).success).toBe(
      false,
    );
    expect(
      editSchema.safeParse(
        slackValues({
          slack_setup_method: "webhook",
          credentials: { webhookUrl: validWebhook, channel: "" },
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    ["malformed", "not-a-url"],
    ["non-Slack host", "https://example.com/services/T000/B000/secret"],
    ["query string", `${validWebhook}?leak=true`],
    ["fragment", `${validWebhook}#leak`],
  ])("rejects a %s existing webhook", (_case, webhookUrl) => {
    const result = makeAddDestinationSchema(t, true).safeParse(
      slackValues({
        slack_setup_method: "webhook",
        credentials: { webhookUrl, channel: "" },
      }),
    );

    expect(result.success).toBe(false);
  });

  it("accepts manifest setup only with a Slack app name and valid generated webhook", () => {
    const schema = makeAddDestinationSchema(t, true);
    const validManifest = slackValues({
      slack_setup_method: "manifest",
      slack_app_name: "OpenObserve Alerts",
      credentials: { webhookUrl: validWebhook, channel: "" },
    });

    expect(schema.safeParse(validManifest).success).toBe(true);
    const blankName = schema.safeParse({
      ...validManifest,
      slack_app_name: "",
    });
    const longName = schema.safeParse({
      ...validManifest,
      slack_app_name: "x".repeat(36),
    });

    expect(blankName.success).toBe(false);
    expect(longName.success).toBe(false);
    if (!blankName.success) {
      expect(
        blankName.error.issues.some((issue) => issue.path.join(".") === "slack_app_name"),
      ).toBe(true);
    }
    if (!longName.success) {
      expect(longName.error.issues.some((issue) => issue.path.join(".") === "slack_app_name")).toBe(
        true,
      );
    }
  });

  it.each([
    ["blank", ""],
    ["malformed", "not-a-url"],
    ["non-Slack host", "https://example.com/services/T000/B000/secret"],
    ["query string", `${validWebhook}?leak=true`],
    ["fragment", `${validWebhook}#leak`],
  ])("rejects a %s webhook in manifest setup", (_case, webhookUrl) => {
    const result = makeAddDestinationSchema(t, true).safeParse(
      slackValues({
        slack_setup_method: "manifest",
        slack_app_name: "OpenObserve Alerts",
        credentials: { webhookUrl, channel: "" },
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.join(".") === "credentials.webhookUrl"),
      ).toBe(true);
    }
  });

  it("trims the manifest app name and accepts the 35-character boundary", () => {
    const schema = makeAddDestinationSchema(t, true);
    const parse = (slackAppName: string) =>
      schema.safeParse(
        slackValues({
          slack_setup_method: "manifest",
          slack_app_name: slackAppName,
          credentials: { webhookUrl: validWebhook, channel: "" },
        }),
      );

    expect(parse(`  ${"x".repeat(35)}  `).success).toBe(true);
    expect(parse("   ").success).toBe(false);
  });

  it("keeps credential validation active for other prebuilt types", () => {
    const schema = makeAddDestinationSchema(t, true);
    const values = {
      ...addDestinationDefaults(),
      destination_type: "pagerduty",
      name: "pagerduty-alerts",
      credentials: { integrationKey: "", severity: "" },
    };

    expect(schema.safeParse(values).success).toBe(false);
  });
});
