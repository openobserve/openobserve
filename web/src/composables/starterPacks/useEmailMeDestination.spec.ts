// Copyright 2026 OpenObserve Inc.
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

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: [] as any[],
  listFails: false,
  save: vi.fn(),
}));

vi.mock("@tanstack/vue-query", async (original) => ({
  ...(await original<any>()),
  useMutation: (factory: () => { mutationFn: unknown }) => ({
    mutateAsync: factory().mutationFn,
  }),
}));
vi.mock("@/services/alert_destination.queries", () => ({
  destinationsQuery: (org: string, module: string) => ({ kind: "destinations", org, module }),
  saveDestinationMutation: () => ({ mutationFn: mocks.save }),
}));
vi.mock("@/composables/query/readQuery", () => ({
  readQuery: async () => {
    if (mocks.listFails) throw new Error("down");
    return mocks.list;
  },
}));

import { emailMeName, useEmailMeDestination } from "./useEmailMeDestination";

const EMAIL = "User@Example.com";
const refusal = (message: string, status = 400) => ({
  response: { status, data: { code: status, message } },
});

const ensure = (email = EMAIL) => useEmailMeDestination("default").ensure(email);

beforeEach(() => {
  mocks.list = [];
  mocks.listFails = false;
  mocks.save.mockReset();
  mocks.save.mockResolvedValue({});
});

describe("emailMeName", () => {
  it("names the destination after the lowercased address", () => {
    expect(emailMeName(EMAIL)).toBe("email-user@example.com");
  });

  it.each([
    ["o'brien@example.com", "email-me-o-brien@example.com"],
    ["a%b@example.com", "email-me-a-b@example.com"],
    ["a&b@example.com", "email-me-a-b@example.com"],
  ])("replaces the characters names refuse in %s", (email, name) => {
    expect(emailMeName(email)).toBe(name);
  });
});

describe("useEmailMeDestination", () => {
  it("creates nothing when the destination list cannot be read", async () => {
    mocks.listFails = true;
    expect(await ensure()).toEqual({ failure: "email" });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("reuses an email destination whose only recipient is the user", async () => {
    mocks.list = [
      { name: "team", type: "email", emails: ["user@example.com", "b@example.com"] },
      { name: "mine", type: "email", emails: ["user@example.com"] },
    ];
    expect(await ensure()).toEqual({ name: "mine" });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("creates one with the prebuilt email template when none fits", async () => {
    mocks.list = [{ name: "hook", type: "http" }];
    expect(await ensure()).toEqual({ name: "email-user@example.com" });
    expect(mocks.save).toHaveBeenCalledWith({
      destination_name: "email-user@example.com",
      module: "alert",
      data: {
        name: "email-user@example.com",
        type: "email",
        template: "prebuilt_email",
        skip_tls_verify: false,
        output_format: "json",
        destination_type_name: "email",
        emails: ["user@example.com"],
      },
    });
  });

  it("tries -2 then -3 when the name is taken by another destination", async () => {
    mocks.save
      .mockRejectedValueOnce(refusal("Destination with the same name already exists"))
      .mockRejectedValueOnce(refusal("Destination with the same name already exists"))
      .mockResolvedValueOnce({});
    expect(await ensure()).toEqual({ name: "email-user@example.com-3" });
    expect(mocks.save.mock.calls.map(([vars]) => vars.destination_name)).toEqual([
      "email-user@example.com",
      "email-user@example.com-2",
      "email-user@example.com-3",
    ]);
  });

  it("reports email when the server has no SMTP", async () => {
    mocks.save.mockRejectedValue(refusal("Email destination must have SMTP configured"));
    expect(await ensure()).toEqual({ failure: "email" });
  });

  it("reports forbidden on a 403", async () => {
    mocks.save.mockRejectedValue(refusal("Unauthorized Access", 403));
    expect(await ensure()).toEqual({ failure: "forbidden" });
  });

  it("reports email when the recipient is refused as not an org member", async () => {
    mocks.save.mockRejectedValue(
      refusal("Email destination recipients must be part of this org: user@example.com"),
    );
    expect(await ensure()).toEqual({ failure: "email" });
  });

  it("reports email for any other save error", async () => {
    mocks.save.mockRejectedValue(new Error("network"));
    expect(await ensure()).toEqual({ failure: "email" });
  });

  it("reports email when there is no address to send to", async () => {
    expect(await ensure("")).toEqual({ failure: "email" });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
