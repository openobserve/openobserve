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

import { createApp, type Ref, ref } from "vue";
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
import SearchPlugin from "./plugins/index";
import configService from "./services/config";

import { openobserveRum } from "@openobserve/browser-rum";
import { openobserveLogs } from "@openobserve/browser-logs";

const worker: Ref<Worker | null> = ref(null);

const workerProcessId = ref(0);

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
app.use(SearchPlugin);

const getConfig = async () => {
  await configService.get_config().then((res: any) => {
    store.dispatch("setConfig", res.data);
    config.enableAnalytics = res.data.telemetry_enabled.toString();
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
    }
  });
};

getConfig();

if ('serviceWorker' in navigator) {
  // if (window.Worker) {
  //   worker.value = new Worker(
  //     new URL("./sw.js", import.meta.url),
  //     { type: "module" }
  //   );

  //   // navigator.serviceWorker.register('./sw.js').then(registration => {
  //   //   console.log('Service Worker registered:', registration);

  //     worker.value.addEventListener('updatefound', () => {
  //       // const installingWorker = registration.installing;
  //       // if (installingWorker) {
  //         // installingWorker.onstatechange = () => {
  //           // if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
  //             // A new service worker is installed and ready to take over
  //             console.log('New service worker installed, prompting reload...');
  //             // Notify the service worker to skip waiting and activate
  //             // worker.value.postMessage('skipWaiting');
  //           // }
  //         // };
  //       // }
  //     });
  //   // }).catch(error => {
  //   //   console.error('Service Worker registration failed:', error);
  //   // });
  // }
  navigator.serviceWorker.register('./assets/sw.js', {
    scope: '/web/assets/'
  }).then(registration => {
      console.log('Service Worker registered:', registration);

      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (installingWorker) {
          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // A new service worker is installed and ready to take over
              console.log('New service worker installed, prompting reload...');
              // Notify the service worker to skip waiting and activate
              registration?.waiting?.postMessage('skipWaiting');
            }
          };
        }
    });
  }).catch(error => {
    console.error('Service Worker registration failed:', error);
  });
}

app.mount("#app");
