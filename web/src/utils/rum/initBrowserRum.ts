// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { openobserveRum } from "@openobserve/browser-rum";
import { openobserveLogs } from "@openobserve/browser-logs";
import { shouldPropagateTracing } from "./tracingOrigin";
import { isIgnoredNoise } from "./ignoredNoisePatterns";
import {
  scrubAuthParams,
  scrubSharePath,
  scrubShareTokens,
  type ShareScrubbable,
} from "./scrubAuthParams";
import { isExtensionOnlyError } from "./extensionFrames";

/** The `rum` block of the authenticated full config (`GET /api/{org}/config`). */
export interface BrowserRumConfig {
  enabled: boolean;
  client_token: string;
  application_id: string;
  site: string;
  service: string;
  env: string;
  version?: string;
  organization_identifier: string;
  api_version?: string;
  insecure_http?: boolean;
}

// Only the three dot-separated parts make a token, so a bare eyJ inside a word (surveyJsonBtn) is kept.
const JWT_PATTERN = /eyJ[\w-]*\.[\w-]+\.[\w-]*/g;

const IGNORED_ERROR_PATTERNS = [
  /ResizeObserver loop/i,
  /reo.dev/i,
  /Cannot set properties of null \(setting 'innerHTML'\)/,
];

const IGNORED_LOG_PATTERNS = [/ResizeObserver loop/i];

let rumStarted = false;
let logsStarted = false;

/** True once the RUM SDK has started in this page load. */
export const isBrowserRumStarted = (): boolean => rumStarted;

/** Starts the browser RUM and logs SDKs at most once per page load; returns whether RUM is on. Never throws. */
export const initBrowserRum = (
  rum: BrowserRumConfig | null | undefined,
  apiEndpoint: string,
): boolean => {
  if (!rum?.enabled) return false;
  if (rumStarted && logsStarted) return true;

  const version = rum.version || "0.0.1";
  const apiVersion = rum.api_version || "v1";
  const insecureHTTP = rum.insecure_http || false;
  // Without a token or application id the SDK drops the init, and without a site it sends to its own default intake.
  const hasLogsSettings = Boolean(rum.client_token && rum.site);
  const hasRumSettings = hasLogsSettings && Boolean(rum.application_id);
  if (!rumStarted && hasRumSettings) {
    rumStarted = tryInit("RUM", () =>
      startRumSdk(rum, apiEndpoint, version, apiVersion, insecureHTTP),
    );
  } else if (!rumStarted) {
    console.error("The RUM configuration lacks a client token, application id or site.");
  }
  if (!logsStarted && hasLogsSettings) {
    logsStarted = tryInit("logs", () => startLogsSdk(rum, version, apiVersion, insecureHTTP));
  }
  return rumStarted;
};

export const resetBrowserRumForTests = (): void => {
  rumStarted = false;
  logsStarted = false;
};

const tryInit = (sdk: string, init: () => void): boolean => {
  try {
    init();
    return true;
  } catch (error) {
    console.error(`Failed to start the browser ${sdk} SDK:`, error);
    return false;
  }
};

const startRumSdk = (
  rum: BrowserRumConfig,
  apiEndpoint: string,
  version: string,
  apiVersion: string,
  insecureHTTP: boolean,
): void =>
  openobserveRum.init({
    applicationId: rum.application_id,
    clientToken: rum.client_token,
    site: rum.site,
    organizationIdentifier: rum.organization_identifier,
    service: rum.service,
    env: rum.env,
    version,
    trackResources: true,
    trackLongTasks: true,
    trackUserInteractions: true,
    actionNameAttribute: "data-test",
    apiVersion,
    insecureHTTP,
    defaultPrivacyLevel: "allow",
    // Session renewal drops the forced replay start, so sampling must keep every renewed session recording.
    sessionReplaySampleRate: 100,
    startSessionReplayRecordingManually: true,
    // Cross-origin, the injected headers fail the CORS preflight and kill every API call.
    allowedTracingUrls: shouldPropagateTracing(apiEndpoint, window.location.origin)
      ? [
          {
            match: apiEndpoint + "/api",
            propagatorTypes: ["openobserve", "tracecontext"],
          },
        ]
      : [],
    beforeSend: (event) => {
      event.view.url = scrubSharePath(scrubAuthParams(event.view.url) ?? event.view.url);
      event.view.referrer = scrubSharePath(scrubAuthParams(event.view.referrer));
      if (event.type === "resource") {
        event.resource.url = scrubAuthParams(event.resource.url) ?? event.resource.url;
      }
      if (event.type === "error") {
        event.error.message = scrubAuthParams(event.error.message) ?? event.error.message;
        if (event.error.resource) {
          event.error.resource.url =
            scrubAuthParams(event.error.resource.url) ?? event.error.resource.url;
        }
      }
      scrubShareTokens(event as ShareScrubbable);
      if (event.type === "error" && isExtensionOnlyError(event.error?.stack)) return false;
      if (event.type === "action" && event.action.target?.name) {
        event.action.target.name = event.action.target.name.replace(JWT_PATTERN, "");
      }
      if (event.type === "error") {
        const errorMessage = event.error?.message || "";
        const errorStack = event.error?.stack || "";
        const shouldIgnore = IGNORED_ERROR_PATTERNS.some(
          (pattern) => pattern.test(errorMessage) || pattern.test(errorStack),
        );
        if (shouldIgnore || isIgnoredNoise(errorMessage, errorStack)) return false;
      }
      return true;
    },
  });

const startLogsSdk = (
  rum: BrowserRumConfig,
  version: string,
  apiVersion: string,
  insecureHTTP: boolean,
): void =>
  openobserveLogs.init({
    clientToken: rum.client_token,
    site: rum.site,
    organizationIdentifier: rum.organization_identifier,
    service: rum.service,
    env: rum.env,
    version,
    forwardErrorsToLogs: true,
    insecureHTTP,
    apiVersion,
    beforeSend: (log) => {
      if (log.view?.url)
        log.view.url = scrubSharePath(scrubAuthParams(log.view.url) ?? log.view.url);
      if (log.view?.referrer)
        log.view.referrer = scrubSharePath(scrubAuthParams(log.view.referrer));
      if (log.http?.url)
        log.http.url = scrubSharePath(scrubAuthParams(log.http.url) ?? log.http.url);
      log.message = scrubSharePath(scrubAuthParams(log.message) ?? log.message);
      const logMessage = log.message || "";
      const shouldIgnore = IGNORED_LOG_PATTERNS.some((pattern) => pattern.test(logMessage));
      return !(shouldIgnore || isIgnoredNoise(logMessage));
    },
  });
