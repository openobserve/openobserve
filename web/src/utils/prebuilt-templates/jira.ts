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

import { raw } from "@/types/i18n";
import type {
  JiraDeployment,
  JiraFieldKind,
  JiraRequiredField,
  JiraSetupAction,
  JiraSetupRequest,
} from "@/services/alert_destination";

import { PrebuiltConfig, PrebuiltType } from "./types";

type Credentials = Record<string, unknown>;

/** What the `fields` lookup said about the chosen issue type; held only in the form, never saved. */
export interface JiraCreateMeta {
  projectName: string;
  issueTypeName: string;
  hasLabels: boolean;
  requiredFields: JiraRequiredField[];
}

const isValidJiraUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

const text = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value);

export const jiraBaseUrl = (url: unknown): string => text(url).trim().replace(/\/+$/, "");

export const jiraDeployment = (credentials: Credentials): JiraDeployment =>
  credentials.deployment === "data_center" ? "data_center" : "cloud";

export const jiraAuthorization = (credentials: Credentials): string => {
  const token = text(credentials.token).trim();
  return jiraDeployment(credentials) === "data_center"
    ? `Bearer ${token}`
    : `Basic ${btoa(`${text(credentials.email).trim()}:${token}`)}`;
};

export const jiraMetadata = (credentials: Credentials): Record<string, string> => ({
  jira_deployment: jiraDeployment(credentials),
  jira_email: jiraDeployment(credentials) === "cloud" ? text(credentials.email).trim() : "",
  jira_project_key: text(credentials.projectKey),
  jira_issue_type_id: text(credentials.issueTypeId),
  jira_priority_id: text(credentials.priorityId),
  jira_fields: text(credentials.fields) || "{}",
});

export const jiraCredentialsFromMetadata = (metadata: Record<string, unknown>): Credentials => ({
  deployment: metadata.jira_deployment,
  email: metadata.jira_email,
  projectKey: metadata.jira_project_key,
  issueTypeId: metadata.jira_issue_type_id,
  priorityId: metadata.jira_priority_id,
  fields: metadata.jira_fields,
});

export const parseJiraFields = (json: unknown): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(text(json) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

/** A saved Jira token never comes back to the browser; it is required again only after Change. */
export const jiraKeepsSavedToken = (credentials: Credentials): boolean =>
  !!credentials.savedDestination && !credentials.changing;

export const jiraSetupRequest = (
  credentials: Credentials,
  action: JiraSetupAction,
): JiraSetupRequest => {
  const token = text(credentials.token).trim();
  const destination = text(credentials.savedDestination);
  return {
    url: jiraBaseUrl(credentials.url),
    deployment: jiraDeployment(credentials),
    email: text(credentials.email).trim(),
    token,
    // An empty token lets the server use the saved destination's token.
    ...(!token && destination ? { destination } : {}),
    action,
    project_key: text(credentials.projectKey),
    issue_type_id: text(credentials.issueTypeId),
    priority_id: text(credentials.priorityId),
    fields: parseJiraFields(credentials.fields),
  };
};

/** The value Jira expects on create, or `undefined` when the input is empty. */
export const toJiraFieldValue = (kind: JiraFieldKind, value: unknown): unknown => {
  if (value === undefined || value === null || value === "") return undefined;
  switch (kind) {
    case "text":
      return String(value).trim() || undefined;
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case "option":
      return { id: String(value) };
    case "options":
      return Array.isArray(value) && value.length > 0
        ? value.map((id) => ({ id: String(id) }))
        : undefined;
    default:
      return undefined;
  }
};

export const jiraFieldsPayload = (
  requiredFields: JiraRequiredField[],
  values: Record<string, unknown>,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  for (const field of requiredFields) {
    const value = toJiraFieldValue(field.kind, values[field.id]);
    if (value !== undefined) payload[field.id] = value;
  }
  return payload;
};

const optionId = (value: unknown): unknown =>
  value && typeof value === "object" && "id" in value ? String(value.id) : value;

/** Reverses {@link jiraFieldsPayload} so a saved destination fills its inputs again. */
export const jiraFieldInputValues = (fields: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fields).map(([id, value]) => [
      id,
      Array.isArray(value) ? value.map(optionId) : optionId(value),
    ]),
  );

/**
 * Jira prebuilt destination configuration. The server builds the ticket text
 * from the alert data, so this template is a placeholder that is never sent.
 */
export const jiraTemplate = {
  name: "prebuilt_jira",
  body: JSON.stringify(
    {
      note: "The Jira destination builds the issue text from the alert data and does not render this template.",
      alert_name: "{alert_name}",
      alert_status: "{alert_status}",
    },
    null,
    2,
  ),
  type: "http" as const,
  isDefault: false,
};

export const jiraConfig: PrebuiltConfig = {
  templateName: "prebuilt_jira",
  templateBody: jiraTemplate.body,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  method: "post",
  credentialFields: [
    {
      key: "deployment",
      labelKey: "alerts.prebuiltDestinations.jiraType",
      type: "select",
      required: true,
    },
    {
      key: "url",
      labelKey: "alerts.prebuiltDestinations.jiraUrl",
      type: "text",
      required: true,
      validator: (url: string) =>
        isValidJiraUrl(url) || { key: "alerts.prebuiltDestinations.jiraUrlFormat" },
    },
    // Required for Jira Cloud only; AddDestination.schema.ts enforces that.
    {
      key: "email",
      labelKey: "alerts.prebuiltDestinations.jiraEmail",
      type: "email",
      required: false,
    },
    {
      key: "token",
      labelKey: "alerts.prebuiltDestinations.jiraApiToken",
      type: "password",
      required: true,
      validator: (value: string) =>
        value.trim().length > 0 || { key: "alerts.prebuiltDestinations.jiraTokenRequired" },
    },
    {
      key: "projectKey",
      labelKey: "alerts.prebuiltDestinations.jiraProject",
      type: "select",
      required: true,
    },
    {
      key: "issueTypeId",
      labelKey: "alerts.prebuiltDestinations.jiraIssueType",
      type: "select",
      required: true,
    },
    {
      key: "priorityId",
      labelKey: "alerts.prebuiltDestinations.jiraPriority",
      type: "select",
      required: false,
    },
    // JSON object string of the required Jira fields, written by JiraDestinationFields.vue.
    {
      key: "fields",
      labelKey: "alerts.prebuiltDestinations.jiraRequiredFields",
      type: "text",
      required: false,
    },
  ],
};

import jiraLogo from "@/assets/images/alerts/destinations/jira.svg";

export const jiraDestinationType: PrebuiltType = {
  id: "jira",
  name: raw("Jira"),
  descriptionKey: "alerts.prebuiltDestinations.jiraDescription",
  shortKey: "alert_destinations.prebuilt.jiraShort",
  icon: "jira",
  image: jiraLogo,
  popular: true,
  category: "incident",
};
