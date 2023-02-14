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
import axios from "axios";

var attachments = {
  list: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string
  ) => {
    return http().get(
      `/api/tickets?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`
    );
  },
  getPresignedUrl: (objectkey: string, fileType: String) => {
    return http().get(
      `/api/attachements/` + objectkey + "?fileType=" + fileType
    );
  },
  upload: (url: string, data: any) => {
    return axios.put(url, data, {
      headers: {
        "Content-Type": data.type,
      },
    });
  },
  create: (data: any) => {
    return http().post("/api/tickets", data);
  },
  delete: (names: string) => {
    return http().delete("/api/tickets/" + names);
  },
};

export default attachments;
