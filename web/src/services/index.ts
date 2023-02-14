// Copyright 2022 Zinc Labs Inc. and Contributors

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License. 

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
