import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { rest } from "msw";
import { setupServer } from "msw/node";
import { associate_members } from "../mockData/mockAssociateMembers";
import "whatwg-fetch";

export const restHandlers = [
    rest.get("http://localhost:4082/api/organizations/associated_members/default_organization_33", (req, res, ctx) => {
        // console.log(res(ctx.status(200), ctx.json(associate_members)));

        return res(ctx.status(200), ctx.json(associate_members));
    })
];
const server = setupServer(...restHandlers);

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

//  Close server after all tests
afterAll(() => server.close());

// Reset handlers after each test `important for test isolation`
afterEach(() => server.resetHandlers());