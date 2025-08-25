// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { http, HttpResponse } from "msw";
import { associate_members } from "../mockData/mockAssociateMembers";
import streams from "../mockData/streams";
import users from "../mockData/users";
import alerts from "../mockData/alerts";
import logs from "../mockData/logs";
import organizations from "../mockData/organizations";
import home from "../mockData/home";
import regexPatterns from "../mockData/regexPatterns";
import store from "./store";

// TODO OK: Move below rest handlers to separate file
export const restHandlers = [
  http.get(
    `${store.state.API_ENDPOINT}/api/organizations/associated_members/${store.state.selectedOrganization.identifier}`,
    ({ request }) => {
      return HttpResponse.json(associate_members);
    },
  ),

  http.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/functions`,
    ({ request }) => {
      const url = new URL(request.url);
      const pageNum = url.searchParams.get("page_num");
      const pageSize = url.searchParams.get("page_size");
      const sortBy = url.searchParams.get("sort_by");
      const desc = url.searchParams.get("desc");
      const name = url.searchParams.get("name");
      
      return HttpResponse.json({
        list: [
          {
            function: ".a=123 \n .",
            name: "lskjf",
            params: "row",
            numArgs: 1,
            transType: 0,
          },
          {
            function: ".a=123 \n .",
            name: "nginx_function",
            params: "row",
            numArgs: 1,
            transType: 0,
          },
        ],
      });
    },
  ),

  http.post(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/k8s_json/alerts/`,
    ({ request }) => {
      const url = new URL(request.url);
      const type = url.searchParams.get("type");
      
      return HttpResponse.json({});
    },
  ),

  http.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/streams`,
    ({ request }) => {
      return HttpResponse.json(streams.stream_list);
    },
  ),

  http.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/k8s_json/schema`,
    ({ request }) => {
      return HttpResponse.json(streams.stream_details);
    },
  ),

  http.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/org_users`,
    ({ request }) => {
      return HttpResponse.json(users.org_users);
    },
  ),

  http.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/users`,
    ({ request }) => {
      return HttpResponse.json(users.users);
    },
  ),

  http.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts`,
    ({ request }) => {
      return HttpResponse.json(alerts.alerts.get);
    },
  ),

  http.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/templates`,
    ({ request }) => {
      return HttpResponse.json(alerts.templates.get);
    },
  ),

  http.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/destinations`,
    ({ request }) => {
      return HttpResponse.json(alerts.destinations.get);
    },
  ),

  http.post(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/_search`,
    ({ request }) => {
      return HttpResponse.json(logs.search);
    },
  ),

  http.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/organizations`,
    ({ request }) => {
      return HttpResponse.json(organizations.list);
    },
  ),

  http.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/summary`,
    ({ request }) => {
      return HttpResponse.json(home.summary.get);
    },
  ),

  http.get(`${store.state.API_ENDPOINT}/config`, ({ request }) => {
    return HttpResponse.json({
      version: "v0.3.2",
      instance: "7049348417797095424",
      commit_hash: "3cc381d699e28bcb1b6d74310be16ec060b37e0d",
      build_date: "2023-04-05T11:01:23Z",
      default_fts_keys: ["log", "message", "msg", "content", "data"],
      telemetry_enabled: true,
      default_functions: [
        {
          name: "match_all_raw",
          text: "match_all_raw('v')",
        },
        {
          name: "match_all_raw_ignore_case",
          text: "match_all_raw_ignore_case('v')",
        },
        {
          name: "match_all",
          text: "match_all('v')",
        },
        {
          name: "str_match",
          text: "str_match(field, 'v')",
        },
        {
          name: "str_match_ignore_case",
          text: "str_match_ignore_case(field, 'v')",
        },
        {
          name: "re_match",
          text: "re_match(field, 'pattern')",
        },
        {
          name: "re_not_match",
          text: "re_not_match(field, 'pattern')",
        },
      ],
    });
  }),

  http.get(`${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/short/:id`, ({ request }) => {
    return HttpResponse.json("http://localhost:5080/web/logs?stream_type=logs&stream=default1&from=1749120770351000&to=1749121670351000&refresh=0&defined_schemas=user_defined_schema&org_identifier=default&quick_mode=false&show_histogram=true");
  }),

  // Regex Pattern handlers
  http.get(`${store.state.API_ENDPOINT}/api/:org/re_patterns`, ({ request }) => {
    return HttpResponse.json({
      data: regexPatterns
    }, { status: 200 });
  }),

  http.post(`${store.state.API_ENDPOINT}/api/:org/re_patterns`, async ({ request }) => {
    const body = await request.json() as any;
    return HttpResponse.json({
      id: "test-pattern-id",
      name: body.name,
      pattern: body.pattern,
      description: body.description,
      created_at: Date.now() / 1000,
      updated_at: Date.now() / 1000
    }, { status: 200 });
  }),

  http.put(`${store.state.API_ENDPOINT}/api/:org/re_patterns/:id`, async ({ request, params }) => {
    const body = await request.json() as any;
    return HttpResponse.json({
      id: params.id,
      name: body.name,
      pattern: body.pattern,
      description: body.description,
      created_at: Date.now() / 1000 - 3600, // 1 hour ago
      updated_at: Date.now() / 1000
    }, { status: 200 });
  }),

  http.post(`${store.state.API_ENDPOINT}/api/:org/re_patterns/test`, async ({ request }) => {
    const body = await request.json() as any;
    const { pattern, test_records } = body;
    
    console.log('MSW Test Handler - Full URL:', request.url);
    console.log('MSW Test Handler - pattern:', pattern, 'test_records:', test_records);
    
    // Simple regex test simulation
    const results = test_records.map((testStr: string) => {
      try {
        const regex = new RegExp(pattern);
        const match = testStr.match(regex);
        const result = match ? match[0] : "";
        console.log(`Testing "${testStr}" against /${pattern}/: ${result}`);
        return result;
      } catch (error) {
        console.log('Regex error:', error);
        return "";
      }
    });

    console.log('MSW Test Handler - results:', results);

    // The component expects response.data.results[0], so we return just the results structure
    const response = {
      results: results
    };
    
    console.log('MSW Test Handler - sending response:', response);

    return HttpResponse.json(response, { status: 200 });
  }),

  // Catch-all handler to debug other requests
  http.all('*', ({ request }) => {
    if (request.url.includes('/re_patterns/test')) {
      console.log('Unmatched regex test request:', request.url);
    }
    return HttpResponse.passthrough();
  }),
];
