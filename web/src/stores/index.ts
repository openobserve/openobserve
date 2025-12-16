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
import {
  useLocalOrganization,
  useLocalCurrentUser,
  useLocalTimezone,
} from "../utils/zincutils";
import streams from "./streams";
import logs from "./logs";

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
  allDashboardData: {},
  allAlertsListByFolderId: {},
  allAlertsListByNames: {},
  allDashboardListHash: {},
  rumToken: {
    rum_token: "",
  },
  quotaThresholdMsg: "",
  functions: [],
  actions: [],
  streams: {},
  folders: [],
  foldersByType: [],
  organizationSettings: {
    scrape_interval: 15,
    trace_id_field_name: "trace_id",
    span_id_field_name: "span_id",
    free_trial_expiry: "",
  },
  isDataIngested: false,
  regexPatterns: [],
  regexPatternPrompt: "",
  regexPatternTestValue: ""
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
    printMode: false,
    organizationData: JSON.parse(JSON.stringify(organizationObj)),
    zoConfig: <{ [key: string]: any }>{},
    timezone: useLocalTimezone()
      ? useLocalTimezone()
      : Intl.DateTimeFormat().resolvedOptions().timeZone,
    savedViewDialog: false,
    refreshIntervalID: 0,
    savedViewFlag: false,
    savedFunctionDialog: false,
    regionInfo: [],
    hiddenMenus: [],
    sessionId: "",
    webSocketUrl: "",
    allApiLimitsByOrgId: {},
    allRoleLimitsByOrgIdByRole: {},
    modulesToDisplay: {},
    isAiChatEnabled: false,
    currentChatTimestamp: null,
    chatUpdated: false,
    // SRE Chat state
    isSREChatOpen: false,
    sreChatContext: {
      type: null,
      data: null,
    },
    // Default theme colors (Default Blue theme)
    // These are the application's default colors used as fallback when no custom colors are set
    // Centralized here so they can be updated in one place instead of duplicating across components
    defaultThemeColors: {
      light: "#3F7994",  // Default light mode color (Blue)
      dark: "#5B9FBE",   // Default dark mode color (Light Blue)
    },
    // Temporary theme colors for live preview in General Settings
    // These colors are stored here (instead of component state) so they persist
    // across navigation and are accessible to all components for preview
    // - Set when user drags color picker in General Settings
    // - Applied by App.vue and PredefinedThemes.vue for live preview
    // - Cleared when user clicks "Save" (saved permanently to localStorage & backend)
    // - Prevents other watchers/observers from overriding the preview color
    tempThemeColors: {
      light: null,  // Hex color string (e.g., "#FF0000") or null
      dark: null,   // Hex color string (e.g., "#0000FF") or null
    },
    // Share URL state for Safari-compatible clipboard copy
    // Polling mechanism checks this value and copies when available
    pendingShortURL: null,
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
    setIsSREChatOpen(state, payload) {
      state.isSREChatOpen = payload;
    },
    setCurrentChatTimestamp(state, payload) {
      state.currentChatTimestamp = payload;
    },
    setChatUpdated(state, payload) {
      state.chatUpdated = payload;
    },
    setRegexPatterns(state, payload) {
      state.organizationData.regexPatterns = payload;
    },
    /**
     * Set temporary theme color for live preview
     * Called when user drags color picker in General Settings
     * @param payload - { mode: 'light' | 'dark', color: '#hexcolor' }
     * Example: { mode: 'light', color: '#FF0000' }
     */
    setTempThemeColor(state, payload) {
      state.tempThemeColors[payload.mode] = payload.color;
    },
    /**
     * Clear temporary theme colors
     * Called when user clicks "Save" in General Settings (colors now permanently saved)
     * or when user cancels/discards the preview
     */
    clearTempThemeColors(state) {
      state.tempThemeColors.light = null;
      state.tempThemeColors.dark = null;
    },
    /**
     * Set pending short URL for polling-based clipboard copy
     * Called after short URL API completes successfully
     * @param payload - The short URL string to be copied
     */
    setPendingShortURL(state, payload) {
      state.pendingShortURL = payload;
    },
    /**
     * Clear pending short URL after successful copy
     */
    clearPendingShortURL(state) {
      state.pendingShortURL = null;
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
    setIsSREChatOpen(context, payload) {
      context.commit("setIsSREChatOpen", payload);
    },
    setCurrentChatTimestamp(context, payload) {
      context.commit("setCurrentChatTimestamp", payload);
    },
    setChatUpdated(context, payload) {
      context.commit("setChatUpdated", payload);
    },
    setRegexPatterns(context, payload) {
      context.commit("setRegexPatterns", payload);
    },
  },
  modules: {
    streams,
    logs
  },
});
