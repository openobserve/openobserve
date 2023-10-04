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

export const config = {
  userPoolsId: import.meta.env.VITE_USER_POOLS_ID,
  webClientId: import.meta.env.VITE_WEB_CLIENT_ID,
  oAuthDomain: import.meta.env.VITE_OAUTH_DOMAIN,
  redirectSignIn: import.meta.env.VITE_REDIRECT_SIGNIN,
  redirectSignOut: import.meta.env.VITE_REDIRECT_SIGNOUT,
  ooApplicationID: import.meta.env.VITE_OO_APP_ID,
  ooClientToken: import.meta.env.VITE_OO_CLIENT_TOKEN,
  ooSite: import.meta.env.VITE_OO_SITE,
  ooService: import.meta.env.VITE_OO_SERVICE,
  responseType: "CODE",
  scope: "",
};
