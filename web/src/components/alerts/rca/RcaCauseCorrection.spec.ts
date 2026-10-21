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
    getRcaCorrection: vi.fn(),
    putRcaCorrection: vi.fn(),
    deleteRcaCorrection: vi.fn(),
  },
}));

import i18n from "@/locales";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import incidentsService, { type RcaCauseCorrection as Correction } from "@/services/incidents";
import RcaCauseCorrection from "./RcaCauseCorrection.vue";

const service = vi.mocked(incidentsService);

const row = (overrides: Partial<Correction> = {}): Correction => ({
  org_id: "default",
  incident_id: "inc-1",
  author_email: "me@acme.io",
  cause: "capacity_or_load",
  note: null,
  created_at: 1,
  updated_at: 1,
  ...overrides,
});

const listed = (mine: Correction | null, items: Correction[] = mine ? [mine] : []) =>
  ({ data: { items, mine } }) as never;

const httpError = (status: number, message?: string) => ({
  isAxiosError: true,
  response: { status, data: message ? { message } : {} },
});

const mountCorrection = (incidentId = "inc-1") =>
  mount(RcaCauseCorrection, {
    props: { orgId: "default", incidentId },
    global: { plugins: [i18n, withQueryClient()] },
  });

const byTest = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${id}"]`);

const text = (wrapper: VueWrapper, id: string) => {
  const node = byTest(wrapper, id);
  return node.exists() ? node.text() : null;
};

const SAVED = "You corrected the cause to Capacity or load. It is saved as a past cause for this incident.";

describe("RcaCauseCorrection", () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    service.getRcaCorrection.mockResolvedValue(listed(null));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  describe("load", () => {
    it("reads the incident's corrections and offers Correct the cause", async () => {
      wrapper = mountCorrection();
      await flushPromises();

      expect(service.getRcaCorrection).toHaveBeenCalledWith("default", "inc-1");
      expect(text(wrapper, "rca-correction-open")).toBe("Correct the cause");
      expect(byTest(wrapper, "rca-correction-message").exists()).toBe(false);
      expect(byTest(wrapper, "rca-correction-others").exists()).toBe(false);
    });

    it("the caller's saved correction shows its cause with Change and Undo", async () => {
      service.getRcaCorrection.mockResolvedValue(listed(row()));
      wrapper = mountCorrection();
      await flushPromises();

      expect(text(wrapper, "rca-correction-message")).toBe(SAVED);
      expect(text(wrapper, "rca-correction-edit")).toBe("Change");
      expect(text(wrapper, "rca-correction-undo")).toBe("Undo");
      expect(byTest(wrapper, "rca-correction-open").exists()).toBe(false);
    });

    it.each([
      [null, [row({ author_email: "a@acme.io" }), row({ author_email: "b@acme.io" })], 2],
      [row(), [row({ author_email: "a@acme.io" }), row()], 1],
    ])("others' corrections are counted without the caller's (case %#)", async (mine, items, n) => {
      service.getRcaCorrection.mockResolvedValue(listed(mine, items));
      wrapper = mountCorrection();
      await flushPromises();

      expect(text(wrapper, "rca-correction-others")).toBe(
        n === 1 ? "1 other responder corrected it." : `${n} other responders corrected it.`,
      );
    });

    it("a failed load says so and keeps the control usable", async () => {
      service.getRcaCorrection.mockRejectedValue(httpError(500));
      wrapper = mountCorrection();
      await flushPromises();

      expect(text(wrapper, "rca-correction-error")).toBe("Could not load the cause correction.");
      expect(byTest(wrapper, "rca-correction-open").attributes("disabled")).toBeUndefined();
    });

    it("the control is disabled while the read is in flight", async () => {
      const read = Promise.withResolvers<unknown>();
      service.getRcaCorrection.mockReturnValue(read.promise as never);
      wrapper = mountCorrection();
      await flushPromises();

      expect(byTest(wrapper, "rca-correction-open").attributes("disabled")).toBeDefined();
      read.resolve(listed(null));
      await flushPromises();
      expect(byTest(wrapper, "rca-correction-open").attributes("disabled")).toBeUndefined();
    });
  });

  describe("save", () => {
    const openForm = async () => {
      wrapper = mountCorrection();
      await flushPromises();
      await byTest(wrapper, "rca-correction-open").trigger("click");
      return byTest(wrapper, "rca-correction-panel");
    };

    it("the form has the correction labels, no on-call hint, no 'still unknown' and the 1,000-character note", async () => {
      const panel = await openForm();

      expect(panel.text()).toContain("What was the actual cause?");
      expect(panel.text()).toContain("Note for the next analysis (optional)");
      expect(panel.text()).not.toContain(String(i18n.global.t("oncall.resolveCauseHint")));
      const options = wrapper!.findComponent(OSelect).props("options");
      expect(options).not.toContainEqual(expect.objectContaining({ value: "still_unknown" }));
      expect(options).toContainEqual(expect.objectContaining({ value: "capacity_or_load" }));
      expect(panel.find("textarea").attributes("maxlength")).toBe("1000");
    });

    it("Save cause waits for a cause, then sends it with the trimmed note and shows it", async () => {
      service.putRcaCorrection.mockResolvedValue({ data: row({ note: "raised pool" }) } as never);
      const panel = await openForm();
      const save = byTest(wrapper!, "rca-correction-save");

      expect(save.text()).toBe("Save cause");
      expect(save.attributes("disabled")).toBeDefined();
      await save.trigger("click");
      expect(service.putRcaCorrection).not.toHaveBeenCalled();

      wrapper!.findComponent(OSelect).vm.$emit("update:modelValue", "capacity_or_load");
      await panel.find("textarea").setValue(" raised pool ");
      await flushPromises();
      await byTest(wrapper!, "rca-correction-save").trigger("click");
      await flushPromises();

      expect(service.putRcaCorrection).toHaveBeenCalledWith("default", "inc-1", {
        cause: "capacity_or_load",
        note: "raised pool",
      });
      expect(byTest(wrapper!, "rca-correction-panel").exists()).toBe(false);
      expect(text(wrapper!, "rca-correction-message")).toBe(SAVED);
    });

    it("a blank note is not sent", async () => {
      service.putRcaCorrection.mockResolvedValue({ data: row() } as never);
      const panel = await openForm();

      wrapper!.findComponent(OSelect).vm.$emit("update:modelValue", "capacity_or_load");
      await panel.find("textarea").setValue("   ");
      await byTest(wrapper!, "rca-correction-save").trigger("click");
      await flushPromises();

      expect(service.putRcaCorrection.mock.calls[0][2]).toEqual({
        cause: "capacity_or_load",
        note: undefined,
      });
    });

    it("Change reopens the form with the saved cause and note; Cancel sends nothing", async () => {
      service.getRcaCorrection.mockResolvedValue(listed(row({ note: "flaky" })));
      wrapper = mountCorrection();
      await flushPromises();

      await byTest(wrapper, "rca-correction-edit").trigger("click");
      expect(wrapper.findComponent(OSelect).props("modelValue")).toBe("capacity_or_load");
      expect(byTest(wrapper, "rca-correction-panel").find("textarea").element.value).toBe("flaky");

      await byTest(wrapper, "rca-correction-cancel").trigger("click");
      expect(service.putRcaCorrection).not.toHaveBeenCalled();
      expect(text(wrapper, "rca-correction-message")).toBe(SAVED);
    });

    it.each([
      [httpError(500, "database is down"), "database is down"],
      [httpError(500), "Could not save the cause."],
      [new Error("network"), "Could not save the cause."],
    ])("a failed save (case %#) keeps the form and shows the error", async (failure, message) => {
      service.putRcaCorrection.mockRejectedValue(failure);
      const panel = await openForm();

      wrapper!.findComponent(OSelect).vm.$emit("update:modelValue", "capacity_or_load");
      await panel.find("textarea").setValue("x");
      await byTest(wrapper!, "rca-correction-save").trigger("click");
      await flushPromises();

      expect(text(wrapper!, "rca-correction-error")).toBe(message);
      expect(byTest(wrapper!, "rca-correction-error").attributes("role")).toBe("alert");
      expect(byTest(wrapper!, "rca-correction-panel").exists()).toBe(true);
    });

    it("a 403 turns the control read-only", async () => {
      service.putRcaCorrection.mockRejectedValue(httpError(403));
      await openForm();

      wrapper!.findComponent(OSelect).vm.$emit("update:modelValue", "capacity_or_load");
      await flushPromises();
      await byTest(wrapper!, "rca-correction-save").trigger("click");
      await flushPromises();

      expect(text(wrapper!, "rca-correction-error")).toBe(
        "You do not have permission to correct the cause.",
      );
      expect(byTest(wrapper!, "rca-correction-panel").exists()).toBe(false);
      expect(byTest(wrapper!, "rca-correction-open").exists()).toBe(false);
    });
  });

  describe("Undo", () => {
    it("sends DELETE and offers Correct the cause again", async () => {
      service.getRcaCorrection.mockResolvedValue(listed(row()));
      service.deleteRcaCorrection.mockResolvedValue({ status: 204 } as never);
      wrapper = mountCorrection();
      await flushPromises();

      await byTest(wrapper, "rca-correction-undo").trigger("click");
      await flushPromises();

      expect(service.deleteRcaCorrection).toHaveBeenCalledWith("default", "inc-1");
      expect(byTest(wrapper, "rca-correction-message").exists()).toBe(false);
      expect(byTest(wrapper, "rca-correction-open").exists()).toBe(true);
    });

    it("a failed Undo keeps the saved correction and shows the error", async () => {
      service.getRcaCorrection.mockResolvedValue(listed(row()));
      service.deleteRcaCorrection.mockRejectedValue(httpError(500));
      wrapper = mountCorrection();
      await flushPromises();

      await byTest(wrapper, "rca-correction-undo").trigger("click");
      await flushPromises();

      expect(text(wrapper, "rca-correction-error")).toBe("Could not undo the cause correction.");
      expect(text(wrapper, "rca-correction-message")).toBe(SAVED);
    });

    it("a 403 keeps the saved correction read-only, without Change or Undo", async () => {
      service.getRcaCorrection.mockResolvedValue(listed(row()));
      service.deleteRcaCorrection.mockRejectedValue(httpError(403));
      wrapper = mountCorrection();
      await flushPromises();

      await byTest(wrapper, "rca-correction-undo").trigger("click");
      await flushPromises();

      expect(text(wrapper, "rca-correction-message")).toBe(SAVED);
      expect(byTest(wrapper, "rca-correction-undo").exists()).toBe(false);
      expect(byTest(wrapper, "rca-correction-edit").exists()).toBe(false);
    });
  });

  describe("incident switch", () => {
    it("reads the new incident and does not show the old incident's late save", async () => {
      const put = Promise.withResolvers<unknown>();
      service.putRcaCorrection.mockReturnValueOnce(put.promise as never);
      wrapper = mountCorrection("inc-1");
      await flushPromises();
      await byTest(wrapper, "rca-correction-open").trigger("click");
      wrapper.findComponent(OSelect).vm.$emit("update:modelValue", "capacity_or_load");
      await flushPromises();
      await byTest(wrapper, "rca-correction-save").trigger("click");

      await wrapper.setProps({ incidentId: "inc-2" });
      await flushPromises();
      put.resolve({ data: row() });
      await flushPromises();

      expect(service.getRcaCorrection).toHaveBeenLastCalledWith("default", "inc-2");
      expect(byTest(wrapper, "rca-correction-message").exists()).toBe(false);
      expect(byTest(wrapper, "rca-correction-panel").exists()).toBe(false);
      expect(byTest(wrapper, "rca-correction-open").attributes("disabled")).toBeUndefined();
    });
  });
});
