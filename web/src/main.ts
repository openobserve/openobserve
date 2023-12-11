// Copyright 2023 Zinc Labs Inc.
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
import { Notify, Dialog, Quasar } from "quasar";
import "quasar/src/css/index.sass";
import "@quasar/extras/roboto-font/roboto-font.css";
import "@quasar/extras/material-icons/material-icons.css";

import * as Sentry from "@sentry/vue";

import store from "./stores";
import App from "./App.vue";
import createRouter from "./router";
import i18n from "./locales";
import "./styles/quasar-overrides.scss";
import config from "./aws-exports";
import SearchPlugin from "./plugins/index";
import configService from "./services/config";

import { openobserveRum } from "@openobserve/browser-rum";
import { openobserveLogs } from "@openobserve/browser-logs";

import { datadogRum } from "@datadog/browser-rum";
import { datadogLogs } from "@datadog/browser-logs";

const app = createApp(App);
const router = createRouter(store);

app
  .use(Quasar, {
    plugins: {
      Dialog,
      Notify,
    },
  })
  .use(i18n);

// const router = createRouter(store);
app.use(store).use(router);
app.use(SearchPlugin);

const getConfig = async () => {
  await configService.get_config().then((res: any) => {
    store.dispatch("setConfig", res.data);
    config.enableAnalytics = res.data.telemetry_enabled.toString();
    if (res.data.telemetry_enabled == true) {
      Sentry.init({
        app,
        dsn: config.sentryDSN,
        integrations: [
          new Sentry.BrowserTracing({
            routingInstrumentation: Sentry.vueRouterInstrumentation(router),
            tracingOrigins: [
              "localhost",
              "alpha1.cloud.zinclabs.dev",
              "cloud.openobserve.ai",
              /^\//,
            ],
          }),
        ],
        // Set tracesSampleRate to 1.0 to capture 100%
        // of transactions for performance monitoring.
        // We recommend adjusting this value in production
        tracesSampleRate: 1.0,
      });
    }

    const options = {
      clientToken: config.ooClientToken,
      applicationId: config.ooApplicationID,
      site: config.ooSite,
      service: config.ooService,
      env: config.environment,
      version: "0.0.1",
      organizationIdentifier: "default",
      insecureHTTP: false,
      apiVersion: "v1",
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

    openobserveRum.startSessionReplayRecording();

    datadogRum.init({
      applicationId: config.ddAPPID, // required, any string identifying your application
      clientToken: config.ddClientToken,
      site: config.ddSite,
      service: "openobserve",
      // service: "my-web-application",
      // env: "production",
      // version: "1.0.0",
      sessionSampleRate: 100,
      sessionReplaySampleRate: 100, // if not included, the default is 100
      trackResources: true,
      trackLongTasks: true,
      trackUserInteractions: true,
      version: "v1",
      defaultPrivacyLevel: "allow",
    });

    datadogLogs.init({
      clientToken: config.ddClientToken,
      site: config.ddSite,
      forwardErrorsToLogs: true,
      sessionSampleRate: 100,
      version: "v1",
    });

    datadogRum.startSessionReplayRecording();
  });
};

getConfig();

app.mount("#app");
