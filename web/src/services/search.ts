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

var search = {
  search: ({ org_identifier, query, page_type = "logs" }: { org_identifier: string; query: any; page_type: string }) => {
    const url = `/api/${org_identifier}/_search?type=${page_type}`;
    return http().post(url, query);
  },
  search_around: ({ org_identifier, index, key, size }: { org_identifier: string; index: string; key: string; size: string }) => {
    const url = `/api/${org_identifier}/${index}/_around?key=${key}&size=${size}`;
    return http().get(url);
  },
};

export default search;
