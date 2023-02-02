import http from "./http";

const dashboards = {
  list: (organization: string) => {
    return http().get(
      `/api/${organization}/dashboards`
    );
  },
  create: (organization: string,dashboardID:String,data: any) => {
    return http().post(`/api/${organization}/dashboards/${dashboardID}`, data ,{ headers: { 'Content-Type': 'application/json; charset=UTF-8' }});
  },
  delete: (organization: string,dashboardID:String) => {
    console.log(dashboardID)
    return http().delete(`/api/${organization}/dashboards/${dashboardID}`);
  },
  get_Dashboard: (org_identifier: string) => {
    return http().get(`/api/dashboards/passcode/${org_identifier}`);
  },
  save: (organization: string,dashboardID:String,data: any) => {
    return http().post(`/api/${organization}/dashboards/${dashboardID}`, data ,{ headers: { 'Content-Type': 'application/json; charset=UTF-8' }});
  }

};

export default dashboards;