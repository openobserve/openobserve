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

import { createStore } from "vuex";

const store = createStore({
  state: {
    API_ENDPOINT: "http://localhost:5080",
    isAiChatEnabled: false,
    
    theme: "dark",
    timezone: "UTC",
    selectedOrganization: {
      label: "default Organization",
      id: 159,
      identifier: "default",
      user_email: "example@gmail.com",
      subscription_type: "",
    },
    refreshIntervalID: null,
    currentuser: {
      role: "",
    },
    userInfo: {
      at_hash: "QicVZWM5kDY6hOzf",
      email_verified: false,
      given_name: "example",
      picture: "",
      aud: "31ds0mr4psua0p58353l3t6j61",
      token_use: "id",
      auth_time: 1678689752,
      name: "example",
      exp: 1678776152,
      iat: 1678689753,
      family_name: "example",
      email: "example@gmail.com",
    },  
    savedViewDialog: false,
    regionInfo: [],
    zoConfig: {
      sql_mode: false,
      version: "v0.2.0",
      sql_mode_manual_trigger: false,
      commit_hash: "dc2b38c0f8be27bde395922d61134f09a3b4c",
      build_date: "2023-03-11T03:55:28Z",
      default_fts_keys: ["log", "message", "msg", "content", "data"],
      show_stream_stats_doc_num: true,
      data_retention_days: true,
      extended_data_retention_days: 45,
      user_defined_schemas_enabled: true,
      super_cluster_enabled: false,
      query_on_stream_selection: false,
      default_functions: [
        {
          name: "match_all",
          text: "match_all('v')",
        },
        {
          name: "str_match",
          text: "str_match(field, 'v')",
        },
        {
          name: "str_match_ignore_case",
          text: "str_match_ignore_case(field, 'v')",
        },
        {
          name: "re_match",
          text: "re_match(field, 'pattern')",
        },
        {
          name: "re_not_match",
          text: "re_not_match(field, 'pattern')",
        },
      ],
      timestamp_column: "_timestamp"
    },
    organizationData: {
      organizationPasscode: "",
      allDashboardList: {},
      rumToken: {
        rum_token: "",
      },
      quotaThresholdMsg: "",
      functions: [],
      streams: {},
      folders: [],
      organizationSettings: {
        scrape_interval: 15,
        trace_id_field_name: "trace_id",
        span_id_field_name: "span_id",
      },
      isDataIngested: false,
      allDashboardData: {},
      foldersByType:[],
    },
    streams:{
      logs:{
        
      }
    }

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
    setAllAlertsListByFolderId(state, payload) {
      state.organizationData.allAlertsListByFolderId = payload;
    },
    setAllAlertsListByNames(state, payload) {
      state.organizationData.allAlertsListByNames = payload;
    },
    setDashboardData(state, payload) {
      state.organizationData.allDashboardData = payload;
    },
    setAllDashboardListHash(state, payload) {
      state.organizationData.allDashboardListHash = payload;
    },
    setOrganizationSettings(state, payload) {
      state.organizationData.organizationSettings = payload;
    },
    setFunctions(state, payload) {
      state.organizationData.functions = payload;
    },
    setActions(state, payload) {
      state.organizationData.actions = payload;
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
    setFoldersByType(state, payload) {
      state.organizationData.foldersByType = payload;
    },
    appTheme(state, payload) {
      state.theme = payload;
    },
    setPrintMode(state, payload) {
      state.printMode = payload;
    },
    setTimezone(state, payload) {
      state.timezone = payload;
    },
    setSavedViewDialog(state, payload) {
      state.savedViewDialog = payload;
    },
    setRefreshIntervalID(state, payload) {
      state.refreshIntervalID = payload;
    },
    setSavedViewFlag(state, payload) {
      state.savedViewFlag = payload;
    },
    setSavedFunctionDialog(state, payload) {
      state.savedFunctionDialog = payload;
    },
    setIsDataIngested(state, payload) {
      state.organizationData.isDataIngested = payload;
    },
    setRegionInfo(state, payload) {
      state.regionInfo = payload;
    },
    setHiddenMenus(state, payload) {
      state.hiddenMenus = payload;
    },
    setApiLimitsByOrgId(state, payload) {
      state.allApiLimitsByOrgId = payload;
    },
    setRoleLimitsByOrgIdByRole(state, payload) {
      state.allRoleLimitsByOrgIdByRole = payload;
    },
    setModulesToDisplay(state, payload) {
      state.modulesToDisplay = payload;
    },
    setIsAiChatEnabled(state, payload) {
      state.isAiChatEnabled = payload;
    },
    setCurrentChatTimestamp(state, payload) {
      state.currentChatTimestamp = payload;
    },
    setChatUpdated(state, payload) {
      state.chatUpdated = payload;
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
    setUserInfo(context, payload) {
      context.commit("setUserInfo", payload);
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
    setAllAlertsListByFolderId(context, payload) {
      context.commit("setAllAlertsListByFolderId", payload);
    },
    setAllAlertsListByNames(context, payload) {
      context.commit("setAllAlertsListByNames", payload);
    },
    setDashboardData(context, payload) {
      context.commit("setDashboardData", payload);
    },
    setAllDashboardListHash(context, payload) {
      context.commit("setAllDashboardListHash", payload);
    },
    setOrganizationSettings(context, payload) {
      context.commit("setOrganizationSettings", payload);
    },
    setFolders(context, payload) {
      context.commit("setFolders", payload);
    },
    setFoldersByType(context, payload) {
      context.commit("setFoldersByType", payload);
    },
    setFunctions(context, payload) {
      context.commit("setFunctions", payload);
    },
    setActions(context, payload) {
      context.commit("setActions", payload);
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
    setPrintMode(context, payload) {
      context.commit("setPrintMode", payload);
    },
    setTimezone(context, payload) {
      context.commit("setTimezone", payload);
    },
    setSavedViewDialog(context, payload) {
      context.commit("setSavedViewDialog", payload);
    },
    setRefreshIntervalID(context, payload) {
      context.commit("setRefreshIntervalID", payload);
    },
    setSavedViewFlag(context, payload) {
      context.commit("setSavedViewFlag", payload);
    },
    setSavedFunctionDialog(context, payload) {
      context.commit("setSavedFunctionDialog", payload);
    },
    setIsDataIngested(context, payload) {
      context.commit("setIsDataIngested", payload);
    },
    setRegionInfo(context, payload) {
      context.commit("setRegionInfo", payload);
    },
    setHiddenMenus(context, payload) {
      context.commit("setHiddenMenus", payload);
    },
    setApiLimitsByOrgId(context, payload) {
      context.commit("setApiLimitsByOrgId", payload);
    },
    setRoleLimitsByOrgIdByRole(context, payload) {
      context.commit("setRoleLimitsByOrgIdByRole", payload);
    },
    setModulesToDisplay(context, payload) {
      context.commit("setModulesToDisplay", payload);
    },
    setIsAiChatEnabled(context, payload) {
      context.commit("setIsAiChatEnabled", payload);
    },
    setCurrentChatTimestamp(context, payload) {
      context.commit("setCurrentChatTimestamp", payload);
    },
    setChatUpdated(context, payload) {
      context.commit("setChatUpdated", payload);
    },
  },
});

export default store;
