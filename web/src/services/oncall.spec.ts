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

import http from "./http";
import oncallService from "./oncall";
import analytics from "./product_analytics";

vi.mock("./http", () => {
  const mockClient = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
  return { default: vi.fn(() => mockClient) };
});
vi.mock("./product_analytics", () => ({ default: { track: vi.fn() } }));

describe("oncall service — the request shapes the server actually accepts", () => {
  const client = (http as unknown as ReturnType<typeof vi.fn>)();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /// This is a *service*-level test on purpose. Every screen mocks the service,
  /// so a component test cannot see that the request itself is malformed — and
  /// that is precisely how this shipped: `escalate` posted with no second
  /// argument, axios sent no `Content-Type`, and the handler's
  /// `Json<Option<EscalateRequest>>` extractor answered **415** before it ever
  /// looked at whether the body was empty. Every escalate control in the
  /// product was dead and every one of them had a passing test.
  describe("escalateNow", () => {
    it("sends a body, so the request carries a JSON content type", () => {
      oncallService.escalateNow({ org_identifier: "default", response_id: "resp_1" });

      expect(client.post).toHaveBeenCalledWith("/api/default/oncall/responses/resp_1/escalate", {});
    });

    it("carries the note when one is given", () => {
      oncallService.escalateNow({
        org_identifier: "default",
        response_id: "resp_1",
        note: "paging the secondary, primary is unreachable",
      });

      expect(client.post).toHaveBeenCalledWith("/api/default/oncall/responses/resp_1/escalate", {
        note: "paging the secondary, primary is unreachable",
      });
    });

    it("escapes the response id rather than pasting it into the path", () => {
      oncallService.escalateNow({ org_identifier: "default", response_id: "resp/1" });

      expect(client.post).toHaveBeenCalledWith(
        "/api/default/oncall/responses/resp%2F1/escalate",
        {},
      );
    });
  });

  /// The sibling verb, kept beside it so the difference is on the record: this
  /// handler takes no extractor, so a bodyless POST is correct here and adding
  /// one would be cargo cult.
  describe("acknowledgeResponse", () => {
    it("posts with no body, which is what its handler expects", () => {
      client.post.mockResolvedValue({ data: {} });
      oncallService.acknowledgeResponse({ org_identifier: "default", response_id: "resp_1" });

      expect(client.post).toHaveBeenCalledWith("/api/default/oncall/responses/resp_1/acknowledge");
    });
  });

  describe("product analytics", () => {
    const org_identifier = "default";
    const team_id = "team_1";
    const response_id = "resp_1";
    const cases: [string, "post" | "put", () => Promise<unknown>, string, object?][] = [
      [
        "createTeam",
        "post",
        () => oncallService.createTeam({ org_identifier, data: { name: "a", timezone: "UTC" } }),
        "oncall_team_created",
      ],
      [
        "applySchedulePreset",
        "post",
        () =>
          oncallService.applySchedulePreset({
            org_identifier,
            team_id,
            data: { preset: "weekly" },
          }),
        "oncall_schedule_saved",
        { source: "preset", preset: "weekly" },
      ],
      [
        "setPolicy",
        "put",
        () => oncallService.setPolicy({ org_identifier, team_id, data: { rungs: [] } }),
        "oncall_escalation_policy_saved",
      ],
      [
        "createOwnershipRule",
        "post",
        () =>
          oncallService.createOwnershipRule({ org_identifier, data: { team_id, dimensions: {} } }),
        "oncall_ownership_rule_created",
      ],
      [
        "testPage",
        "post",
        () => oncallService.testPage({ org_identifier, team_id }),
        "oncall_test_page_sent",
        { reached_anyone: true },
      ],
    ];

    it.each(cases)("%s tracks once the server confirms", async (_, verb, call, event, props) => {
      client[verb].mockResolvedValue({ data: { reached_anyone: true } });

      await call();

      if (props) expect(analytics.track).toHaveBeenCalledWith(event, props);
      else expect(analytics.track).toHaveBeenCalledWith(event);
    });

    it.each(cases)("%s does not track a rejected request", async (_, verb, call) => {
      client[verb].mockRejectedValue(new Error("boom"));

      await expect(call()).rejects.toThrow("boom");

      expect(analytics.track).not.toHaveBeenCalled();
    });

    it("acknowledge and resolve do not track, since one user action calls them per firing", async () => {
      client.post.mockResolvedValue({ data: {} });

      await oncallService.acknowledgeResponse({ org_identifier, response_id });
      await oncallService.resolveResponse({ org_identifier, response_id });

      expect(analytics.track).not.toHaveBeenCalled();
    });

    it("testPage reports a missing reached_anyone as false", async () => {
      client.post.mockResolvedValue({ data: {} });

      await oncallService.testPage({ org_identifier, team_id });

      expect(analytics.track).toHaveBeenCalledWith("oncall_test_page_sent", {
        reached_anyone: false,
      });
    });

    it("setSchedule does not track, since team creation calls it too", async () => {
      client.put.mockResolvedValue({ data: {} });

      await oncallService.setSchedule({
        org_identifier,
        team_id,
        data: { timezone: "UTC", rotations: [] },
      });

      expect(analytics.track).not.toHaveBeenCalled();
    });

    it("createOverride does not track, since a rolled-back swap calls it too", async () => {
      client.post.mockResolvedValue({ data: { id: "o1" } });

      await oncallService.createOverride({
        org_identifier,
        team_id,
        data: { user_email: "a@b.c", start_at: 1, end_at: 2 },
      });

      expect(analytics.track).not.toHaveBeenCalled();
    });
  });
});
