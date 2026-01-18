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

//Dashboard Manipulation Functions

import dashboardService from "../services/dashboards";
import { toRaw } from "vue";
import { date } from "quasar";
import { convertDashboardSchemaVersion } from "./dashboard/convertDashboardSchemaVersion";
import commonService from "../services/common";


let moment: any;
let momentInitialized = false;

const importMoment = async () => {
  if (!momentInitialized) {
    const momentModule: any = await import("moment");
    moment = momentModule.default;
    momentInitialized = true;
  }
  return moment;
};

export const modifySQLQuery = async (
  currentTimeObj: any,
  querySQL: String,
  timestampColumn: string,
) => {
  await importMoment();

  const startTime = moment(String(currentTimeObj.start_time)).format(
    "YYYY-MM-DDThh:mm:ssZ",
  );
  const endTime = moment(String(currentTimeObj.end_time)).format(
    "YYYY-MM-DDThh:mm:ssZ",
  );
  const replaceString = `time_range(${timestampColumn},'${startTime}', '${endTime}')`;
  let modString: String = "";

  if (querySQL.match(/time_range[^)]*\)/)) {
    modString = querySQL.replace(/time_range[^)]*\)/, replaceString);
  } else if (querySQL.match(/WHERE/)) {
    modString = querySQL.replace(/WHERE/, "WHERE " + replaceString + " and  ");
  } else {
    modString = querySQL;
  }

  moment = null;
  return modString;
};

// ----------- NEW Methods to retrieve dashboard data
export function getConsumableDateTime(dateObj: any) {
  if (dateObj.tab == "relative") {
    // watcher issue based on changeRelativeDate() in logs/Index.vue
    if (typeof dateObj.relative.value == "string") {
      dateObj.relative.value = dateObj.relative.value.replace(/[^\d]/g, "");
    }

    let period = "";
    let periodValue = 0;
    // quasar does not support arithmetic on weeks. convert to days.

    if (dateObj.relative.period.label.toLowerCase() == "weeks") {
      period = "days";
      periodValue = dateObj.relative.value * 7;
    } else {
      period = dateObj.relative.period.label.toLowerCase();
      periodValue = dateObj.relative.value;
    }
    const subtractObject = '{"' + period + '":' + periodValue + "}";

    const endTimeStamp = new Date();
    // if (searchObj.data.resultGrid.currentPage > 0) {
    //   endTimeStamp = searchObj.data.resultGrid.currentDateTime;
    // } else {
    //   searchObj.data.resultGrid.currentDateTime = endTimeStamp;
    // }

    const startTimeStamp = date.subtractFromDate(
      endTimeStamp,
      JSON.parse(subtractObject),
    );

    return {
      start_time: startTimeStamp,
      end_time: endTimeStamp,
    };
  } else {
    let start, end;
    if (dateObj.absolute.date.from == "" && dateObj.absolute.startTime == "") {
      start = new Date();
    } else {
      start = new Date(
        dateObj.absolute.date.from + " " + dateObj.absolute.startTime,
      );
    }
    if (dateObj.absolute.date.to == "" && dateObj.absolute.endTime == "") {
      end = new Date();
    } else {
      end = new Date(dateObj.absolute.date.to + " " + dateObj.absolute.endTime);
    }
    const rVal = {
      start_time: start,
      end_time: end,
    };
    return rVal;
  }
}

//get all dashboards by folderId
//api call
//save to store
//get all dashboards by folderId
//api call
//save to store
export const getAllDashboards = async (store: any, folderId: any) => {
  //call only if we have folderId
  if (!folderId) return;
  try {
    // api call
    const res = await dashboardService.list(
      0,
      1000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier,
      folderId,
      //adding empty string to avoid undefined error as we have added title param in api
      "",
    );

    const migratedDashboards = res.data.dashboards.map((dashboard: any) => ({
      dashboard: {
        version: dashboard.version,
        folderId: dashboard.folder_id,
        folderName: dashboard.folder_name,
        dashboardId: dashboard.dashboard_id,
        title: dashboard.title,
        description: dashboard.description,
        role: dashboard.role,
        owner: dashboard.owner,
        created: dashboard.created,
      },
      hash: dashboard.hash.toString(),
    }));

    // save to store
    store.dispatch("setAllDashboardList", {
      ...store.state.organizationData.allDashboardList,
      [folderId]: migratedDashboards
        .map((dashboard: any) => dashboard.dashboard)
        .sort((a: any, b: any) => b.created.localeCompare(a.created)),
    });
  } catch (error) {
    // handle error
    throw error;
  }
};
export const getFoldersListByType = async (store: any, type: any) => {
  try {
    let folders = (
      await commonService.list_Folders(
        store.state.selectedOrganization.identifier,
        type
      )
    ).data.list;

    // get default folder and append it to top
    let defaultFolder = folders.find((it: any) => it.folderId == "default");
    folders = folders.filter((it: any) => it.folderId != "default");

    if (!defaultFolder) {
      defaultFolder = {
        name: "default",
        folderId: "default",
        description: "default",
      };
    }

    store.dispatch("setFoldersByType", {
      [type]: [
        defaultFolder,
        ...folders.sort((a: any, b: any) => a.name.localeCompare(b.name)),
      ],
    });

    return store.state.organizationData.foldersByType[type];
  } catch (error) {
    throw error;
  }
};

//get all dashboards by folderId if not there then call api else return from store
export const getAllDashboardsByFolderId = async (store: any, folderId: any) => {
  try {
    if (!store.state.organizationData.allDashboardList[folderId]) {
      await getAllDashboards(store, folderId);
    }
    return store.state.organizationData.allDashboardList[folderId];
  } catch (error) {
    throw error;
  }
};

export const getTabDataFromTabId = (dashboardData: any, tabId: any) => {
  // find tab from tabId
  return dashboardData?.tabs?.find((tab: any) => tab.tabId == tabId);
};

const getMaxIAndMaxYFromTab = (tab: any) => {
  let maxI = 0;
  let maxY = 0;
  let lastPanel = tab.panels[tab.panels.length - 1];
  tab.panels.map((it: any) => {
    maxI = Math.max(it.layout?.i || 0, maxI);
    maxY = Math.max(it.layout?.y || 0, maxY);
    // last panel will have max y
    if (maxY == it.layout?.y) {
      lastPanel = it;
    }
  });
  return { maxI, maxY, lastPanel };
};

export const addPanel = async (
  store: any,
  dashboardId: any,
  panelData: any,
  folderId: any,
  tabId: any,
  variablesToUpdate?: { variableNames: string[], newPanelId: string },
  newVariables?: any[],
) => {
  try {
    // get the object of panel data
    // find the dashboard and add the panel data to dashboard object
    // call the update dashboard function

    const currentDashboard = await getDashboard(store, dashboardId, folderId);

    // Add new variables first (from Add Panel session)
    if (newVariables && newVariables.length > 0) {
      if (!currentDashboard.variables) {
        currentDashboard.variables = { list: [] };
      }
      if (!currentDashboard.variables.list) {
        currentDashboard.variables.list = [];
      }

      newVariables.forEach((v: any) => {
        // Check for duplicates
        const index = currentDashboard.variables.list.findIndex(
          (existing: any) => existing.name === v.name,
        );
        if (index === -1) {
          currentDashboard.variables.list.push(v);
        } else {
          // If it exists, overwrite it (in case it was updated)
          currentDashboard.variables.list[index] = v;
        }
      });
    }

    // Update variables if needed (for variables created from Add Panel that use "current_panel")
    if (variablesToUpdate && variablesToUpdate.variableNames.length > 0) {
      currentDashboard.variables?.list?.forEach((variable: any) => {
        if (variablesToUpdate.variableNames.includes(variable.name)) {
          // Check if variable has "current_panel" in panels array
          if (variable.panels?.includes("current_panel")) {
            // Replace "current_panel" with the actual panel ID
            variable.panels = variable.panels.map((id: string) =>
              id === "current_panel" ? variablesToUpdate.newPanelId : id,
            );
          }
        }
      });
    }

    // find tab from tabId
    const tab = getTabDataFromTabId(currentDashboard, tabId);

    if (!tab.panels) {
      tab.panels = [];
    }

    const { maxI, maxY, lastPanel } = getMaxIAndMaxYFromTab(tab);

    const newLayoutObj = {
      x: 0,
      y: tab.panels?.length > 0 ? maxY + 20 : 0,
      w: 96,
      h: 18,
      i: maxI + 1,
      panelId: panelData.id,
      static: false,
    };

    // check if last panel has enthough space to add new panel
    if (tab.panels.length > 0) {
      //check if new panel can be added
      if (192 - (lastPanel.layout.x + lastPanel.layout.w) >= newLayoutObj.w) {
        newLayoutObj.y = lastPanel.layout.y;
        newLayoutObj.x = lastPanel.layout.x + lastPanel.layout.w;
      }
    }

    // if (!currentDashboard.layouts) {
    //   currentDashboard.layouts = [];
    // }
    // currentDashboard.layouts.push(newLayoutObj);

    //set layout of new panel
    panelData.layout = newLayoutObj;
    tab.panels.push(panelData);

    return await updateDashboard(
      store,
      store.state.selectedOrganization.identifier,
      dashboardId,
      currentDashboard,
      folderId ?? "default",
    );
  } catch (error) {
    throw error;
  }
};

export const addVariable = async (
  store: any,
  dashboardId: any,
  variableData: any,
  folderId: any,
) => {
  try {
    const currentDashboard: any = await getDashboard(
      store,
      dashboardId,
      folderId,
    );
    if (!currentDashboard.variables) {
      currentDashboard.variables = {};
      currentDashboard.variables.showDynamicFilters = false;
      currentDashboard.variables.list = [];
    }

    const variableExists = currentDashboard.variables.list.filter(
      (it: any) => it.name == variableData.name,
    );

    if (variableExists.length) {
      throw new Error("Variable with same name already exists");
    }

    currentDashboard.variables.list.push(variableData);

    return await updateDashboard(
      store,
      store.state.selectedOrganization.identifier,
      dashboardId,
      currentDashboard,
      folderId ?? "default",
    );
  } catch (error) {
    throw error;
  }
};

export const deleteVariable = async (
  store: any,
  dashboardId: any,
  variableName: any,
  folderId: any,
) => {
  try {
    // get the object of panel id
    // find the dashboard and remove the panel data to dashboard object
    // call the update dashboard function
    const currentDashboard = await getDashboard(store, dashboardId, folderId);

    //remove panel from current dashboard
    const variableIndex = currentDashboard.variables.list.findIndex(
      (variable: any) => variable.name == variableName,
    );
    currentDashboard.variables.list.splice(variableIndex, 1);
    currentDashboard.variables.list = currentDashboard.variables.list;

    return await updateDashboard(
      store,
      store.state.selectedOrganization.identifier,
      dashboardId,
      currentDashboard,
      folderId ?? "default",
    );
  } catch (error) {
    throw error;
  }
};

export const deletePanel = async (
  store: any,
  dashboardId: any,
  panelId: any,
  folderId: any,
  tabId: any,
) => {
  try {
    // get the object of panel id
    // find the dashboard and remove the panel data to dashboard object
    // call the update dashboard function
    const currentDashboard = await getDashboard(store, dashboardId, folderId);

    // find tab from tabId
    const tab = getTabDataFromTabId(currentDashboard, tabId);

    //remove panel from current dashboard
    const panelIndex = tab.panels.findIndex(
      (panel: any) => panel.id == panelId,
    );
    tab.panels.splice(panelIndex, 1);
    // currentDashboard.panels = currentDashboard.panels;

    //remove layout from current dashboard
    // const layoutIndex = currentDashboard.layouts.findIndex(
    //   (layout: any) => layout.panelId == panelId
    // );
    // currentDashboard.layouts.splice(layoutIndex, 1);
    // currentDashboard.layouts = currentDashboard.layouts;

    await updateDashboard(
      store,
      store.state.selectedOrganization.identifier,
      dashboardId,
      currentDashboard,
      folderId,
    );
  } catch (error) {
    throw error;
  }
};

export const updateVariable = async (
  store: any,
  dashboardId: any,
  variableName: any,
  variableData: any,
  folderId?: any,
) => {
  try {
    // get the object of panel id
    // find the dashboard and remove the panel data to dashboard object
    // call the update dashboard function
    // Get the current dashboard from the store
    const currentDashboard = await getDashboard(store, dashboardId, folderId);
    // Find the index of the variable in the list
    const variableIndex = currentDashboard.variables.list.findIndex(
      (variable: any) => variable.name == variableName,
    );
    //if name already exists
    const variableExists = currentDashboard.variables.list.filter(
      (it: any) => it.name == variableData.name,
    );

    if (variableName != variableData.name && variableExists.length) {
      throw new Error("Variable with same name already exists");
    }

    // Update the variable data in the list
    currentDashboard.variables.list[variableIndex] = variableData;
    // Update the dashboard in the store
    await updateDashboard(
      store,
      store.state.selectedOrganization.identifier,
      dashboardId,
      currentDashboard,
      folderId,
    );
  } catch (error) {
    throw error;
  }
};

export const updatePanel = async (
  store: any,
  dashboardId: any,
  panelData: any,
  folderId: any,
  tabId: any,
) => {
  try {
    // get the object of panel id
    // find the dashboard and remove the panel data to dashboard object
    // call the update dashboard function
    const currentDashboard = await getDashboard(store, dashboardId, folderId);

    // find tab from tabId
    const tab = getTabDataFromTabId(currentDashboard, tabId);

    const panelIndex = tab.panels.findIndex(
      (panel: any) => panel.id == panelData.id,
    );
    tab.panels[panelIndex] = panelData;
    return await updateDashboard(
      store,
      store.state.selectedOrganization.identifier,
      dashboardId,
      currentDashboard,
      folderId,
    );
  } catch (error) {
    throw error;
  }
};

const retrieveAndStoreDashboardData = async (
  store: any,
  dashboardId: any,
  folderId: any,
  apiResponse: any,
) => {
  try {
    const version = apiResponse.data.version;
    const dashboardKey = `v${version}`;
    const dashboardData = apiResponse.data[dashboardKey];
    const hash = apiResponse.data.hash.toString();

    const convertedData = convertDashboardSchemaVersion(dashboardData);

    store.dispatch("setAllDashboardListHash", {
      [dashboardId]: hash,
    });

    store.dispatch("setDashboardData", {
      [dashboardId]: convertedData,
      hash: hash,
    });

    return store.state.organizationData.allDashboardData[dashboardId];
  } catch (error) {
    throw error;
  }
};

export const updateDashboard = async (
  store: any,
  org: any,
  dashboardId: any,
  currentDashboardData: any,
  folderId: any,
) => {
  try {
    const res = await dashboardService.save(
      org,
      dashboardId,
      currentDashboardData,
      folderId,
      store.state.organizationData.allDashboardListHash[dashboardId],
    );

    const apiResponse = await dashboardService.get_Dashboard(
      store.state.selectedOrganization.identifier,
      dashboardId,
      folderId,
    );

    await retrieveAndStoreDashboardData(
      store,
      dashboardId,
      folderId,
      apiResponse,
    );
    await getAllDashboards(store, folderId);

    return res;
  } catch (error) {
    throw error;
  }
};

// Helper function to ensure variables structure exists with proper defaults
const ensureVariablesStructure = (dashboard: any): void => {
  if (!dashboard.variables) {
    dashboard.variables = {
      showDynamicFilters: false,
      list: []
    };
  } else {
    // Ensure showDynamicFilters has a default value
    if (dashboard.variables.showDynamicFilters === undefined) {
      dashboard.variables.showDynamicFilters = false;
    }
    // Ensure list is an array
    if (!Array.isArray(dashboard.variables.list)) {
      dashboard.variables.list = [];
    }
  }
};

export const getDashboard = async (
  store: any,
  dashboardId: any,
  folderId: any,
) => {
  // check if dashboard data is present in store
  let dashboardJson =
    store.state.organizationData.allDashboardData[dashboardId];

  if (!dashboardJson && dashboardId) {
    const apiResponse = await dashboardService.get_Dashboard(
      store.state.selectedOrganization.identifier,
      dashboardId,
      folderId,
    );

    dashboardJson = await retrieveAndStoreDashboardData(
      store,
      dashboardId,
      folderId,
      apiResponse,
    );
  }

  if (!dashboardJson) {
    return {};
  }

  // Ensure variables structure always exists (fix for dashboards with no variables)
  ensureVariablesStructure(dashboardJson);

  // Fix duplicate panel IDs and check if any were found
  const hasDuplicates = fixDuplicatePanelIds(dashboardJson);

  // If duplicates were found, save the dashboard and retrieve it with new IDs
  if (hasDuplicates) {
    // Save the dashboard with fixed IDs
    await updateDashboard(
      store,
      store.state.selectedOrganization.identifier,
      dashboardId,
      dashboardJson,
      folderId ?? "default",
    );

    // Retrieve the dashboard again to get the updated version with new IDs
    const apiResponse = await dashboardService.get_Dashboard(
      store.state.selectedOrganization.identifier,
      dashboardId,
      folderId,
    );

    dashboardJson = await retrieveAndStoreDashboardData(
      store,
      dashboardId,
      folderId,
      apiResponse,
    );

    // Ensure variables structure exists after re-fetching too
    ensureVariablesStructure(dashboardJson);
  }

  return dashboardJson;
};

// Fix duplicate panel.id values by assigning unique ones
const PANEL_ID_PREFIX = "Panel_ID";

const fixDuplicatePanelIds = (dashboardJson: any): boolean => {
  const panelIdSet = new Set<string>();
  let hasDuplicates = false;

  for (const tab of dashboardJson?.tabs || []) {
    if (!Array.isArray(tab?.panels)) continue;

    for (const panel of tab.panels) {
      const originalId = panel?.id;
      if (!originalId) continue;

      if (panelIdSet.has(originalId)) {
        const newId = generateUniquePanelId(panelIdSet);
        panel.id = newId;
        hasDuplicates = true;
      }

      panelIdSet.add(panel.id);
    }
  }

  return hasDuplicates;
};

const generateUniquePanelId = (existingIds: Set<string>): string => {
  let id;
  do {
    id = `${PANEL_ID_PREFIX}${Math.floor(1000000 + Math.random() * 9000000)}`;
  } while (existingIds.has(id));
  return id;
};

export const deleteDashboardById = async (
  store: any,
  dashboardId: any,
  folderId: any,
) => {
  try {
    // Delete the dashboard using the dashboardService
    await dashboardService.delete(
      store.state.selectedOrganization.identifier,
      dashboardId,
      folderId,
    );

    // Get list of all dashboard of all folders
    const allDashboardList = store.state.organizationData.allDashboardList;

    if (allDashboardList[folderId]) {
      // Filter out the deleted dashboard from the list
      const newDashboards = allDashboardList[folderId].filter(
        (dashboard: any) => dashboard.dashboardId !== dashboardId,
      );

      // Update the allDashboardList in the store with the new list
      store.dispatch("setAllDashboardList", {
        ...allDashboardList,
        [folderId]: newDashboards,
      });
    }

    const allDashboardData = store.state.organizationData.allDashboardData;

    if (allDashboardData[dashboardId]) {
      const newDashboardData = { ...allDashboardData };
      delete newDashboardData[dashboardId];

      store.dispatch("setDashboardData", newDashboardData);

      // remove current dashboard hash from allDashboardListHash
      delete store.state.organizationData.allDashboardListHash[dashboardId];

      // update the allDashboardList in the store
      store.dispatch("setAllDashboardListHash", {
        ...store.state.organizationData.allDashboardListHash,
      });
    }
  } catch (error) {
    throw error;
  }
};

export const getPanel = async (
  store: any,
  dashboardId: any,
  panelId: any,
  folderId: any,
  tabId: any,
) => {
  try {
    const currentDashboard = await getDashboard(store, dashboardId, folderId);

    // find tab from tabId
    const tab = getTabDataFromTabId(currentDashboard, tabId);

    const paneldata = tab?.panels?.find((it: any) => it?.id == panelId);

    return paneldata;
  } catch (error) {
    throw error;
  }
};

export const getPanelId = () => {
  return "Panel_ID" + Math.floor(Math.random() * (99999 - 10 + 1)) + 10;
};

export const getTabId = () => {
  return (Math.floor(Math.random() * (99999 - 10 + 1)) + 10).toString();
};

// delete tabs
// have two option to delete tab
// 1. delete the tab with moving panels to other tab
// 2. delete the tab without moving panels to other tab

// it will take one arg called moveToTabName
// if moveToTabName is not provided, it will delete the tab without moving panels
// if moveToTabName is provided, it will delete the tab and move panels to other tab
export const deleteTab = async (
  store: any,
  dashboardId: any,
  folderId: any,
  deleteTabId: any,
  moveToTabId?: any,
) => {
  try {
    const currentDashboard = await getDashboard(store, dashboardId, folderId);

    if (moveToTabId) {
      const deleteTabData = getTabDataFromTabId(currentDashboard, deleteTabId);
      // move panels to other tab
      const moveToTabData = getTabDataFromTabId(currentDashboard, moveToTabId);

      let { maxI, maxY } = getMaxIAndMaxYFromTab(moveToTabData);

      // for each panel, need to recalculate layout object
      deleteTabData.panels.forEach((panel: any) => {
        maxY += 20;
        panel.layout.i = ++maxI;
        panel.layout.y = maxY;
      });

      moveToTabData.panels.push(...deleteTabData.panels);
    }
    // delete the tab
    currentDashboard.tabs = currentDashboard.tabs.filter(
      (tab: any) => tab.tabId != deleteTabId,
    );

    return await updateDashboard(
      store,
      store.state.selectedOrganization.identifier,
      dashboardId,
      currentDashboard,
      folderId ?? "default",
    );
  } catch (error) {
    throw error;
  }
};

export const editTab = async (
  store: any,
  dashboardId: any,
  folderId: any,
  tabId: any,
  tabData: any,
) => {
  try {
    const currentDashboardData = await getDashboard(
      store,
      dashboardId,
      folderId,
    );
    const tab = getTabDataFromTabId(currentDashboardData, tabId);

    // only name will change
    tab.name = tabData.name;

    await updateDashboard(
      store,
      store.state.selectedOrganization.identifier,
      dashboardId,
      currentDashboardData,
      folderId ?? "default",
    );

    // return updated tab
    return tab;
  } catch (error) {
    throw error;
  }
};

export const addTab = async (
  store: any,
  dashboardId: any,
  folderId: any,
  newTabData: any,
) => {
  try {
    // generate tab id
    newTabData.tabId = getTabId();

    const currentDashboardData = await getDashboard(
      store,
      dashboardId,
      folderId,
    );

    currentDashboardData.tabs.push(newTabData);

    await updateDashboard(
      store,
      store.state.selectedOrganization.identifier,
      dashboardId,
      currentDashboardData,
      folderId ?? "default",
    );

    // return new tab data with new tab id
    return newTabData;
  } catch (error) {
    throw error;
  }
};

// move panel to another tab
export const movePanelToAnotherTab = async (
  store: any,
  dashboardId: any,
  panelId: any,
  folderId: any,
  currentTabId: any,
  moveToTabId?: any,
) => {
  try {
    const currentDashboard = await getDashboard(store, dashboardId, folderId);

    const currentTabData = getTabDataFromTabId(currentDashboard, currentTabId);
    const moveToTabData = getTabDataFromTabId(currentDashboard, moveToTabId);

    // panel data
    const panelData = currentTabData.panels.find((it: any) => it.id == panelId);

    // delete panel in currentTab
    currentTabData.panels = currentTabData.panels.filter(
      (panel: any) => panel.id != panelId,
    );

    // Now, add panel to moveToTab
    if (!moveToTabData.panels) {
      moveToTabData.panels = [];
    }

    // need to change layout object
    const { maxI, maxY } = getMaxIAndMaxYFromTab(moveToTabData);

    //set layout of new panel
    panelData.layout.i = maxI + 1;
    panelData.layout.y = maxY + 20;
    moveToTabData.panels.push(panelData);

    return await updateDashboard(
      store,
      store.state.selectedOrganization.identifier,
      dashboardId,
      currentDashboard,
      folderId ?? "default",
    );
  } catch (error) {
    throw error;
  }
};

export const getFoldersList = async (store: any) => {
  try {
    let folders = (
      await dashboardService.list_Folders(
        store.state.selectedOrganization.identifier,
      )
    ).data.list;

    // get default folder and append it to top
    let defaultFolder = folders.find((it: any) => it.folderId == "default");
    folders = folders.filter((it: any) => it.folderId != "default");

    if (!defaultFolder) {
      defaultFolder = {
        name: "default",
        folderId: "default",
        description: "default",
      };
    }

    store.dispatch("setFolders", [
      defaultFolder,
      ...folders.sort((a: any, b: any) => a.name.localeCompare(b.name)),
    ]);

    return store.state.organizationData.folders;
  } catch (error) {
    throw error;
  }
};

export const deleteFolderById = async (store: any, folderId: any) => {
  try {
    await dashboardService.delete_Folder(
      store.state.selectedOrganization.identifier,
      folderId,
    );
    await getFoldersList(store);
  } catch (error) {
    throw error;
  }
};

export const deleteFolderByIdByType = async (store: any, folderId: any, type: any) => {
  try {
    await commonService.delete_Folder(
      store.state.selectedOrganization.identifier,
      type,
      folderId,
    );
    await getFoldersListByType(store, type);
  } catch (error) {
    throw error;
  }
};

export const createFolder = async (store: any, data: any) => {
  try {
    const newFolder = await dashboardService.new_Folder(
      store.state.selectedOrganization.identifier,
      data,
    );
    await getFoldersList(store);
    return newFolder;
  } catch (error) {
    throw error;
  }
};

export const createFolderByType = async (store: any, data: any, type: any) => {
  try {
    const newFolder = await commonService.new_Folder(
      store.state.selectedOrganization.identifier,
      type,
      data,
    );
    await getFoldersListByType(store,type);
    return newFolder;
  } catch (error) {
    throw error;
  }
};

export const updateFolder = async (store: any, folderId: any, data: any) => {
  try {
    await dashboardService.edit_Folder(
      store.state.selectedOrganization.identifier,
      folderId,
      data,
    );
    await getFoldersList(store);
  } catch (error) {
    throw error;
  }
};

export const updateFolderByType = async (store: any, folderId: any, data: any, type: any) => {
  try {
    await commonService.edit_Folder(
      store.state.selectedOrganization.identifier,
      type,
      folderId,
      data,
    );
    await getFoldersListByType(store, type);
  } catch (error) {
    throw error;
  }
};
//from dashboard id is the folder id from where the dashboard will be moved
//to dashboard id is the folder id to where the dashboard will be moved
//dashboardIds is the array of dashboard ids that will be moved
//we require from to get the latest dashboards list after moving

export const moveDashboardToAnotherFolder = async (
  store: any,
  dashboardIds: any,
  from: any,
  to: any,
) => {
  try {
    //move dashboard
    await dashboardService.move_Dashboard(
      store.state.selectedOrganization.identifier,
      dashboardIds,
      from,
      to
    );

    //update both folders dashboard
    await getAllDashboards(store, to);
    await getAllDashboards(store, from);
  } catch (error) {
    throw error;
  }
};

export const moveModuleToAnotherFolder = async (
  store: any,
  data: any,
  type: any,
  folder_id?: any
) => {
  try {
    //move alerts
    await commonService.move_across_folders(
      store.state.selectedOrganization.identifier,
      type,
      data,
      folder_id

    );

  } catch (error) {
    throw error;
  }
};

export const checkIfVariablesAreLoaded = (variablesData: any): boolean => {
  if (
    variablesData?.values?.length > 0 &&
    variablesData?.values?.every(
      (it: any) => !it.isLoading && !it.isVariableLoadingPending,
    ) &&
    !variablesData?.isVariablesLoading
  ) {
    return true;
  }
  return false;
};
