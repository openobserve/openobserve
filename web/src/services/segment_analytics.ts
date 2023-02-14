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
