import http from "./http";

var jstransform = {
  list: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string,
    org_identifier: string
  ) => {
    return http().get(
      `/api/${org_identifier}/functions?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`
    );
  },
  create: (org_identifier: string, data: any) => {
    return http().post(`/api/${org_identifier}/functions/${data.name}`, data);
  },
  create_with_index: (org_identifier: string, stream_name: string, data: any) => {
    return http().post(`/api/${org_identifier}/${stream_name}/functions/${data.name}`, data);
  },
  delete: (org_identifier: string, transform_name: string) => {
    return http().delete(`/api/${org_identifier}/functions/${transform_name}`);
  },
  delete_stream_function: (org_identifier: string, stream_name: string, transform_name: string) => {
    return http().delete(`/api/${org_identifier}/${stream_name}/functions/${transform_name}`);
  },
};

export default jstransform;
