// Copyright 2023 Zinc Labs Inc.

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import { createApp } from "vue";
import { Notify, Dialog, Quasar } from "quasar";
import "quasar/src/css/index.sass";
import "@quasar/extras/roboto-font/roboto-font.css";

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

    openobserveRum.init({
      applicationId: "web-application-id", // required, any string identifying your application
      clientToken: "rumqRPQYJv76RcPEfo0",
      site: "test2.gke.zinclabs.dev",
      organizationIdentifier: "default",
      service: "alpha1-cloud",
      env: "alpha1",
      version: "1.0.0",
      sessionSampleRate: 100,
      sessionReplaySampleRate: 100, // if not included, the default is 100
      trackResources: true,
      trackLongTasks: true,
      trackUserInteractions: true,
      apiVersion: "v1",
      insecureHTTP: false,
    });

    openobserveLogs.init({
      clientToken: "rumqRPQYJv76RcPEfo0",
      site: "test2.gke.zinclabs.dev",
      organizationIdentifier: "default",
      forwardErrorsToLogs: true,
      sessionSampleRate: 100,
      insecureHTTP: false,
      apiVersion: "v1",
      service: "alpha1-cloud",
    });

    openobserveRum.startSessionReplayRecording();

    datadogRum.init({
      applicationId: "04d3b6de-51c1-49d5-a693-504293e3d36f", // required, any string identifying your application
      clientToken: "pub7021787ca082769936566dbefdd0d13c",
      site: "us5.datadoghq.com",
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
      clientToken: "pub7021787ca082769936566dbefdd0d13c",
      site: "us5.datadoghq.com",
      forwardErrorsToLogs: true,
      sessionSampleRate: 100,
      version: "v1",
    });

    openobserveRum.startSessionReplayRecording();
  });
};

getConfig();

app.mount("#app");
