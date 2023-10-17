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

import { createStore } from "vuex";
import { useLocalOrganization, useLocalCurrentUser } from "../utils/zincutils";

const pos = window.location.pathname.indexOf("/web/");

const API_ENDPOINT = import.meta.env.VITE_OPENOBSERVE_ENDPOINT
  ? import.meta.env.VITE_OPENOBSERVE_ENDPOINT.endsWith("/")
    ? import.meta.env.VITE_OPENOBSERVE_ENDPOINT.slice(0, -1)
    : import.meta.env.VITE_OPENOBSERVE_ENDPOINT
  : window.location.origin == "http://localhost:8081"
    ? "/"
    : pos > -1
      ? window.location.origin + window.location.pathname.slice(0, pos)
      : window.location.origin;

const organizationObj = {
  organizationPasscode: "",
  allDashboardList: {},
  rumToken: {
    rum_token: "",
  },
  quotaThresholdMsg: "",
  functions: [],
  streams: {},
  folders: [],
};

export default createStore({
  state: {
    API_ENDPOINT: API_ENDPOINT,
    userInfo: {},
    loggedIn: false,
    loadingState: true,
    errorLoadingState: false,
    selectedOrganization: useLocalOrganization() ? useLocalOrganization() : {},
    organizations: [],
    currentuser: useLocalCurrentUser() ? useLocalCurrentUser() : {},
    searchCollapsibleSection: 20,
    theme: "",
    organizationData: JSON.parse(JSON.stringify(organizationObj)),
    zoConfig: {},
  },
  mutations: {
    login(state, payload) {
      if (payload) {
        state.loggedIn = payload.loginState;
        state.userInfo = payload.userInfo;
      }
    },
    logout(state) {
      state.loggedIn = false;
      state.userInfo = {};
    },
    endpoint(state, payload) {
      state.API_ENDPOINT = payload;
    },
    setUserInfo(state, payload) {
      state.userInfo = payload;
    },
    // setIndexData(state, payload) {
    //   state.indexData = payload;
    // },
    setSelectedOrganization(state, payload) {
      state.selectedOrganization = payload;
    },
    setOrganizations(state, payload) {
      state.organizations = payload;
    },
    setCurrentUser(state, payload) {
      state.currentuser = payload;
    },
    setSearchCollapseToggle(state, payload) {
      state.searchCollapsibleSection = payload;
    },
    setOrganizationPasscode(state, payload) {
      state.organizationData.organizationPasscode = payload;
    },
    resetOrganizationData(state, payload) {
      state.organizationData = JSON.parse(JSON.stringify(organizationObj));
    },
    setRUMToken(state, payload) {
      state.organizationData.rumToken = payload;
    },
    // setAllCurrentDashboards(state, payload) {
    //   state.allCurrentDashboards = payload;
    // },
    // setCurrentSelectedDashboard(state, payload) {
    //   state.currentSelectedDashboard = payload;
    // },
    setAllDashboardList(state, payload) {
      state.organizationData.allDashboardList = payload;
    },
    setFunctions(state, payload) {
      state.organizationData.functions = payload;
    },
    setStreams(state, payload) {
      state.organizationData.streams[payload.name] = payload;
    },
    resetStreams(state, payload) {
      state.organizationData.streams = payload;
    },
    // setSearch(state, payload) {
    //   state.search = payload;
    // },
    // setStreamFields(state, payload) {
    //   state.streamFields = payload;
    // },
    // setCurrentPanelsData(state, payload) {
    //   state.currentPanelsData = payload;
    // },
    setQuotaThresholdMsg(state, payload) {
      state.organizationData.quotaThresholdMsg = payload;
    },
    setConfig(state, payload) {
      state.zoConfig = payload;
    },
    setFolders(state, payload) {
      state.organizationData.folders = payload;
    },
    appTheme(state, payload) {
      state.theme = payload;
    },
  },
  actions: {
    login(context, payload) {
      context.commit("login", payload);
    },
    logout(context) {
      context.commit("logout");
    },
    endpoint(context, payload) {
      context.commit("endpoint", payload);
    },
    // setIndexData(context, payload) {
    //   context.commit("setIndexData", payload);
    // },
    setSelectedOrganization(context, payload) {
      context.commit("setSelectedOrganization", payload);
    },
    setOrganizations(context, payload) {
      context.commit("setOrganizations", payload);
    },
    setCurrentUser(context, payload) {
      context.commit("setCurrentUser", payload);
    },
    setSearchCollapseToggle(context, payload) {
      context.commit("setSearchCollapseToggle", payload);
    },
    setOrganizationPasscode(context, payload) {
      context.commit("setOrganizationPasscode", payload);
    },
    resetOrganizationData(context, payload) {
      context.commit("resetOrganizationData", payload);
    },
    setRUMToken(context, payload) {
      context.commit("setRUMToken", payload);
    },
    // setAllCurrentDashboards(context, payload) {
    //   context.commit('setAllCurrentDashboards', payload);
    // },
    // setCurrentSelectedDashboard(context, payload) {
    //   context.commit('setCurrentSelectedDashboard', payload);
    // },
    setAllDashboardList(context, payload) {
      context.commit("setAllDashboardList", payload);
    },
    setFolders(context, payload) {
      context.commit("setFolders", payload);
    },
    setFunctions(context, payload) {
      context.commit("setFunctions", payload);
    },
    setStreams(context, payload) {
      context.commit("setStreams", payload);
    },
    resetStreams(context, payload) {
      context.commit("resetStreams", payload);
    },
    // setSearch(context, payload) {
    //   context.commit("setSearch", payload);
    // },
    // setStreamFields(context, payload) {
    //   context.commit("setStreamFields", payload);
    // },
    // setCurrentPanelsData(context, payload) {
    //   context.commit('setCurrentPanelsData', payload);
    // },
    setQuotaThresholdMsg(context, payload) {
      context.commit("setQuotaThresholdMsg", payload);
    },
    setConfig(context, payload) {
      context.commit("setConfig", payload);
    },
    appTheme(context, payload) {
      context.commit("appTheme", payload);
    },
  },
  modules: {},
});
