import { openobserveRum } from "@openobserve/browser-rum";
import { openobserveLogs } from "@openobserve/browser-logs";

function init() {
  openobserveLogs.init({
    // clientToken: 'rumVDSt7Klh7Ab58Jls',
    // site: "dev2.gke.zinclabs.dev",
    // organizationIdentifier: "default",

    // Root account
    // clientToken: 'rumgoz3Own00Iy8NFAd',
    // site: "localhost:5080",

    clientToken: "rumuVZvPGwvTdI1bXbJ",
    site: "alpha2.dev.zinclabs.dev",

    // Custom account
    // clientToken: 'rumAL8JLld2Wu5t1MZY',
    // site: "localhost:5080",
    organizationIdentifier: "org_1",

    service: "oo_rum",
    env: "production",
    version: "0.0.1",

    forwardErrorsToLogs: true,
    forwardConsoleLogs: "all",
    sessionSampleRate: 100,
    insecureHTTP: false,
    apiVersion: "v1",
  });

  openobserveRum.init({
    // datadogRum.init({
    applicationId: "1",
    // organizationIdentifier: "default",
    // clientToken: 'rumVDSt7Klh7Ab58Jls',
    // site: "dev2.gke.zinclabs.dev",

    // Root account
    // clientToken: 'rumgoz3Own00Iy8NFAd',
    // site: "localhost:5080",

    clientToken: "rumuVZvPGwvTdI1bXbJ",
    site: "alpha2.dev.zinclabs.dev",

    // Custom account
    // clientToken: 'rumAL8JLld2Wu5t1MZY',
    // site: "localhost:5080",
    organizationIdentifier: "org_1",

    service: "oo_rum",
    env: "production",
    version: "0.0.1",
    sessionSampleRate: 100,
    sessionReplaySampleRate: 100, // if not included, the default is 100
    trackResources: true,
    trackLongTasks: true,
    trackUserInteractions: true,
    insecureHTTP: false,
    apiVersion: "v1",
    allowedTracingUrls: [],
    // enableGeoInfo: true,
    beforeSend: (event) => {
      // if (event.type === "resource" && event.resource.type === "fetch" && event.resource.status_code >= 500) {
      // if (event.type === "resource" ) {
      // console.log(event._dd.trace_id);
      // logger.error('Request failed. Your error id is ${event._dd.trace_id}');
      // }
    },
  });

  openobserveRum.setUser({
    id: "1234",
    name: "John Doe",
    email: "john@doe.com",
  });

  openobserveRum.startSessionReplayRecording();
  // datadogRum.startSessionReplayRecording();
  openobserveRum.addRumGlobalContext;
}

export default init;
