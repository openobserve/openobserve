import http from "./http";

const rate_limit = {
    getApiLimits: (org_identifier: string) => {
        const url = `/api/${org_identifier}/ratelimit/module_list`;
        return http().get(url);
    }
}

export default rate_limit;



