/* eslint-disable @typescript-eslint/no-explicit-any */
import http from "./http";

const users = {
  list: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string
  ) => {
    return http().get(
      `/api/users?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`
    );
  },
  create: (data: any) => {
    return http().post("/api/users", data);
  },
  verifyUser: (email: string) => {
    return http().get(`/api/users/verifyuser/${email}`);
  },
  addNewUser: (data: any) => {
    return http().post(`/api/users/new_user`, data);
  },
  orgUsers: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string,
    org_identifier:string,
  ) => {
    return http().get(
      `/api/org_users/${org_identifier}?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`
    );
  },
  getRefreshToken: () => {
    return http().get(`/api/auth/refresh_token`);
  },
};

export default users;
