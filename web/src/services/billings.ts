/* eslint-disable @typescript-eslint/no-explicit-any */
import http from "./http";

const billings = {
  get_quota_threshold: (org_identifier: string) => {
    return http().get(`/api/billings/quota_threshold/${org_identifier}`);
  }

};

export default billings;
