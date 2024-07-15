import { beforeAll, afterEach, afterAll, vi } from "vitest";
// @ts-ignore
import { rest } from "msw";
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
  rest.get(
    `${store.state.API_ENDPOINT}/api/organizations/associated_members/${store.state.selectedOrganization.identifier}`,
    (req: any, res: any, ctx: any) => {
      return res(ctx.status(200), ctx.json(associate_members));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/streams`,
    (req: any, res: any, ctx: any) => {
      return res(ctx.status(200), ctx.json(streams.stream_list));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/k8s_json/schema`,
    (req: any, res: any, ctx: any) => {
      return res(ctx.status(200), ctx.json(streams.stream_details));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/org_users`,
    (req: any, res: any, ctx: any) => {
      return res(ctx.status(200), ctx.json(users.org_users));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/users`,
    (req: any, res: any, ctx: any) => {
      return res(ctx.status(200), ctx.json(users.users));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts`,
    (req: any, res: any, ctx: any) => {
      return res(ctx.status(200), ctx.json(alerts.alerts.get));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/templates`,
    (req: any, res: any, ctx: any) => {
      return res(ctx.status(200), ctx.json(alerts.templates.get));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/destinations`,
    (req: any, res: any, ctx: any) => {
      return res(ctx.status(200), ctx.json(alerts.destinations.get));
    }
  ),

  rest.post(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/_search`,
    (req: any, res: any, ctx: any) => {
      return res(ctx.status(200), ctx.json(logs.search));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/organizations`,
    (req: any, res: any, ctx: any) => {
      return res(ctx.status(200), ctx.json(organizations.list));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/summary`,
    (req: any, res: any, ctx: any) => {
      return res(ctx.status(200), ctx.json(home.summary.get));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/config`,
    (req: any, res: any, ctx: any) => {
      return res(
        ctx.status(200),
        ctx.json({
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
        })
      );
    }
  ),
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
