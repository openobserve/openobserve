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

import { convertPanelSchemaVersion } from "./convertPanelSchemaVersion";

export function convertDashboardSchemaVersion(data: any) {
  if (!data) {
    return;
  }
  if (!data.version) data = { ...data, version: 1 };
  switch (data.version) {
    case 1: {
      // Create a object with key as a panel id and value will be its layout.
      const layoutsObjBasedOnPanelId: any = {};
      data?.layouts?.forEach((layout: any) => {
        layoutsObjBasedOnPanelId[layout.panelId] = layout;
      });

      // add layout object in panels array and also migrate panels schema using panelschemaversionconverted function
      data.panels = data?.panels?.map((panelItem: any) => ({
        ...convertPanelSchemaVersion(panelItem),
        layout: layoutsObjBasedOnPanelId[panelItem.id], // Use the layout item from the mapping
      }));
      break;
    }
  }
  //return whole data except layout
  const {
    created,
    dashboardId,
    description,
    owner,
    panels,
    role,
    title,
    variables,
  } = data;
  return {
    created,
    dashboardId,
    description,
    owner,
    panels,
    role,
    title,
    variables,
  };
}
