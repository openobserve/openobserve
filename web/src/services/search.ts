import http from "./http";

var search = {
  search: ({ org_identifier, query, page_type = "logs" }: { org_identifier: string; query: any; page_type:string }) => {
    let url = `/api/${org_identifier}/_search?type=${page_type}`;
    return http().post(url, query);
  },
};

export default search;
