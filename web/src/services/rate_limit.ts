import http from "./http";
import analytics from "./product_analytics";

const rate_limit = {
  getApiLimits: (org_identifier: string, interval?: string) => {
    let url = `/api/_meta/ratelimit/module_list`;
    if (org_identifier) {
      url += `?org_id=${org_identifier}`;
    }
    if (interval) {
      url += `&interval=${interval}`;
    }
    return http().get(url);
  },
  getRoleLimits: (org_identifier: string, role_name: string, interval?: string) => {
    let url = `/api/_meta/ratelimit/role_list?user_role=${role_name}&org_id=${org_identifier}`;
    if (interval) {
      url += `&interval=${interval}`;
    }
    return http().get(url);
  },
  update_batch: (
    org_identifier: string,
    data: any,
    update_type?: string,
    user_role?: string,
    interval?: string,
  ) => {
    let url = `/api/_meta/ratelimit/update`;
    if (update_type) {
      url += `?update_type=${update_type}`;
    }
    if (user_role) {
      url += `&user_role=${user_role}`;
    }
    if (org_identifier) {
      url += `&org_id=${org_identifier}`;
    }
    if (interval) {
      url += `&interval=${interval}`;
    }
    return http()
      .put(url, data)
      .then((res) => {
        analytics.track("rate_limit_updated", { update_type, interval });
        return res;
      });
  },
  download_template: (org_identifier: string) => {
    let url = `/api/_meta/ratelimit/download_template`;
    if (org_identifier) {
      url += `?org_id=${org_identifier}`;
    }
    return http()
      .get(url)
      .then((res) => {
        analytics.track("rate_limit_template_downloaded");
        return res;
      });
  },
  upload_template: (org_identifier: string, file: any) => {
    let url = `/api/_meta/ratelimit/upload`;
    if (org_identifier) {
      url += `?org_id=${org_identifier}`;
    }
    const formData = new FormData();
    formData.append("rules", JSON.stringify(file));
    return http()
      .put(url, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      })
      .then((res) => {
        analytics.track("rate_limit_template_uploaded");
        return res;
      });
  },
  getModules: (org_identifier: string) => {
    let url = `/api/_meta/ratelimit/api_modules`;
    if (org_identifier) {
      url += `?org_id=${org_identifier}`;
    }
    return http().get(url);
  },
};

export default rate_limit;
