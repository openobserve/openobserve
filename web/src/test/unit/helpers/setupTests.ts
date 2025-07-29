import { beforeAll, afterEach, afterAll, vi } from "vitest";
// @ts-ignore
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { associate_members } from "../mockData/mockAssociateMembers";
import streams from "@/test/unit/mockData/streams";
import users from "../mockData/users";
import alerts from "../mockData/alerts";
import logs from "../mockData/logs";
import organizations from "../mockData/organizations";
import "whatwg-fetch";
import store from "./store";
import "../../__mocks__/index";
import home from "../mockData/home";

import.meta.env.VITE_OPENOBSERVE_ENDPOINT = "http://localhost:8080";

// TODO OK: Move below rest handlers to separate file
export const restHandlers = [
  http.get(
    `${store.state.API_ENDPOINT}/api/organizations/associated_members/${store.state.selectedOrganization.identifier}`,
    ({ request }) => {
      return HttpResponse.json(associate_members);
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
];

const server = setupServer(...restHandlers);

// This is added to support multiple responses on same end point.
// example: suppose for '/posts' we need to need to test sending response as error, [] and [post1, post2].
// For this we need instance of server while testing
// So have added server instance on global so that it can be accessed while testing
declare global {
  // eslint-disable-next-line no-var
  var server: any;
}
vi.stubGlobal("server", server);

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

//  Close server after all tests
afterAll(() => {
  server.close();
});

// Reset handlers after each test `important for test isolation`
afterEach(() => server.resetHandlers());
