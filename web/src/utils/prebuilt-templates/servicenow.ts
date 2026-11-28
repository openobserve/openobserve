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

import { raw, type I18nKey } from "@/types/i18n";

import { PrebuiltConfig, PrebuiltType } from "./types";

/** How a ServiceNow save signs in: today's typed Basic header, or a store secret. */
export type ServiceNowSignIn = "typed" | "basic" | "api_key";

/** Header the server reads a ServiceNow API key from. */
export const SERVICENOW_API_KEY_HEADER = "x-sn-apikey";

const SECRET_REF = /^\{\{secrets\.[A-Za-z0-9_]+\}\}$/;

/** Typed credential fields each sign-in still uses; a store secret replaces the rest. */
const TYPED_FIELDS: Record<ServiceNowSignIn, string[]> = {
  typed: ["username", "password"],
  basic: ["username"],
  api_key: [],
};

/** Secret field each store method needs. */
const SECRET_FIELD: Record<ServiceNowSignIn, string | null> = {
  typed: null,
  basic: "passwordSecret",
  api_key: "apiKeySecret",
};

const isValidServiceNowIncidentUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);

    // Only allow HTTP/S URLs
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    // Require a host within the service-now.com domain
    // Split hostname and verify the last two parts are exactly "service-now.com"
    if (hostname !== "service-now.com") {
      const parts = hostname.split(".");
      if (
        parts.length < 3 ||
        parts[parts.length - 2] !== "service-now" ||
        parts[parts.length - 1] !== "com"
      ) {
        return false;
      }
    }

    // Require the incident table API path
    if (!parsed.pathname.startsWith("/api/now/table/incident")) {
      return false;
    }

    return true;
  } catch {
    // If URL parsing fails, the URL is not valid
    return false;
  }
};

const text = (value: unknown): string => String(value ?? "").trim();

/** The credentials as saved: the method choice counts only while the store can bind secrets (D1). [pure] */
export const servicenowCredentials = (
  credentials: Record<string, unknown>,
  storeSignIn: boolean,
): Record<string, unknown> => (storeSignIn ? credentials : { ...credentials, authMethod: "" });

/** The sign-in a save sends; an unpicked old password stays typed (D11). [pure] */
export const servicenowSignIn = (credentials: Record<string, unknown>): ServiceNowSignIn => {
  if (credentials.authMethod === "api_key") return "api_key";
  if (credentials.authMethod !== "basic") return "typed";
  return !text(credentials.passwordSecret) && text(credentials.password) ? "typed" : "basic";
};

/** Whether a typed credential field (username, password) is required for this sign-in. [pure] */
export const servicenowUsesField = (credentials: Record<string, unknown>, key: string): boolean =>
  !TYPED_FIELDS.typed.includes(key) || TYPED_FIELDS[servicenowSignIn(credentials)].includes(key);

/** Store-method fields the server would refuse: a secret field without exactly one secret reference, a username with ':'. [pure] */
export const servicenowSignInIssues = (
  credentials: Record<string, unknown>,
): { field: string; messageKey: I18nKey }[] => {
  const signIn = servicenowSignIn(credentials);
  const issues: { field: string; messageKey: I18nKey }[] = [];
  const secretField = SECRET_FIELD[signIn];
  if (secretField && !SECRET_REF.test(text(credentials[secretField]))) {
    issues.push({
      field: secretField,
      messageKey: "alerts.prebuiltDestinations.servicenowSecretRequired",
    });
  }
  if (signIn === "basic" && text(credentials.username).includes(":")) {
    issues.push({
      field: "username",
      messageKey: "alerts.prebuiltDestinations.servicenowUsernameColon",
    });
  }
  return issues;
};

/** Headers and metadata a ServiceNow save adds for its sign-in. [pure] */
export const servicenowSignInPayload = (
  credentials: Record<string, unknown>,
): { headers: Record<string, string>; metadata: Record<string, string> } => {
  switch (servicenowSignIn(credentials)) {
    case "basic":
      return {
        headers: {},
        metadata: {
          servicenow_auth: "basic",
          servicenow_username: text(credentials.username),
          servicenow_password: text(credentials.passwordSecret),
        },
      };
    case "api_key":
      return {
        headers: { [SERVICENOW_API_KEY_HEADER]: text(credentials.apiKeySecret) },
        metadata: { servicenow_auth: "api_key" },
      };
    case "typed": {
      const { username, password } = credentials;
      if (!username || !password) return { headers: {}, metadata: {} };
      return {
        headers: { Authorization: `Basic ${btoa(`${username}:${password}`)}` },
        metadata: {},
      };
    }
  }
};

/** Sign-in fields of a saved destination; one without `servicenow_auth` opens as Username and password. [pure] */
export const servicenowSavedCredentials = (
  metadata: Record<string, unknown>,
  headers: Record<string, string>,
): Record<string, string> => {
  if (metadata.servicenow_auth === "api_key") {
    return { authMethod: "api_key", apiKeySecret: headers[SERVICENOW_API_KEY_HEADER] ?? "" };
  }
  if (metadata.servicenow_auth !== "basic") return { authMethod: "basic" };
  return {
    authMethod: "basic",
    username: text(metadata.servicenow_username),
    passwordSecret: text(metadata.servicenow_password),
  };
};

/**
 * ServiceNow prebuilt destination configuration
 * Creates incidents via ServiceNow Table API
 */
export const servicenowTemplate = {
  name: "prebuilt_servicenow",
  body: JSON.stringify(
    {
      short_description: "OpenObserve [{alert_status}]: {alert_name}",
      description:
        "Alert Details:\n\nStream: {stream_name}\nType: {stream_type}\nCount: {alert_count}\nThreshold: {alert_operator} {alert_threshold}\nTime: {alert_time}\n\nView in OpenObserve: {alert_url}",
      category: "Software",
      subcategory: "Operating System",
      urgency: "2",
      impact: "2",
      priority: "2",
      assignment_group: "{assignment_group}",
      caller_id: "openobserve",
      contact_type: "alert",
      work_notes: "Incident created automatically by OpenObserve alert system",
    },
    null,
    2,
  ),
  type: "http" as const,
  isDefault: false,
};

export const servicenowConfig: PrebuiltConfig = {
  templateName: "prebuilt_servicenow",
  templateBody: servicenowTemplate.body,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  method: "post",
  credentialFields: [
    {
      key: "instanceUrl",
      labelKey: "alerts.prebuiltDestinations.servicenowInstanceUrl",
      type: "text",
      required: true,
      hint: raw("https://your-instance.service-now.com/api/now/table/incident"),
      validator: (url: string) =>
        isValidServiceNowIncidentUrl(url) || {
          key: "alerts.prebuiltDestinations.servicenowInstanceUrlFormat",
        },
    },
    {
      key: "username",
      labelKey: "common.username",
      type: "text",
      required: true,
      hintKey: "alerts.prebuiltDestinations.servicenowUsernameHelp",
      validator: (value: string) =>
        value.trim().length > 0 || {
          key: "alerts.prebuiltDestinations.usernameRequired",
        },
    },
    {
      key: "password",
      labelKey: "common.password",
      type: "password",
      required: true,
      hintKey: "alerts.prebuiltDestinations.servicenowPasswordHelp",
      validator: (value: string) =>
        value.trim().length > 0 || {
          key: "alerts.prebuiltDestinations.passwordRequired",
        },
    },
    {
      key: "authMethod",
      labelKey: "alerts.prebuiltDestinations.servicenowSignIn",
      type: "select",
      required: false,
    },
    {
      key: "passwordSecret",
      labelKey: "common.password",
      type: "text",
      required: false,
    },
    {
      key: "apiKeySecret",
      labelKey: "alerts.prebuiltDestinations.servicenowSignInApiKey",
      type: "text",
      required: false,
    },
    {
      key: "assignmentGroup",
      labelKey: "alerts.prebuiltDestinations.servicenowAssignmentGroup",
      type: "text",
      required: false,
      hintKey: "alerts.prebuiltDestinations.servicenowAssignmentGroupHelp",
      persistInMetadata: true,
    },
    {
      key: "resolutionCode",
      labelKey: "alerts.prebuiltDestinations.servicenowResolutionCode",
      type: "text",
      required: false,
      hintKey: "alerts.prebuiltDestinations.servicenowResolutionCodeHelp",
      persistInMetadata: true,
    },
  ],
};

import servicenowLogo from "@/assets/images/alerts/destinations/servicenow.png";

export const servicenowDestinationType: PrebuiltType = {
  id: "servicenow",
  name: raw("ServiceNow"),
  descriptionKey: "alert_destinations.prebuilt.servicenowDescription",
  icon: "servicenow",
  image: servicenowLogo,
  popular: true,
  category: "incident",
};
