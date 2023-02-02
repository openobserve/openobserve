/* eslint-disable @typescript-eslint/no-explicit-any */
import http from "./http";

const auth = {
  sign_in_user: (orgIdentifier: string, payload: any) => {
    return http().post(`/auth/${orgIdentifier}/authentication`, payload);
  },
  get_organization_by_username: (userName: string) => {
    return http().get(`/auth/organizarions_by_username/${userName}`);
  }
};

export default auth;
