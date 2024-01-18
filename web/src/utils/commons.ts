// Copyright 2023 Zinc Labs Inc.
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
import moment from "moment";
import { convertDashboardSchemaVersion } from "./dashboard/convertDashboardSchemaVersion";

export const modifySQLQuery = (
  currentTimeObj: any,
  querySQL: String,
  timestampColumn: string
) => {
  const startTime = moment(String(currentTimeObj.start_time)).format(
    "YYYY-MM-DDThh:mm:ssZ"
  );
  const endTime = moment(String(currentTimeObj.end_time)).format(
    "YYYY-MM-DDThh:mm:ssZ"
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
      JSON.parse(subtractObject)
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
        dateObj.absolute.date.from + " " + dateObj.absolute.startTime
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
export const getAllDashboards = async (store: any, folderId: any) => {
  //call only if we have folderId
  if (!folderId) return;
  // api call
  return await dashboardService
    .list(
      0,
      1000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier,
      folderId
    )
    .then((res) => {
      //dashboard version migration
      res.data.dashboards = res.data.dashboards.map((dashboard: any) =>
        convertDashboardSchemaVersion(dashboard["v" + dashboard.version])
      );
      // save to store
      store.dispatch("setAllDashboardList", {
        ...store.state.organizationData.allDashboardList,
        [folderId]: res.data.dashboards.sort((a: any, b: any) =>
          b.created.localeCompare(a.created)
        ),
      });
    })
    .catch((error) => {});
};

//get all dashboards by folderId if not there then call api else return from store
export const getAllDashboardsByFolderId = async (store: any, folderId: any) => {
  if (!store.state.organizationData.allDashboardList[folderId]) {
    await getAllDashboards(store, folderId);
  }
  return store.state.organizationData.allDashboardList[folderId];
};

function findDashboard(dashboardId: string, store: any, folderId: any) {
  const dashboards = store.state.organizationData.allDashboardList[folderId];
  const dashboard = dashboards.find(
    (it: any) => it.dashboardId === dashboardId
  );
  // return the deep cody of the dashboard object to prevent it from being modified
  return dashboard && typeof dashboard === "object"
    ? JSON.parse(JSON.stringify(dashboard))
    : {};
}

export const getTabDataFromTabId = (dashboardData: any, tabId: any) => {
  // find tab from tabId
  return dashboardData.tabs.find((tab: any) => tab.tabId == tabId);
};

export const addPanel = async (
  store: any,
  dashboardId: any,
  panelData: any,
  folderId: any,
  tabId: any
) => {
  // get the object of panel data
  // find the dashboard and add the panel data to dashboard object
  // call the update dashboard function

  if (
    !store.state.organizationData.allDashboardList[folderId] ||
    store.state.organizationData.allDashboardList[folderId].length == 0
  ) {
    await getAllDashboards(store, folderId);
  }
  const currentDashboard = findDashboard(dashboardId, store, folderId);

  // find tab from tabId
  const tab = getTabDataFromTabId(currentDashboard, tabId);

  if (!tab.panels) {
    tab.panels = [];
  }

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

  // maxI =
  //   currentDashboard.layouts?.length > 0
  //     ? Math.max(...currentDashboard.layouts?.map((obj: any) => obj.i))
  //     : 0;
  // maxY =
  //   currentDashboard.layouts?.length > 0
  //     ? Math.max(...currentDashboard.layouts?.map((obj: any) => obj.y))
  //     : 0;

  const newLayoutObj = {
    x: 0,
    y: tab.panels?.length > 0 ? maxY + 10 : 0,
    w: 6,
    h: 9,
    i: maxI + 1,
    panelId: panelData.id,
    static: false,
  };

  // check if last panel has enthough space to add new panel
  if (tab.panels.length > 0) {
    //check if new panel can be added
    if (12 - (lastPanel.layout.x + lastPanel.layout.w) >= newLayoutObj.w) {
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
    folderId ?? "default"
  );
};

export const addVariable = async (
  store: any,
  dashboardId: any,
  variableData: any,
  folderId: any
) => {
  if (
    !store.state.organizationData.allDashboardList[folderId] ||
    store.state.organizationData.allDashboardList[folderId].length == 0
  ) {
    await getAllDashboards(store, folderId);
  }

  const currentDashboard = findDashboard(dashboardId, store, folderId);
  if (!currentDashboard.variables) {
    currentDashboard.variables = {};
    currentDashboard.variables.showDynamicFilters = false;
    currentDashboard.variables.list = [];
  }

  const variableExists = currentDashboard.variables.list.filter(
    (it: any) => it.name == variableData.name
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
    folderId ?? "default"
  );
};

export const deleteVariable = async (
  store: any,
  dashboardId: any,
  variableName: any,
  folderId: any
) => {
  // get the object of panel id
  // find the dashboard and remove the panel data to dashboard object
  // call the update dashboard function
  const currentDashboard = findDashboard(dashboardId, store, folderId);

  //remove panel from current dashboard
  const variableIndex = currentDashboard.variables.list.findIndex(
    (variable: any) => variable.name == variableName
  );
  currentDashboard.variables.list.splice(variableIndex, 1);
  currentDashboard.variables.list = currentDashboard.variables.list;

  return await updateDashboard(
    store,
    store.state.selectedOrganization.identifier,
    dashboardId,
    currentDashboard,
    folderId ?? "default"
  );
};

export const deletePanel = async (
  store: any,
  dashboardId: any,
  panelId: any,
  folderId: any,
  tabId: any
) => {
  // get the object of panel id
  // find the dashboard and remove the panel data to dashboard object
  // call the update dashboard function
  const currentDashboard = findDashboard(dashboardId, store, folderId);

  // find tab from tabId
  const tab = getTabDataFromTabId(currentDashboard, tabId);

  //remove panel from current dashboard
  const panelIndex = tab.panels.findIndex((panel: any) => panel.id == panelId);
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
    folderId
  );
};

export const updateVariable = async (
  store: any,
  dashboardId: any,
  variableName: any,
  variableData: any,
  folderId?: any
) => {
  // get the object of panel id
  // find the dashboard and remove the panel data to dashboard object
  // call the update dashboard function
  // Get the current dashboard from the store
  const currentDashboard = findDashboard(dashboardId, store, folderId);
  // Find the index of the variable in the list
  const variableIndex = currentDashboard.variables.list.findIndex(
    (variable: any) => variable.name == variableName
  );
  //if name already exists
  const variableExists = currentDashboard.variables.list.filter(
    (it: any) => it.name == variableData.name
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
    folderId
  );
};

export const updatePanel = async (
  store: any,
  dashboardId: any,
  panelData: any,
  folderId: any,
  tabId: any
) => {
  // get the object of panel id
  // find the dashboard and remove the panel data to dashboard object
  // call the update dashboard function
  const currentDashboard = findDashboard(dashboardId, store, folderId);

  // find tab from tabId
  const tab = getTabDataFromTabId(currentDashboard, tabId);

  const panelIndex = tab.panels.findIndex(
    (panel: any) => panel.id == panelData.id
  );
  tab.panels[panelIndex] = panelData;

  return await updateDashboard(
    store,
    store.state.selectedOrganization.identifier,
    dashboardId,
    currentDashboard,
    folderId
  );
};

export const updateDashboard = async (
  store: any,
  org: any,
  dashboardId: any,
  currentDashboardData: any,
  folderId: any
) => {
  // make an api call to update the dashboard
  return await dashboardService
    .save(org, dashboardId, currentDashboardData, folderId)
    .then(async (res) => {
      // update dashboardList
      await getAllDashboards(store, folderId);
    })
    .catch((error) => {
      return error;
    });
};

export const getDashboard = async (
  store: any,
  dashboardId: any,
  folderId: any
) => {
  if (
    !store.state.organizationData.allDashboardList[folderId] ||
    store.state.organizationData.allDashboardList[folderId].length == 0
  ) {
    await getAllDashboards(store, folderId);
  }
  return findDashboard(dashboardId, store, folderId);
};

export const deleteDashboardById = async (
  store: any,
  dashboardId: any,
  folderId: any
) => {
  // Delete the dashboard using the dashboardService
  await dashboardService.delete(
    store.state.selectedOrganization.identifier,
    dashboardId,
    folderId
  );

  // Get list of all dashboard of all folders
  const allDashboardList = store.state.organizationData.allDashboardList;

  // Filter out the deleted dashboard from the list
  const newDashboards = allDashboardList[folderId].filter(
    (dashboard: any) => dashboard.dashboardId != dashboardId
  );

  // Update the allDashboardList in the store with the new list
  store.dispatch("setAllDashboardList", {
    ...allDashboardList,
    [folderId]: newDashboards,
  });
};

export const getPanel = async (
  store: any,
  dashboardId: any,
  panelId: any,
  folderId: any,
  tabId: any
) => {
  if (
    !store.state.organizationData.allDashboardList[folderId] ||
    store.state.organizationData.allDashboardList[folderId].length == 0
  ) {
    await getAllDashboards(store, folderId);
  }
  const currentDashboard = findDashboard(dashboardId, store, folderId);

  // find tab from tabId
  const tab = getTabDataFromTabId(currentDashboard, tabId);

  const paneldata = tab.panels?.find((it: any) => it.id == panelId);
  return paneldata;
};

export const getPanelId = () => {
  return "Panel_ID" + Math.floor(Math.random() * (99999 - 10 + 1)) + 10;
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
  moveToTabId?: any
) => {
  const currentDashboard = findDashboard(dashboardId, store, folderId);

  const deleteTabData = getTabDataFromTabId(currentDashboard, deleteTabId);

  if (moveToTabId) {
    // move panels to other tab
    const moveToTabData = getTabDataFromTabId(currentDashboard, moveToTabId);

    let maxI = 0;
    let maxY = 0;

    // for each panel, need to recalculate layout object
    moveToTabData.panels.map((it: any) => {
      maxI = Math.max(it.layout?.i || 0, maxI);
      maxY = Math.max(it.layout?.y || 0, maxY);
    });

    deleteTabData.panels.forEach((panel: any) => {
      maxY += 10;
      panel.layout.i = ++maxI;
      panel.layout.y = maxY;
    });

    moveToTabData.panels.push(...deleteTabData.panels);
  }
  // delete the tab
  currentDashboard.tabs = currentDashboard.tabs.filter(
    (tab: any) => tab.tabId != deleteTabId
  );

  return await updateDashboard(
    store,
    store.state.selectedOrganization.identifier,
    dashboardId,
    currentDashboard,
    folderId ?? "default"
  );
};

// move panel to another tab
export const movePanelToAnotherTab = async (
  store: any,
  dashboardId: any,
  panelId: any,
  folderId: any,
  currentTabId: any,
  moveToTabId?: any
) => {
  const currentDashboard = findDashboard(dashboardId, store, folderId);

  const currentTabData = getTabDataFromTabId(currentDashboard, currentTabId);

  // panel data
  const panelData = currentTabData.panels.find((it: any) => it.id == panelId);

  // delete panel in currentTab
  currentTabData.panels = currentTabData.panels.filter(
    (panel: any) => panel.id != panelId
  );

  // add panel in moveToTab
  // NOTE: no need to call updateDashboard function, because it will be called in addPanel function
  await addPanel(store, dashboardId, panelData, folderId, moveToTabId);
};

export const getFoldersList = async (store: any) => {
  let folders = (
    await dashboardService.list_Folders(
      store.state.selectedOrganization.identifier
    )
  ).data.list;

  // get default folder and append it to top
  let defaultFolder = folders.find((it: any) => it.folderId == "default");
  folders = folders.filter((it: any) => it.folderId != "default");

  if (!defaultFolder) {
    defaultFolder = {
      name: "default",
      folderId: "default",
      decription: "default",
    };
  }

  store.dispatch("setFolders", [
    defaultFolder,
    ...folders.sort((a: any, b: any) => a.name.localeCompare(b.name)),
  ]);

  return store.state.organizationData.folders;
};

export const deleteFolderById = async (store: any, folderId: any) => {
  await dashboardService.delete_Folder(
    store.state.selectedOrganization.identifier,
    folderId
  );
  await getFoldersList(store);
};

export const createFolder = async (store: any, data: any) => {
  const newFolder = await dashboardService.new_Folder(
    store.state.selectedOrganization.identifier,
    data
  );
  await getFoldersList(store);
  return newFolder;
};

export const updateFolder = async (store: any, folderId: any, data: any) => {
  await dashboardService.edit_Folder(
    store.state.selectedOrganization.identifier,
    folderId,
    data
  );
  await getFoldersList(store);
};

export const moveDashboardToAnotherFolder = async (
  store: any,
  dashboardId: any,
  from: any,
  to: any
) => {
  //move dashboard
  await dashboardService.move_Dashboard(
    store.state.selectedOrganization.identifier,
    dashboardId,
    {
      from: from,
      to: to,
    }
  );

  //update both folders dashboard
  await getAllDashboards(store, to);
  await getAllDashboards(store, from);
};
