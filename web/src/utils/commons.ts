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

//Dashboard Manipulation Functions

import dashboardService from "../services/dashboards";
import { toRaw } from "vue";
import { date } from "quasar";
import moment from "moment";

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

export const getAllDashboards = async (store: any) => {
  // api call
  return await dashboardService
    .list(
      0,
      1000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier
    )
    .then((res) => {
      // save to store
      store.dispatch(
        "setAllDashboardList",
        res.data.dashboards.sort((a: any, b: any) =>
          b.created.localeCompare(a.created)
        )
      );
    })
    .catch((error) => {
      // console.log(error);
    });
};

function findDashboard(dashboardId: string, store: any) {
  const dashboards = store.state.allDashboardList;
  return dashboards.find((it: any) => it.dashboardId === dashboardId);
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
    !store.state.allDashboardList ||
    store.state.allDashboardList.length == 0
  ) {
    await getAllDashboards(store);
  }
  const currentDashboard = findDashboard(dashboardId, store);
  if (!currentDashboard.panels) {
    currentDashboard.panels = [];
  }
  currentDashboard.panels.push(panelData);

  const maxI =
    currentDashboard.layouts?.length > 0
      ? Math.max(...currentDashboard.layouts?.map((obj: any) => obj.i))
      : 0;
  const maxY =
    currentDashboard.layouts?.length > 0
      ? Math.max(...currentDashboard.layouts?.map((obj: any) => obj.y))
      : 0;

  const newLayoutObj = {
    x: 0,
    y: currentDashboard.layouts?.length > 0 ? maxY + 10 : 0,
    w: 12,
    h: 13,
    i: maxI + 1,
    panelId: panelData.id,
    static: false,
  };

  if (!currentDashboard.layouts) {
    currentDashboard.layouts = [];
  }
  currentDashboard.layouts.push(newLayoutObj);

  return await updateDashboard(
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
  const layoutIndex = currentDashboard.layouts.findIndex(
    (layout: any) => layout.panelId == panelId
  );
  currentDashboard.layouts.splice(layoutIndex, 1);
  currentDashboard.layouts = currentDashboard.layouts;

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

  //remove panel from current dashboard
  const panelIndex = currentDashboard.panels.findIndex(
    (panel: any) => panel.id == panelData.id
  );
  currentDashboard.panels[panelIndex] = panelData;
  currentDashboard.panels = currentDashboard.panels;

  await updateDashboard(
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
    });
};

export const getDashboard = async (store: any, dashboardId: any) => {
  if (
    !store.state.allDashboardList ||
    store.state.allDashboardList.length == 0
  ) {
    await getAllDashboards(store);
  }
  return findDashboard(dashboardId, store);
};

export const getPanel = async (store: any, dashboardId: any, panelId: any) => {
  if (
    !store.state.allDashboardList ||
    store.state.allDashboardList.length == 0
  ) {
    await getAllDashboards(store);
  }
  const currentDashboard = findDashboard(dashboardId, store);
  return currentDashboard.panels?.find((it: any) => it.id == panelId);
};

export const getPanelId = () => {
  return "Panel_ID" + Math.floor(Math.random() * (99999 - 10 + 1)) + 10;
};
