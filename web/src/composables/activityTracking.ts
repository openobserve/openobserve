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

import { useStore } from "vuex";
import { openobserveRum } from "@openobserve/browser-rum";
import "@openobserve/browser-rum/bundle/openobserve-rum";
import config from "@/aws-exports";

const userActivityTracking = () => {
  const store = useStore();
  const initializeTracking = () => {
    openobserveRum.init({
      applicationId: config.ooApplicationID,
      clientToken: config.ooClientToken,
      site: config.ooSite,
      service: config.ooService,
      env: config.environment,
      // Specify a version number to identify the deployed version of your application in Datadog
      // version: '1.0.0',
      sessionSampleRate: 100,
      premiumSampleRate: 100,
      trackUserInteractions: true,
      defaultPrivacyLevel: "mask-user-input",
      // forwardErrorsToLogs: true,
      // forwardConsoleLogs: "all",
      organizationIdentifier: "myorg",
      insecureHTTP: true,
      apiVersion: "v1",
    });

    openobserveRum.startSessionReplayRecording();
  };

  const setUser = (userInfo: any) => {
    openobserveRum.setUser({
      name: userInfo.given_name + " " + userInfo.family_name,
      email: userInfo.email,
    });
  };

  const setUserProperty = (key: string, value: any) => {
    openobserveRum.removeUserProperty(key);
    openobserveRum.setUserProperty(key, value);
  };

  const setGlobalContext = (obj: {}) => {
    openobserveRum.setGlobalContext(obj);
  };

  const setGlobalContextProperty = (key: string, value: any) => {
    openobserveRum.removeGlobalContextProperty(key);
    openobserveRum.setGlobalContextProperty(key, value);
  };

  const catchError = (error: any) => {
    openobserveRum.addError(error, {
      pageURL: window.location.href,
    });
  };

  return {
    setUser,
    initializeTracking,
    setUserProperty,
    setGlobalContextProperty,
    setGlobalContext,
    catchError,
  };
};

export default userActivityTracking;
