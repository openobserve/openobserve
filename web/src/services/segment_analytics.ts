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

import { RudderAnalytics } from "@rudderstack/analytics-js";
import config from "../aws-exports";

const writeKey = "ziox-cloud-browser";
const dataPlaneUrl = "https://e1.zinclabs.dev";

// Create a new instance of RudderAnalytics
const rudderanalytics = new RudderAnalytics();

if (config.enableAnalytics == "true") {
  try {
    // Load the SDK first before registering callbacks
    rudderanalytics.load(writeKey, dataPlaneUrl, {
      configUrl: "https://e1.zinclabs.dev/v1/config",
      // Prevent SDK from throwing errors to console
      loadIntegration: false, // Don't auto-load destination integrations
      useBeacon: false, // Disable beacon API which can cause issues
      logLevel: "ERROR", // Only log actual errors, not warnings
    });

    // Register the ready callback after load
    rudderanalytics.ready(() => {
      console.log("RudderStack analytics initialized successfully");
    });
  } catch (error) {
    // Silently handle initialization errors - analytics is not critical
    // These errors typically occur when:
    // 1. Config endpoint is unreachable
    // 2. Network/CORS issues
    // 3. Invalid write key or data plane URL
    console.warn("Analytics initialization failed (non-critical):", error);
  }
}
export default rudderanalytics;
