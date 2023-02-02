import http from "./http";

var alerts = {
  list: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string,
    org_identifier: string,
  ) => {
    return http().get(
      `/api/${org_identifier}/alerts?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`
    );
  },
  create: (org_identifier: string, stream_name: string,data: any) => {
    return http().post(`/api/${org_identifier}/${stream_name}/alerts/${data.name}`, data);
  },
  get_with_name: (org_identifier: string, stream_name: string, alert_name: string) => {
    return http().get(`/api/${org_identifier}/${stream_name}/alerts/${alert_name}`);
  },
  delete: (org_identifier: string,stream_name: string, alert_name: string) => {
    return http().delete(`/api/${org_identifier}/${stream_name}/alerts/${alert_name}`);
  },
};

export default alerts;
