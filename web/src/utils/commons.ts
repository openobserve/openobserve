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

export const getAllDashboards = async (store: any, folderId?: any) => {
  // api call
  return await dashboardService
    .list(
      0,
      1000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier,
      folderId ?? "default"
    )
    .then((res) => {
      //dashboard version migration
      res.data.dashboards = res.data.dashboards.map((dashboard: any) => convertDashboardSchemaVersion(dashboard["v"+dashboard.version]));
      // save to store
      store.dispatch(
        "setAllDashboardList",
        res.data.dashboards.sort((a: any, b: any) =>
          b.created.localeCompare(a.created)
        )
      );
    })
    .catch((error) => {
    });
};

function findDashboard(dashboardId: string, store: any) {
  const dashboards = store.state.organizationData.allDashboardList;
  const dashboard = dashboards.find((it: any) => it.dashboardId === dashboardId);
  // return the deep cody of the dashboard object to prevent it from being modified
  return typeof dashboard === 'object' ? JSON.parse(JSON.stringify(dashboard)) : dashboard;
}

export const addPanel = async (
  store: any,
  dashboardId: any,
  panelData: any
) => {
  // get the object of panel data
  // find the dashboard and add the panel data to dashboard object
  // call the update dashboard function

  if (
    !store.state.organizationData.allDashboardList ||
    store.state.organizationData.allDashboardList.length == 0
  ) {
    await getAllDashboards(store);
  }
  const currentDashboard = findDashboard(dashboardId, store);
  if (!currentDashboard.panels) {
    currentDashboard.panels = [];
  }

  let maxI=0;
  let maxY=0;
  
  currentDashboard.panels.map((it: any) => {
    maxI = Math.max(it.layout?.i||0,maxI);
    maxY = Math.max(it.layout?.y||0,maxY);    
  })

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
    y: currentDashboard.panels?.length > 0 ? maxY + 10 : 0,
    w: 12,
    h: 13,
    i: maxI + 1,
    panelId: panelData.id,
    static: false,
  };  

  // if (!currentDashboard.layouts) {
  //   currentDashboard.layouts = [];
  // }
  // currentDashboard.layouts.push(newLayoutObj);

  //set layout of new panel
  panelData.layout = newLayoutObj;
  currentDashboard.panels.push(panelData);

  return await updateDashboard(
    store,
    store.state.selectedOrganization.identifier,
    dashboardId,
    currentDashboard
  );
};

export const addVariable = async (
  store: any,
  dashboardId: any,
  variableData: any
) => {

  if (
    !store.state.organizationData.allDashboardList ||
    store.state.organizationData.allDashboardList.length == 0
  ) {
    await getAllDashboards(store);
  }

  const currentDashboard = findDashboard(dashboardId, store);
  if (!currentDashboard.variables) {

    currentDashboard.variables = {};
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
    currentDashboard
  );
};

export const deleteVariable = async (
  store: any,
  dashboardId: any,
  variableName: any
) => {
  // get the object of panel id
  // find the dashboard and remove the panel data to dashboard object
  // call the update dashboard function
  const currentDashboard = findDashboard(dashboardId, store);

  //remove panel from current dashboard
  const variableIndex = currentDashboard.variables.list.findIndex(
    (variable: any) => variable.name == variableName
  );
  currentDashboard.variables.list.splice(variableIndex, 1);
  currentDashboard.variables.list = currentDashboard.variables.list;

  await updateDashboard(
    store,
    store.state.selectedOrganization.identifier,
    dashboardId,
    currentDashboard
  );
};

export const deletePanel = async (
  store: any,
  dashboardId: any,
  panelId: any
) => {
  // get the object of panel id
  // find the dashboard and remove the panel data to dashboard object
  // call the update dashboard function
  const currentDashboard = findDashboard(dashboardId, store);

  //remove panel from current dashboard
  const panelIndex = currentDashboard.panels.findIndex(
    (panel: any) => panel.id == panelId
  );
  currentDashboard.panels.splice(panelIndex, 1);
  currentDashboard.panels = currentDashboard.panels;

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
    currentDashboard
  );
};

export const updateVariable = async (
  store: any,
  dashboardId: any,
  variableName: any,
  variableData: any
) => {
  // get the object of panel id
  // find the dashboard and remove the panel data to dashboard object
  // call the update dashboard function
  // Get the current dashboard from the store
  const currentDashboard = findDashboard(dashboardId, store);
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
    currentDashboard
  );
};

export const updatePanel = async (
  store: any,
  dashboardId: any,
  panelData: any
) => {
  // get the object of panel id
  // find the dashboard and remove the panel data to dashboard object
  // call the update dashboard function
  const currentDashboard = findDashboard(dashboardId, store);

  const panelIndex = currentDashboard.panels.findIndex(
    (panel: any) => panel.id == panelData.id
  );
  currentDashboard.panels[panelIndex] = panelData;
  currentDashboard.panels = currentDashboard.panels;

  return await updateDashboard(
    store,
    store.state.selectedOrganization.identifier,
    dashboardId,
    currentDashboard
  );
};

export const updateDashboard = async (
  store: any,
  org: any,
  dashboardId: any,
  currentDashboardData: any
) => {
  // make an api call to update the dashboard
  return await dashboardService
    .save(org, dashboardId, currentDashboardData)
    .then(async (res) => {
      // update dashboardList
      await getAllDashboards(store);
    }).catch((error) => {
      return error
    });
};

export const getDashboard = async (store: any, dashboardId: any) => {
  if (
    !store.state.organizationData.allDashboardList ||
    store.state.organizationData.allDashboardList.length == 0
  ) {
    await getAllDashboards(store);
  }
  return findDashboard(dashboardId, store);
};

export const getPanel = async (store: any, dashboardId: any, panelId: any) => {
  if (
    !store.state.organizationData.allDashboardList ||
    store.state.organizationData.allDashboardList.length == 0
  ) {
    await getAllDashboards(store);
  }
  const currentDashboard = findDashboard(dashboardId, store);
  
  const paneldata = currentDashboard.panels?.find((it: any) => it.id == panelId);
  return paneldata;
};

export const getPanelId = () => {
  return "Panel_ID" + Math.floor(Math.random() * (99999 - 10 + 1)) + 10;
};


export const getFoldersList = async (store: any) => {
  let folders = (await dashboardService.list_Folders(store.state.selectedOrganization.identifier)).data.list;

  // get default folder and append it to top
  const defaultFolder = folders.find((it: any) => it.name == "default");
  folders = folders.filter((it: any) => it.name != "default");
  
  return [defaultFolder, ...folders.sort((a: any, b: any) => a.name.localeCompare(b.name))];
}

export const deleteFolderById = async (store: any, folderId: any) => {
  return await dashboardService.delete_Folder(store.state.selectedOrganization.identifier, folderId);
}