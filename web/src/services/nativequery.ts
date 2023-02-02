import http from "./http";
const nativeQueries = {

    runquery: (data: any, organization:any) => {
        return http().post(`/api/${organization}/_search`, data);
      },
    
}
export default nativeQueries;
