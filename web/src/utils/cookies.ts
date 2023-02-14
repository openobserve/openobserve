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

import Keys from "../constants/key";
// @ts-ignore
import Cookies from "js-cookie";

export const getSidebarStatus = () => Cookies.get(Keys.sidebarStatusKey);
export const setSidebarStatus = (sidebarStatus: string) =>
  Cookies.set(Keys.sidebarStatusKey, sidebarStatus, { path: "/" });

export const getLanguage = () => Cookies.get(Keys.languageKey);
export const setLanguage = (language: string) =>
  Cookies.set(Keys.languageKey, language, { path: "/" });

export const getSize = () => Cookies.get(Keys.sizeKey);
export const setSize = (size: string) =>
  Cookies.set(Keys.sizeKey, size, { path: "/" });

export const getToken = () => Cookies.get(Keys.tokenKey);
export const setToken = (token: string) =>
  Cookies.set(Keys.tokenKey, token, { path: "/" });
export const removeToken = () => Cookies.remove(Keys.tokenKey);
