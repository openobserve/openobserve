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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

vi.mock("@/services/incidents", () => ({
  default: {
    getRcaFeedback: vi.fn(),
    putRcaFeedback: vi.fn(),
    deleteRcaFeedback: vi.fn(),
  },
}));

import i18n from "@/locales";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import incidentsService, { type RcaFeedback as RcaFeedbackRow } from "@/services/incidents";
import RcaFeedback from "./RcaFeedback.vue";

const service = vi.mocked(incidentsService);

const row = (overrides: Partial<RcaFeedbackRow> = {}): RcaFeedbackRow => ({
  run_id: "run-1",
  author_email: "me@acme.io",
  incident_id: "inc-1",
  subject_type: "incident",
  subject_id: "inc-1",
  verdict: "yes",
  note: null,
  reasons: [],
  created_at: 1,
  updated_at: 1,
  ...overrides,
});

const listed = (mine: RcaFeedbackRow | null, items: RcaFeedbackRow[] = mine ? [mine] : []) =>
  ({ data: { items, mine } }) as never;

const httpError = (status: number, message?: string) => ({
  isAxiosError: true,
  response: { status, data: message ? { message } : {} },
});

const mountFeedback = (runId = "run-1") =>
  mount(RcaFeedback, {
    props: { orgId: "default", incidentId: "inc-1", runId },
    global: { plugins: [i18n, withQueryClient()] },
  });

const byTest = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${id}"]`);

const pressed = (wrapper: VueWrapper) =>
  (["yes", "no"] as const).filter(
    (verdict) => byTest(wrapper, `rca-feedback-${verdict}`).attributes("aria-pressed") === "true",
  );

const message = (wrapper: VueWrapper) => {
  const p = byTest(wrapper, "rca-feedback-message");
  return p.exists() ? p.text().replace(/\s*Undo$/, "") : null;
};

const errorText = (wrapper: VueWrapper) => {
  const p = byTest(wrapper, "rca-feedback-error");
  return p.exists() ? p.text() : null;
};

describe("RcaFeedback (J4)", () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    service.getRcaFeedback.mockResolvedValue(listed(null));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  describe("load", () => {
    it("asks for the run's feedback and shows the question with Yes / No only", async () => {
      wrapper = mountFeedback();
      await flushPromises();

      expect(service.getRcaFeedback).toHaveBeenCalledWith("default", "inc-1", "run-1");
      expect(wrapper.text()).toContain("Is this the cause?");
      const toggles = wrapper.findAll('[data-test^="rca-feedback-"][aria-pressed]');
      expect(toggles.map((b) => b.text())).toEqual(["Yes", "No"]);
      expect(pressed(wrapper)).toEqual([]);
      expect(message(wrapper)).toBeNull();
    });

    it("shows only the caller's row: other authors' feedback stays hidden", async () => {
      service.getRcaFeedback.mockResolvedValue(
        listed(null, [row({ author_email: "other@acme.io", verdict: "no" })]),
      );
      wrapper = mountFeedback();
      await flushPromises();

      expect(pressed(wrapper)).toEqual([]);
      expect(message(wrapper)).toBeNull();
    });

    it.each([
      [row({ verdict: "yes" }), "yes", "Marked as the cause."],
      [row({ verdict: "no", reasons: ["wrong_service"] }), "no", "Marked as not the cause."],
    ])("a saved %# row: pressed %s and its message", async (mine, verdict, text) => {
      service.getRcaFeedback.mockResolvedValue(
        listed(mine, [mine, row({ author_email: "other@acme.io", verdict: "yes" })]),
      );
      wrapper = mountFeedback();
      await flushPromises();

      expect(pressed(wrapper)).toEqual([verdict]);
      expect(message(wrapper)).toBe(text);
      expect(byTest(wrapper, "rca-feedback-undo").text()).toBe("Undo");
    });

    it("a failed load says so and keeps the controls usable", async () => {
      service.getRcaFeedback.mockRejectedValue(httpError(500));
      wrapper = mountFeedback();
      await flushPromises();

      expect(errorText(wrapper)).toBe("Could not load your feedback.");
      expect(byTest(wrapper, "rca-feedback-yes").attributes("disabled")).toBeUndefined();
    });

    it("the controls are disabled while the feedback loads", async () => {
      const read = Promise.withResolvers<unknown>();
      service.getRcaFeedback.mockReturnValue(read.promise as never);
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-yes").trigger("click");
      expect(service.putRcaFeedback).not.toHaveBeenCalled();

      read.resolve(listed(null));
      await flushPromises();
      expect(byTest(wrapper, "rca-feedback-yes").attributes("disabled")).toBeUndefined();
    });
  });

  describe("Yes", () => {
    it("saves verdict yes, then 'Marked as the cause.' with Undo", async () => {
      service.putRcaFeedback.mockResolvedValue({ data: row({ verdict: "yes" }) } as never);
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-yes").trigger("click");
      await flushPromises();

      expect(service.putRcaFeedback).toHaveBeenCalledWith("default", "inc-1", "run-1", {
        verdict: "yes",
      });
      expect(pressed(wrapper)).toEqual(["yes"]);
      expect(message(wrapper)).toBe("Marked as the cause.");
    });

    it("a second Yes on a saved Yes sends nothing", async () => {
      service.getRcaFeedback.mockResolvedValue(listed(row({ verdict: "yes" })));
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-yes").trigger("click");
      await flushPromises();

      expect(service.putRcaFeedback).not.toHaveBeenCalled();
      expect(message(wrapper)).toBe("Marked as the cause.");
    });

    it("busy: while the save is in flight no second action starts", async () => {
      const put = Promise.withResolvers<unknown>();
      service.putRcaFeedback.mockReturnValue(put.promise as never);
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-yes").trigger("click");
      for (const v of ["yes", "no"]) {
        expect(byTest(wrapper, `rca-feedback-${v}`).attributes("disabled")).toBeDefined();
        await byTest(wrapper, `rca-feedback-${v}`).trigger("click");
      }
      expect(service.putRcaFeedback).toHaveBeenCalledTimes(1);
      expect(byTest(wrapper, "rca-feedback-no-panel").exists()).toBe(false);

      put.resolve({ data: row({ verdict: "yes" }) });
      await flushPromises();
      expect(byTest(wrapper, "rca-feedback-no").attributes("disabled")).toBeUndefined();
    });
  });

  describe("No", () => {
    it("opens the four reason chips and an optional note; nothing is sent yet", async () => {
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-no").trigger("click");

      const panel = byTest(wrapper, "rca-feedback-no-panel");
      expect(panel.text()).toContain("What’s wrong with it?");
      expect(panel.findAll('[data-test^="rca-feedback-chip-"]').map((c) => c.text())).toEqual([
        "Wrong service",
        "Symptom, not cause",
        "Evidence doesn’t hold",
        "Missed a change",
      ]);
      expect(panel.text()).toContain("Note for the agent (optional)");
      expect(byTest(wrapper, "rca-feedback-send").text()).toBe("Send feedback");
      expect(pressed(wrapper)).toEqual(["no"]);
      expect(service.putRcaFeedback).not.toHaveBeenCalled();
    });

    it("sends the picked reasons and the trimmed note, then 'Marked as not the cause.'", async () => {
      service.putRcaFeedback.mockResolvedValue({
        data: row({ verdict: "no", reasons: ["symptom_not_cause", "missed_change"] }),
      } as never);
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-no").trigger("click");
      await byTest(wrapper, "rca-feedback-chip-symptom_not_cause").trigger("click");
      await byTest(wrapper, "rca-feedback-chip-wrong_service").trigger("click");
      await byTest(wrapper, "rca-feedback-chip-missed_change").trigger("click");
      // Toggling a chip again removes it.
      await byTest(wrapper, "rca-feedback-chip-wrong_service").trigger("click");
      expect(byTest(wrapper, "rca-feedback-chip-wrong_service").attributes("aria-pressed")).toBe(
        "false",
      );
      await byTest(wrapper, "rca-feedback-no-panel").find("textarea").setValue("  pool raised  ");
      await byTest(wrapper, "rca-feedback-send").trigger("click");
      await flushPromises();

      expect(service.putRcaFeedback).toHaveBeenCalledWith("default", "inc-1", "run-1", {
        verdict: "no",
        reasons: ["symptom_not_cause", "missed_change"],
        note: "pool raised",
      });
      expect(byTest(wrapper, "rca-feedback-no-panel").exists()).toBe(false);
      expect(message(wrapper)).toBe("Marked as not the cause.");
    });

    it("no reasons and a blank note send a bare No", async () => {
      service.putRcaFeedback.mockResolvedValue({ data: row({ verdict: "no" }) } as never);
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-no").trigger("click");
      await byTest(wrapper, "rca-feedback-no-panel").find("textarea").setValue("   ");
      await byTest(wrapper, "rca-feedback-send").trigger("click");
      await flushPromises();

      expect(service.putRcaFeedback.mock.calls[0][3]).toEqual({
        verdict: "no",
        reasons: [],
        note: undefined,
      });
    });

    it("Cancel closes the panel without sending and restores the saved state", async () => {
      service.getRcaFeedback.mockResolvedValue(listed(row({ verdict: "yes" })));
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-no").trigger("click");
      expect(message(wrapper)).toBeNull();
      await byTest(wrapper, "rca-feedback-cancel").trigger("click");

      expect(service.putRcaFeedback).not.toHaveBeenCalled();
      expect(pressed(wrapper)).toEqual(["yes"]);
      expect(message(wrapper)).toBe("Marked as the cause.");
    });

    it("reopening a saved No shows its saved reasons and note", async () => {
      service.getRcaFeedback.mockResolvedValue(
        listed(row({ verdict: "no", reasons: ["evidence_does_not_hold"], note: "flaky" })),
      );
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-no").trigger("click");

      expect(
        byTest(wrapper, "rca-feedback-chip-evidence_does_not_hold").attributes("aria-pressed"),
      ).toBe("true");
      expect(byTest(wrapper, "rca-feedback-no-panel").find("textarea").element.value).toBe("flaky");
    });

    it("busy: while the No is sending, the chips, note and Cancel are disabled", async () => {
      const put = Promise.withResolvers<unknown>();
      service.putRcaFeedback.mockReturnValue(put.promise as never);
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-no").trigger("click");
      await byTest(wrapper, "rca-feedback-send").trigger("click");

      const panel = byTest(wrapper, "rca-feedback-no-panel");
      for (const chip of panel.findAll('[data-test^="rca-feedback-chip-"]')) {
        expect(chip.attributes("disabled")).toBeDefined();
      }
      expect(panel.find("textarea").attributes("disabled")).toBeDefined();
      expect(byTest(wrapper, "rca-feedback-cancel").attributes("disabled")).toBeDefined();

      put.resolve({ data: row({ verdict: "no" }) });
      await flushPromises();
    });
  });

  describe("Undo", () => {
    it("sends DELETE and resets to nothing saved", async () => {
      service.getRcaFeedback.mockResolvedValue(listed(row({ verdict: "no" })));
      service.deleteRcaFeedback.mockResolvedValue({ status: 204 } as never);
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-undo").trigger("click");
      await flushPromises();

      expect(service.deleteRcaFeedback).toHaveBeenCalledWith("default", "inc-1", "run-1");
      expect(pressed(wrapper)).toEqual([]);
      expect(message(wrapper)).toBeNull();
    });

    it("busy: while Undo is in flight no verdict can be sent", async () => {
      const del = Promise.withResolvers<unknown>();
      service.getRcaFeedback.mockResolvedValue(listed(row({ verdict: "no" })));
      service.deleteRcaFeedback.mockReturnValue(del.promise as never);
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-undo").trigger("click");
      await byTest(wrapper, "rca-feedback-undo").trigger("click");
      await byTest(wrapper, "rca-feedback-yes").trigger("click");

      expect(service.deleteRcaFeedback).toHaveBeenCalledTimes(1);
      expect(service.putRcaFeedback).not.toHaveBeenCalled();
      expect(byTest(wrapper, "rca-feedback-yes").attributes("disabled")).toBeDefined();

      del.resolve({ status: 204 });
      await flushPromises();
      expect(message(wrapper)).toBeNull();
    });

    it("a failed Undo keeps the saved state and shows the error", async () => {
      service.getRcaFeedback.mockResolvedValue(listed(row({ verdict: "yes" })));
      service.deleteRcaFeedback.mockRejectedValue(httpError(500));
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-undo").trigger("click");
      await flushPromises();

      expect(errorText(wrapper)).toBe("Could not undo your feedback.");
      expect(message(wrapper)).toBe("Marked as the cause.");
    });
  });

  describe("errors", () => {
    it.each([
      [httpError(403), "You do not have permission to send feedback."],
      [httpError(409, "not_rateable"), "Feedback opens when the run has finished."],
      [httpError(500, "database is down"), "database is down"],
      [httpError(500), "Could not save your feedback."],
      [new Error("network"), "Could not save your feedback."],
    ])("a failed save (case %#) shows its message and saves nothing", async (failure, text) => {
      service.putRcaFeedback.mockRejectedValue(failure);
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-yes").trigger("click");
      await flushPromises();

      expect(errorText(wrapper)).toBe(text);
      expect(byTest(wrapper, "rca-feedback-error").attributes("role")).toBe("alert");
      expect(pressed(wrapper)).toEqual([]);
      expect(message(wrapper)).toBeNull();
    });

    it("a failed No keeps the panel and the picked reasons for a retry", async () => {
      service.putRcaFeedback.mockRejectedValueOnce(httpError(500));
      wrapper = mountFeedback();
      await flushPromises();

      await byTest(wrapper, "rca-feedback-no").trigger("click");
      await byTest(wrapper, "rca-feedback-chip-wrong_service").trigger("click");
      await byTest(wrapper, "rca-feedback-send").trigger("click");
      await flushPromises();

      expect(byTest(wrapper, "rca-feedback-no-panel").exists()).toBe(true);
      expect(byTest(wrapper, "rca-feedback-chip-wrong_service").attributes("aria-pressed")).toBe(
        "true",
      );
    });
  });

  describe("run switch", () => {
    it("reloads for the new run and drops the old run's late answer", async () => {
      const first = Promise.withResolvers<unknown>();
      service.getRcaFeedback
        .mockReturnValueOnce(first.promise as never)
        .mockResolvedValueOnce(listed(null));
      wrapper = mountFeedback("run-1");
      await flushPromises();

      await wrapper.setProps({ runId: "run-2" });
      await flushPromises();
      first.resolve(listed(row({ verdict: "yes" })));
      await flushPromises();

      expect(service.getRcaFeedback).toHaveBeenLastCalledWith("default", "inc-1", "run-2");
      expect(pressed(wrapper)).toEqual([]);
      expect(message(wrapper)).toBeNull();
      expect(byTest(wrapper, "rca-feedback-yes").attributes("disabled")).toBeUndefined();
    });

    it("a save for the old run that lands after the switch is not shown on the new run", async () => {
      const put = Promise.withResolvers<unknown>();
      service.putRcaFeedback.mockReturnValueOnce(put.promise as never);
      wrapper = mountFeedback("run-1");
      await flushPromises();

      await byTest(wrapper, "rca-feedback-yes").trigger("click");
      await wrapper.setProps({ runId: "run-2" });
      await flushPromises();
      put.resolve({ data: row({ verdict: "yes" }) });
      await flushPromises();

      expect(pressed(wrapper)).toEqual([]);
      expect(message(wrapper)).toBeNull();
      // The new run's controls are not held by the old run's request.
      expect(byTest(wrapper, "rca-feedback-yes").attributes("disabled")).toBeUndefined();
    });

    it("a switch closes an open panel and clears an error", async () => {
      service.putRcaFeedback.mockRejectedValueOnce(httpError(403));
      wrapper = mountFeedback("run-1");
      await flushPromises();
      await byTest(wrapper, "rca-feedback-yes").trigger("click");
      await flushPromises();
      await byTest(wrapper, "rca-feedback-no").trigger("click");
      expect(byTest(wrapper, "rca-feedback-no-panel").exists()).toBe(true);

      await wrapper.setProps({ runId: "run-2" });
      await flushPromises();

      expect(byTest(wrapper, "rca-feedback-no-panel").exists()).toBe(false);
      expect(errorText(wrapper)).toBeNull();
    });
  });
});
