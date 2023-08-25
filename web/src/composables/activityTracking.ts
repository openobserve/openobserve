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
import { datadogRum } from "@datadog/browser-rum";
import "@datadog/browser-rum/bundle/datadog-rum";
import config from "@/aws-exports";

const userActivityTracking = () => {
  const store = useStore();

  const initializeTracking = () => {
    datadogRum.init({
      applicationId: config.ddApplicationID,
      clientToken: config.ddClientToken,
      site: config.ddSite,
      service: config.ddService,
      env: config.environment,
      // Specify a version number to identify the deployed version of your application in Datadog
      // version: '1.0.0',
      sessionSampleRate: 100,
      premiumSampleRate: 100,
      trackUserInteractions: true,
      defaultPrivacyLevel: "mask-user-input",
    });

    datadogRum.startSessionReplayRecording();
  };

  const setUser = () => {
    datadogRum.setUser({
      name:
        store.state.userInfo.given_name +
        " " +
        store.state.userInfo.family_name,
      email: store.state.userInfo.email,
    });
  };

  const setUserProperty = (key: string, value: any) => {
    datadogRum.removeUserProperty(key);
    datadogRum.setUserProperty(key, value);
  };

  const setGlobalContext = (obj: {}) => {
    datadogRum.setGlobalContext(obj);
  };

  const setGlobalContextProperty = (key: string, value: any) => {
    datadogRum.removeGlobalContextProperty(key);
    datadogRum.setGlobalContextProperty(key, value);
  };

  const catchError = (error: any) => {
    datadogRum.addError(error, {
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
