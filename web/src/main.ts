// Copyright 2022 Zinc Labs Inc. and Contributors

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
import "@quasar/extras/material-icons/material-icons.css";

import * as Sentry from "@sentry/vue";
import { BrowserTracing } from "@sentry/tracing";

import store from "./stores";
import App from "./App.vue";
import createRouter from "./router";
import i18n from "./locales";
import "./styles/quasar-overrides.scss";
// import { config } from "process";
// import { config } from "./constants/config";
import config from "./aws-exports";
import SearchPlugin from "./plugins/index";

const app = createApp(App);

const router = createRouter(store);

if (config.enableAnalytics == "true") {
  Sentry.init({
    app,
    dsn: config.sentryDSN,
    integrations: [
      new BrowserTracing({
        routingInstrumentation: Sentry.vueRouterInstrumentation(router),
        tracingOrigins: [
          "localhost",
          "alpha1.cloud.zinclabs.dev",
          "cloud.zincsearch.com",
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
app
  .use(Quasar, {
    plugins: [Dialog, Notify], // import Quasar plugins and add here
  })
  .use(i18n);

// const router = createRouter(store);
app.use(store).use(router);
app.use(SearchPlugin);

app.mount("#app");
