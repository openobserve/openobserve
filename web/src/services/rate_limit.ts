import http from "./http";

const rate_limit = {
    getApiLimits: (org_identifier: string) => {
        const url = `/api/${org_identifier}/ratelimit/module_list`;
        return http().get(url);
    },
    getRoleLimits: (org_identifier: string, role_name: string) => {
        const url = `/api/${org_identifier}/ratelimit/role_list/${role_name}`;
        return http().get(url);
    },
    update_batch: (org_identifier: string, data: any) => {
        const url = `/api/${org_identifier}/ratelimit/update`;
        return http().put(url, data);
    },
    download_template: (org_identifier: string) => {
        const url = `/api/${org_identifier}/ratelimit/download_template`;
        return http().get(url);
    },
    upload_template: (org_identifier: string, file: any) => {
        const url = `/api/${org_identifier}/ratelimit/upload`;
        const formData = new FormData();
        formData.append('rules', JSON.stringify(file));
        return http().put(url, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            }
        });
    }
    
}

export default rate_limit;



