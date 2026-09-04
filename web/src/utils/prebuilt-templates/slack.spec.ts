// Copyright 2026 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect } from "vitest";
import {
  isValidSlackWebhookUrl,
  slackTemplate,
  slackConfig,
  slackDestinationType,
} from "@/utils/prebuilt-templates/slack";

describe("slack template", () => {
  describe("slackTemplate", () => {
    it("has correct name", () => {
      expect(slackTemplate.name).toBe("prebuilt_slack");
    });

    it("has type as http", () => {
      expect(slackTemplate.type).toBe("http");
    });

    it("is not default", () => {
      expect(slackTemplate.isDefault).toBe(false);
    });

    it("has valid JSON body", () => {
      expect(() => JSON.parse(slackTemplate.body)).not.toThrow();
    });

    it("body contains Slack-specific fields", () => {
      const body = JSON.parse(slackTemplate.body);
      expect(body).toHaveProperty("blocks");
      expect(Array.isArray(body.blocks)).toBe(true);
    });

    it("body contains alert placeholders", () => {
      expect(slackTemplate.body).toContain("{alert_name}");
    });
  });

  describe("slackConfig", () => {
    it("references correct template name", () => {
      expect(slackConfig.templateName).toBe("prebuilt_slack");
    });

    it("has correct headers", () => {
      expect(slackConfig.headers).toHaveProperty("Content-Type");
      expect(slackConfig.headers["Content-Type"]).toBe("application/json");
    });

    it("uses POST method", () => {
      expect(slackConfig.method).toBe("post");
    });

    it("has URL validator function", () => {
      expect(typeof slackConfig.urlValidator).toBe("function");
    });

    it.each([
      "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX",
      "https://hooks.slack.com/services/T000/B000/secret/",
      "https://hooks.slack-gov.com/services/T000/B000/secret",
    ])("accepts a complete Slack webhook URL: %s", (url) => {
      expect(isValidSlackWebhookUrl(url)).toBe(true);
      expect(slackConfig.urlValidator(url)).toBe(true);
    });

    it.each([
      "http://hooks.slack.com/services/T000/B000/secret",
      "https://foo.hooks.slack.com/services/T000/B000/secret",
      "https://foo.hooks.slack-gov.com/services/T000/B000/secret",
      "https://example.com/services/T000/B000/secret",
      "https://hooks.slack.com/services/xxx",
      "https://hooks.slack.com/services//B000/secret",
      "https://hooks.slack.com/services/T000//secret",
      "https://hooks.slack.com/services/T000/B000",
      "https://hooks.slack.com/services/T000/B000/",
      "https://hooks.slack.com/services/T000/B000/secret/extra",
      "https://user@hooks.slack.com/services/T000/B000/secret",
      "https://hooks.slack.com:8443/services/T000/B000/secret",
      "https://hooks.slack.com/services/T000/B000/secret?debug=1",
      "https://hooks.slack.com/services/T000/B000/secret?",
      "https://hooks.slack.com/services/T000/B000/secret#fragment",
      "https://hooks.slack.com/services/T000/B000/secret#",
      " https://hooks.slack.com/services/T000/B000/secret",
      "https://hooks.slack.com/services/T000/B000/secret ",
      "https://hooks.slack.com/serv\nices/T000/B000/secret",
      "https://hooks.slack.com/serv\tices/T000/B000/secret",
      "invalid-url",
    ])("rejects an incomplete or unsafe Slack webhook URL: %s", (url) => {
      expect(isValidSlackWebhookUrl(url)).toBe(false);
      expect(slackConfig.urlValidator(url)).toBe(false);
    });

    it("has credential fields", () => {
      expect(slackConfig.credentialFields).toBeInstanceOf(Array);
      expect(slackConfig.credentialFields.length).toBeGreaterThan(0);
    });

    it("webhook URL field is required", () => {
      const webhookField = slackConfig.credentialFields.find((f) => f.key === "webhookUrl");
      expect(webhookField).toBeDefined();
      expect(webhookField?.required).toBe(true);
      expect(webhookField?.type).toBe("text");
      expect(webhookField?.persistInMetadata).not.toBe(true);
    });

    it("persists only the optional channel in destination metadata", () => {
      const persistentFields = slackConfig.credentialFields
        .filter((field) => field.persistInMetadata)
        .map((field) => field.key);

      expect(persistentFields).toEqual(["channel"]);
    });

    it("webhook URL validator validates Slack URLs", () => {
      const webhookField = slackConfig.credentialFields.find((f) => f.key === "webhookUrl");
      const validator = webhookField?.validator;
      expect(typeof validator).toBe("function");

      if (validator) {
        // Valid URLs
        expect(validator("https://hooks.slack.com/services/T00000000/B00000000/XXXX")).toBe(true);
        expect(validator("https://hooks.slack-gov.com/services/T000/B000/XXXX")).toBe(true);

        // Invalid URLs
        expect(validator("https://example.com")).not.toBe(true);
        expect(validator("https://hooks.slack.com/services/xxx")).not.toBe(true);
        expect(validator("https://foo.hooks.slack.com/services/T/B/S")).not.toBe(true);
        expect(validator("https://evil.com?hooks.slack.com=fake")).not.toBe(true);
        expect(validator("invalid-url")).not.toBe(true);
      }
    });
  });

  describe("slackDestinationType", () => {
    it("has correct ID", () => {
      expect(slackDestinationType.id).toBe("slack");
    });

    it("has display name", () => {
      expect(slackDestinationType.name).toBe("Slack");
    });

    it("has description", () => {
      expect(slackDestinationType.descriptionKey).toBeTruthy();
      expect(typeof slackDestinationType.descriptionKey).toBe("string");
    });

    it("has icon", () => {
      expect(slackDestinationType.icon).toBeTruthy();
    });

    it("has image", () => {
      expect(slackDestinationType.image).toBeTruthy();
    });

    it("is marked as popular", () => {
      expect(slackDestinationType.popular).toBe(true);
    });

    it("has correct category", () => {
      expect(slackDestinationType.category).toBe("messaging");
    });
  });
});
