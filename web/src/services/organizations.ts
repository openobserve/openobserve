/* eslint-disable @typescript-eslint/no-explicit-any */
import http from "./http";

const organizations = {
  os_list: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string,
    org_identifier: string
  ) => {
    return http().get(
      `/api/${org_identifier}/organizations?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`
    );
  },
  list: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string
  ) => {
    return http().get(
      `/api/organizations?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`
    );
  },
  create: (data: any) => {
    return http().post("/api/organizations", data);
  },
  add_members: (data: any, orgIdentifier: string) => {
    return http().post(`api/organizations/${orgIdentifier}/members`, data);
  },
  process_subscription: (s: string) => {
    return http().get(`api/organizations/member_subscription/${s}`);
  },
  get_associated_members: (orgIdentifier: string) => {
    return http().get(`api/organizations/associated_members/${orgIdentifier}`);
  },
  update_member_role: (data: any, orgIdentifier: string) => {
    return http().put(`api/organizations/${orgIdentifier}/member`, data);
  },
  verify_identifier: (name: string) => {
    return http().get(`api/organizations/verify_identifier/${name}`);
  },
  get_organization_passcode: (orgIdentifier: string) => {
    return http().get(`/api/organizations/passcode/${orgIdentifier}`);
  },
  update_organization_passcode: (orgIdentifier: string) => {
    return http().put(`api/organizations/passcode/${orgIdentifier}`, {});
  },
   get_organization_summary: (orgIdentifier: string) => {
    return http().get(`/api/${orgIdentifier}/summary`);
  },
};

export default organizations;
