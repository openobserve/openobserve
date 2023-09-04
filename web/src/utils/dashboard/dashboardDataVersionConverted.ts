import { PanelSchemaVersionConverted } from "./PanelSchemaVersionConverted";

export function dashboardDataVersionConverted(data: any) {
    if (!data) {
      return;
    }
    if (!data.version) data = { ...data, version: 1 };
    switch (data.version) {
      case 1: {
      // Create a object with key as a panel id and value will be its layout.
      const layoutsObjBasedOnPanelId:any = {};
      data?.layouts?.forEach((layout:any) => {
        layoutsObjBasedOnPanelId[layout.panelId] = layout;
      });

      // add layout object in panels array and also migrate panels schema using panelschemaversionconverted function
      data.panels = data?.panels?.map((panelItem:any) => ({
        ...(PanelSchemaVersionConverted(panelItem)),
        layout: layoutsObjBasedOnPanelId[panelItem.id], // Use the layout item from the mapping
      }));
      break;
    }
  }  
  //return whole data except layout
  const {created, dashboardId, description, owner, panels, role, title, variables} = data
    return {
      created,
      dashboardId,
      description,
      owner,
      panels,
      role,
      title,
      variables
    };
  }  