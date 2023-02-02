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

app
  .use(Quasar, {
    plugins: [Dialog, Notify], // import Quasar plugins and add here
  })
  .use(i18n);

// const router = createRouter(store);
app.use(store).use(router);
app.use(SearchPlugin);

app.mount("#app");
