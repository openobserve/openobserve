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
  jiraConfig,
  jiraCredentialsFromMetadata,
  jiraDestinationType,
  jiraFieldInputValues,
  jiraFieldsPayload,
  jiraMetadata,
  jiraSetupRequest,
  jiraTemplate,
} from "@/utils/prebuilt-templates/jira";
import {
  detectPrebuiltType,
  generateDestinationHeaders,
  generateDestinationUrl,
  generatePrebuiltMetadata,
  getPrebuiltConfig,
} from "@/utils/prebuilt-templates";
import type { JiraRequiredField } from "@/services/alert_destination";

const cloud = {
  deployment: "cloud",
  url: "https://acme.atlassian.net/",
  email: "alerts-bot@example.com",
  token: "secret-token",
  projectKey: "OPS",
  issueTypeId: "10004",
  priorityId: "3",
  fields: '{"customfield_10020":{"id":"10101"}}',
};

describe("jira type config", () => {
  it("registers type jira with template prebuilt_jira", () => {
    expect(jiraDestinationType.id).toBe("jira");
    expect(jiraDestinationType.name).toBe("Jira");
    expect(jiraDestinationType.category).toBe("incident");
    expect(jiraDestinationType.image).toBeTruthy();
    expect(jiraTemplate.name).toBe("prebuilt_jira");
    expect(jiraConfig.templateName).toBe("prebuilt_jira");
    expect(getPrebuiltConfig("jira")).toBe(jiraConfig);
    expect(() => JSON.parse(jiraConfig.templateBody)).not.toThrow();
  });

  it("posts JSON and accepts JSON", () => {
    expect(jiraConfig.method).toBe("post");
    expect(jiraConfig.headers).toEqual({
      "Content-Type": "application/json",
      Accept: "application/json",
    });
  });

  it("requires the connection, project and issue type, and leaves email to the schema", () => {
    const required = jiraConfig.credentialFields.filter((f) => f.required).map((f) => f.key);
    expect(required).toEqual(["deployment", "url", "token", "projectKey", "issueTypeId"]);
    expect(jiraConfig.credentialFields.find((f) => f.key === "email")?.required).toBe(false);
  });

  it("persists no credential in credential_* metadata", () => {
    expect(jiraConfig.credentialFields.some((f) => f.persistInMetadata)).toBe(false);
  });

  it("accepts only http(s) URLs", () => {
    const validator = jiraConfig.credentialFields.find((f) => f.key === "url")?.validator;
    expect(validator?.("https://acme.atlassian.net")).toBe(true);
    expect(validator?.("http://jira.internal:8080/jira")).toBe(true);
    expect(validator?.("acme.atlassian.net")).not.toBe(true);
    expect(validator?.("ftp://acme.atlassian.net")).not.toBe(true);
  });

  it("is detected from destination_type_name", () => {
    expect(detectPrebuiltType({ type: "http", destination_type_name: "jira" })).toBe("jira");
  });
});

describe("stored destination (spec section 1)", () => {
  it("stores the base URL without a trailing slash", () => {
    expect(generateDestinationUrl("jira", cloud)).toBe("https://acme.atlassian.net");
  });

  it("sends Basic email:token for Cloud and Bearer token for Data Center", () => {
    expect(generateDestinationHeaders("jira", cloud)).toEqual({
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${btoa("alerts-bot@example.com:secret-token")}`,
    });
    expect(
      generateDestinationHeaders("jira", { deployment: "data_center", token: "pat" }).Authorization,
    ).toBe("Bearer pat");
  });

  it("adds no Authorization header without a token", () => {
    expect(generateDestinationHeaders("jira", { ...cloud, token: "" })).not.toHaveProperty(
      "Authorization",
    );
  });

  it("writes every metadata value as a string", () => {
    expect(generatePrebuiltMetadata("jira", cloud)).toEqual({
      jira_deployment: "cloud",
      jira_email: "alerts-bot@example.com",
      jira_project_key: "OPS",
      jira_issue_type_id: "10004",
      jira_priority_id: "3",
      jira_fields: '{"customfield_10020":{"id":"10101"}}',
    });
    expect(jiraMetadata({ deployment: "data_center" })).toEqual({
      jira_deployment: "data_center",
      jira_email: "",
      jira_project_key: "",
      jira_issue_type_id: "",
      jira_priority_id: "",
      jira_fields: "{}",
    });
  });
});

describe("edit decoding", () => {
  it("reads the metadata back into the form keys", () => {
    expect(jiraCredentialsFromMetadata(jiraMetadata(cloud))).toEqual({
      deployment: "cloud",
      email: "alerts-bot@example.com",
      projectKey: "OPS",
      issueTypeId: "10004",
      priorityId: "3",
      fields: '{"customfield_10020":{"id":"10101"}}',
    });
  });
});

describe("required field values", () => {
  const required: JiraRequiredField[] = [
    { id: "customfield_1", name: "Summary Extra", kind: "text" },
    { id: "customfield_2", name: "Points", kind: "number" },
    { id: "customfield_3", name: "Team", kind: "option" },
    { id: "components", name: "Components", kind: "options" },
    { id: "versions", name: "Affects Version", kind: "unsupported" },
  ];

  it("builds the shape Jira expects for each kind and skips empty or unsupported ones", () => {
    expect(
      jiraFieldsPayload(required, {
        customfield_1: "checkout",
        customfield_2: "5",
        customfield_3: "10101",
        components: ["1", "2"],
        versions: "1.0",
      }),
    ).toEqual({
      customfield_1: "checkout",
      customfield_2: 5,
      customfield_3: { id: "10101" },
      components: [{ id: "1" }, { id: "2" }],
    });
    expect(jiraFieldsPayload(required, { customfield_1: "  ", components: [] })).toEqual({});
  });

  it("turns a saved payload back into input values", () => {
    expect(
      jiraFieldInputValues({
        customfield_1: "checkout",
        customfield_2: 5,
        customfield_3: { id: "10101" },
        components: [{ id: "1" }, { id: "2" }],
      }),
    ).toEqual({
      customfield_1: "checkout",
      customfield_2: 5,
      customfield_3: "10101",
      components: ["1", "2"],
    });
  });
});

describe("setup request", () => {
  it("matches the route contract and parses the saved fields", () => {
    expect(jiraSetupRequest(cloud, "test_issue")).toEqual({
      url: "https://acme.atlassian.net",
      deployment: "cloud",
      email: "alerts-bot@example.com",
      token: "secret-token",
      action: "test_issue",
      project_key: "OPS",
      issue_type_id: "10004",
      priority_id: "3",
      fields: { customfield_10020: { id: "10101" } },
    });
  });

  it("names the saved destination only when the token is empty", () => {
    const saved = { ...cloud, savedDestination: "jira-ops" };
    expect(jiraSetupRequest({ ...saved, token: "" }, "connect").destination).toBe("jira-ops");
    expect(jiraSetupRequest(saved, "connect")).not.toHaveProperty("destination");
  });

  it("sends empty fields when the saved JSON is not an object", () => {
    expect(jiraSetupRequest({ ...cloud, fields: "not json" }, "connect").fields).toEqual({});
    expect(jiraSetupRequest({ ...cloud, fields: "[]" }, "connect").fields).toEqual({});
  });
});
