import { beforeAll, afterEach, afterAll, vi } from "vitest";
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

import.meta.env.VITE_ZINCOBSERVE_ENDPOINT = "http://localhost:8080";

// TODO OK: Move below rest handlers to separate file
export const restHandlers = [
  rest.get(
    `${store.state.API_ENDPOINT}/api/organizations/associated_members/${store.state.selectedOrganization.identifier}`,
    (req, res, ctx) => {
      return res(ctx.status(200), ctx.json(associate_members));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/streams`,
    (req, res, ctx) => {
      return res(ctx.status(200), ctx.json(streams.stream_list));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/k8s_json/schema`,
    (req, res, ctx) => {
      return res(ctx.status(200), ctx.json(streams.stream_details));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/org_users`,
    (req, res, ctx) => {
      return res(ctx.status(200), ctx.json(users.users));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts`,
    (req, res, ctx) => {
      return res(ctx.status(200), ctx.json(alerts.alerts.get));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/templates`,
    (req, res, ctx) => {
      return res(ctx.status(200), ctx.json(alerts.templates.get));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/alerts/destinations`,
    (req, res, ctx) => {
      return res(ctx.status(200), ctx.json(alerts.destinations.get));
    }
  ),

  rest.post(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/_search`,
    (req, res, ctx) => {
      return res(ctx.status(200), ctx.json(logs.search));
    }
  ),

  rest.get(
    `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/organizations`,
    (req, res, ctx) => {
      return res(ctx.status(200), ctx.json(organizations.list));
    }
  ),
];
const server = setupServer(...restHandlers);

// This is added to support multiple responses on same end point.
// example: suppose for '/posts' we need to need to test sending response as error, [] and [post1, post2].
// For this we need instance of server while testing
// So have added server instance on global so that it can be accessed while testing
vi.stubGlobal("server", server);

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

//  Close server after all tests
afterAll(() => {
  server.close();
});

// Reset handlers after each test `important for test isolation`
afterEach(() => server.resetHandlers());
