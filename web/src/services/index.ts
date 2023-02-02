import http from "./http";

var index = {
  nameList: (org_identifier: string, type: string, schema: boolean) => {
    let url = `/api/${org_identifier}/streams`;

    if (type != "") {
      url += "?type=" + type;
    }

    if (schema) {
      url += url.indexOf("?")>0 ? "&fetchSchema="+schema: "?fetchSchema="+schema;
    }
    return http().get(url);
  },
  schema: (org_identifier: string, stream_name: string, type: string) => {
    let url = `/api/${org_identifier}/${stream_name}/schema`;

    if (type != "") {
      url += "?type=" + type;
    }
    return http().get(url);
  },
   updateSettings: (org_identifier: string, stream_name: string, type: string,data: any) => {
    let url = `/api/${org_identifier}/${stream_name}/settings`;

    if (type != "") {
      url += "?type=" + type;
    }
    return http().post(url, data);
  },
};



export default index;
