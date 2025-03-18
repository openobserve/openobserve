import http from "./http";

const rate_limit = {
    getApiLimits: (org_identifier: string) => {
        const url = `/api/${org_identifier}/ratelimit/module_list`;
        return http().get(url);
    },
    update_batch: (org_identifier: string, data: any) => {
        const url = `/api/${org_identifier}/ratelimit/update`;
        return http().put(url, data);
    }
}

export default rate_limit;



