// Copyright 2026 OpenObserve Inc.
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

export default {
  namespaced: true,
  state: {
    incidents: {},
    cachedData: [], // Cache the actual incidents data
    pageBeforeSearch: 1, // Track page number before search starts (for smart restoration)
    isInitialized: false,
    shouldRefresh: false, // Flag to indicate when data should be refreshed (e.g., after updates)
    statusFilter: "all", // Quick filter tab selection: "all" | "open" | "acknowledged" | "resolved"
  },
  getters: {
    getIncidents(state: any) {
      return state.incidents;
    },
    getCachedData(state: any) {
      return state.cachedData;
    },
    getPageBeforeSearch(state: any) {
      return state.pageBeforeSearch;
    },
    getIsInitialized(state: any) {
      return state.isInitialized;
    },
    getShouldRefresh(state: any) {
      return state.shouldRefresh;
    },
    getStatusFilter(state: any) {
      return state.statusFilter;
    },
  },
  mutations: {
    setIncidents(state: any, incidents: any) {
      state.incidents = incidents;
    },
    setCachedData(state: any, data: any[]) {
      state.cachedData = data;
    },
    setPageBeforeSearch(state: any, page: number) {
      state.pageBeforeSearch = page;
    },
    setIsInitialized(state: any, isInitialized: boolean) {
      state.isInitialized = isInitialized;
    },
    setShouldRefresh(state: any, shouldRefresh: boolean) {
      state.shouldRefresh = shouldRefresh;
    },
    setStatusFilter(state: any, statusFilter: string) {
      state.statusFilter = statusFilter;
    },
    resetIncidents(state: any) {
      state.incidents = {};
      state.cachedData = [];
      state.pageBeforeSearch = 1;
      state.isInitialized = false;
      state.shouldRefresh = false;
      state.statusFilter = "all";
    },
  },
  actions: {
    setIncidents(context: any, incidents: any) {
      context.commit('setIncidents', incidents);
    },
    setCachedData(context: any, data: any[]) {
      context.commit('setCachedData', data);
    },
    setPageBeforeSearch(context: any, page: number) {
      context.commit('setPageBeforeSearch', page);
    },
    setIsInitialized(context: any, isInitialized: boolean) {
      context.commit('setIsInitialized', isInitialized);
    },
    setShouldRefresh(context: any, shouldRefresh: boolean) {
      context.commit('setShouldRefresh', shouldRefresh);
    },
    setStatusFilter(context: any, statusFilter: string) {
      context.commit('setStatusFilter', statusFilter);
    },
    resetIncidents(context: any) {
      context.commit('resetIncidents');
    },
  },
};
