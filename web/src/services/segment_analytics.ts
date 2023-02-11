// import { AnalyticsBrowser, Analytics } from "@segment/analytics-next";
import * as rudderanalytics from "rudder-sdk-js";
import config from "../aws-exports";
// add segment analytics

const writeKey = "ziox-cloud-browser";
const dataPlaneUrl = "https://e1.zinclabs.dev";
// const writeKey: "CGi3aENuM7L0v1jGtSC9QEhnIVmDAEFm",

// const analytics = AnalyticsBrowser.load({
//   writeKey: writeKey,
//   cdnURL: "https://e1.zinclabs.dev",
//   cdnSettings: {
//     integrations: {
//       "Segment.io": {
//         apiHost: "e1.zinclabs.dev/v1", // this what enables js to start sending events to the custom endpoint
//       },
//     },
//   },
// });

if (config.enableAnalytics == "true") {
  rudderanalytics.ready(() => {
    console.log("we are all set!!!");
  });

  // opt = rudderanalytics.
  rudderanalytics.load(writeKey, dataPlaneUrl, {
    configUrl: "https://e1.zinclabs.dev/v1/config",
  });
}
export default rudderanalytics ;


// analytics.identify("hello world");

// document.body?.addEventListener("click", () => {
//   analytics.track("document body clicked!");
// });
// end segment analytics

// export default analytics;
