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

export default createStore({
  state: {
    API_ENDPOINT: API_ENDPOINT,
    userInfo: {},
    loggedIn: false,
    loadingState: true,
    errorLoadingState: false,
    indexData: [],
    selectedOrganization: useLocalOrganization() ? useLocalOrganization() : {},
    organizations: [],
    currentuser: useLocalCurrentUser() ? useLocalCurrentUser() : {},
    searchCollapsibleSection: 20,
    organizationPasscode: "",
    theme: "",
    // allCurrentDashboards: {},
    // currentSelectedDashboard: {},
    // currentPanelsData: [],
    allDashboardList: [],
    search: {
      query: {
        dateVal: {
          tab: "relative",
          startDate: new Date().toLocaleDateString("en-ZA"),
          startTime: "00:00",
          endDate: new Date().toLocaleDateString("en-ZA"),
          endTime: "23:59",
          selectedRelativePeriod: "Minutes",
          selectedRelativeValue: 15,
          selectedFullTime: false,
        },
      },
    },
    streamFields: [],
    quotaThresholdMsg: "",
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
    setIndexData(state, payload) {
      state.indexData = payload;
    },
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
      state.organizationPasscode = payload;
    },
    // setAllCurrentDashboards(state, payload) {
    //   state.allCurrentDashboards = payload;
    // },
    // setCurrentSelectedDashboard(state, payload) {
    //   state.currentSelectedDashboard = payload;
    // },
    setAllDashboardList(state, payload) {
      state.allDashboardList = payload;
    },
    setSearch(state, payload) {
      state.search = payload;
    },
    setStreamFields(state, payload) {
      state.streamFields = payload;
    },
    // setCurrentPanelsData(state, payload) {
    //   state.currentPanelsData = payload;
    // },
    setQuotaThresholdMsg(state, payload) {
      state.quotaThresholdMsg = payload;
    },
    setConfig(state, payload) {
      state.zoConfig = payload;
    },
    appTheme(state, payload) {
      state.theme = payload;
    }
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
    setIndexData(context, payload) {
      context.commit("setIndexData", payload);
    },
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
    // setAllCurrentDashboards(context, payload) {
    //   context.commit('setAllCurrentDashboards', payload);
    // },
    // setCurrentSelectedDashboard(context, payload) {
    //   context.commit('setCurrentSelectedDashboard', payload);
    // },
    setAllDashboardList(context, payload) {
      context.commit("setAllDashboardList", payload);
    },
    setSearch(context, payload) {
      context.commit("setSearch", payload);
    },
    setStreamFields(context, payload) {
      context.commit("setStreamFields", payload);
    },
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
    }
  },
  modules: {},
});
