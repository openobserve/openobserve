// Copyright 2023 OpenObserve Inc.
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

import { createApp } from "vue";
import { Notify, Dialog, Quasar, AppFullscreen } from "quasar";
import "quasar/src/css/index.sass";
import "@quasar/extras/roboto-font/roboto-font.css";
import "@quasar/extras/material-icons/material-icons.css";

import store from "./stores";
import App from "./App.vue";
import createRouter from "./router";
import i18n from "./locales";
import "./styles/quasar-overrides.scss";
import "./styles/tailwind.css";
import config from "./aws-exports";
import configService from "./services/config";

import { openobserveRum } from "@openobserve/browser-rum";
import { openobserveLogs } from "@openobserve/browser-logs";
import { useReo } from "./services/reodotdev_analytics";
import { contextRegistry, createDefaultContextProvider } from "./composables/contextProviders";
import { buildVersionChecker } from "./utils/buildVersionChecker";


const app = createApp(App);
const router = createRouter(store);

app
  .use(Quasar, {
    plugins: {
      Dialog,
      Notify,
      AppFullscreen,
    },
  })
  .use(i18n);

// const router = createRouter(store);
app.use(store).use(router);

// Initialize default context provider globally
const defaultProvider = createDefaultContextProvider(router, store);
contextRegistry.register('default', defaultProvider);

const { reoInit } = useReo();

reoInit();



// app.use(SearchPlugin);

const getConfig = async () => {
  await configService.get_config().then((res: any) => {
    store.dispatch("setConfig", res.data);
    config.enableAnalytics = res.data.telemetry_enabled.toString();

    // Store initial commit hash for version checking
    if (res.data.commit_hash) {
      buildVersionChecker.setInitialVersion(res.data.commit_hash);
    }
    if (res.data.rum.enabled) {
      const options = {
        clientToken: res.data.rum.client_token,
        applicationId: res.data.rum.application_id,
        site: res.data.rum.site,
        service: res.data.rum.service,
        env: res.data.rum.env,
        version: res.data.rum.version || "0.0.1",
        organizationIdentifier: res.data.rum.organization_identifier,
        insecureHTTP: res.data.rum.insecure_http || false,
        apiVersion: res.data.rum.api_version || "v1",
      };

      openobserveRum.init({
        applicationId: options.applicationId, // required, any string identifying your application
        clientToken: options.clientToken,
        site: options.site,
        organizationIdentifier: options.organizationIdentifier,
        service: options.service,
        env: options.env,
        version: options.version,
        trackResources: true,
        trackLongTasks: true,
        trackUserInteractions: true,
        apiVersion: options.apiVersion,
        insecureHTTP: options.insecureHTTP,
        defaultPrivacyLevel: "allow",
      });

      openobserveLogs.init({
        clientToken: options.clientToken,
        site: options.site,
        organizationIdentifier: options.organizationIdentifier,
        service: options.service,
        env: options.env,
        version: options.version,
        forwardErrorsToLogs: true,
        insecureHTTP: options.insecureHTTP,
        apiVersion: options.apiVersion,
      });

      // Don't start session replay automatically - it will be started after login
      // to avoid capturing login page with "Unknown" user
      // Session replay will be started in Login.vue and MainLayout.vue after user is authenticated
    }
  });
};

getConfig();

// ===== Smart Stale Build Detection (Industry Standard) =====
// Detects stale build errors (new deployment, old chunks deleted) and prompts user to refresh

// Track if notification is already shown to prevent duplicates
let staleNotificationShown = false;

// Helper: Show new version notification (only once)
function showNewVersionNotification() {
  if (staleNotificationShown) {
    return;
  }

  staleNotificationShown = true;
  Notify.create({
    type: "negative",
    message: i18n.global.t("common.chunkLoadErrorMsg"),
    html: true,
    timeout: 0, // Don't auto-dismiss
    actions: [
      {
        label: i18n.global.t("common.refresh"),
        color: "white",
        handler: () => {
          window.location.reload();
        }
      }
    ],
    position: "top",
    icon: "update",
    color: "negative",
    textColor: "white",
    classes: "stale-build-notification"
  });
}

// Handle resource load errors (script/link tags)
window.addEventListener("error", async (event) => {
  const target = event.target as HTMLScriptElement | HTMLLinkElement;

  // Check if the error is from loading a script or stylesheet
  if (target && (target.tagName === "SCRIPT" || target.tagName === "LINK")) {
    const url = target.tagName === "SCRIPT"
      ? (target as HTMLScriptElement).src
      : (target as HTMLLinkElement).href;

    if (!url) return;

    // Only check for OpenObserve's own chunks (relative URLs or same origin)
    // Ignore external CDN resources (absolute URLs with different origins)
    const isOpenObserveResource = (() => {
      try {
        // Resolve relative URLs against current origin
        const resourceUrl = new URL(url, window.location.origin);
        // Only check resources from same origin
        return resourceUrl.origin === window.location.origin;
      } catch (e) {
        // Invalid URL - assume it's a relative path (OpenObserve resource)
        return true;
      }
    })();

    if (isOpenObserveResource) {
      // Smart detection: Check if it's stale build
      const isStale = await buildVersionChecker.isStaleResourceError();

      if (isStale) {
        showNewVersionNotification();
        event.preventDefault();
      }
    }
  }
}, true);

// Handle dynamic import errors (for code splitting)
router.onError(async (error) => {
  const chunkFailedPattern = /Loading chunk [\d]+ failed|Failed to fetch dynamically imported module/i;

  if (chunkFailedPattern.test(error.message)) {
    // Smart detection: Check if it's stale build or network error
    const isStale = await buildVersionChecker.isStaleChunkError(error);

    if (isStale) {
      showNewVersionNotification();
    }
  }
});

app.mount("#app");
