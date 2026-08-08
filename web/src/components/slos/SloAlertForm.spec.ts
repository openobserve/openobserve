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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import SloAlertForm from "./SloAlertForm.vue";

const createSpy = vi.fn().mockResolvedValue({ data: { code: 200 } });
const updateSpy = vi.fn().mockResolvedValue({ data: { code: 200 } });
const getSpy = vi.fn();

vi.mock("@/services/alerts", () => ({
  default: {
    create_by_alert_id: (...a: any[]) => createSpy(...a),
    update_by_alert_id: (...a: any[]) => updateSpy(...a),
    get_by_alert_id: (...a: any[]) => getSpy(...a),
  },
}));

vi.mock("@/services/alert_destination", () => ({
  default: {
    list: vi.fn().mockResolvedValue({ data: [{ name: "dest1" }, { name: "dest2" }] }),
  },
}));

vi.mock("@/services/slos", () => ({
  default: { list: vi.fn().mockResolvedValue({ data: { list: [] } }) },
}));

const slo = {
  id: "slo-123",
  name: "checkout-availability",
  target: 99.9,
  window_secs: 30 * 86400,
  slice_interval_secs: 300,
  group_by: [],
};

const mountForm = async (props: Record<string, any> = {}) => {
  const wrapper = mount(SloAlertForm, {
    props: { slo, ...props },
    global: { plugins: [i18n, store] },
  });
  await flushPromises();
  return wrapper;
};

describe("SloAlertForm", () => {
  beforeEach(() => {
    createSpy.mockClear();
    updateSpy.mockClear();
    getSpy.mockReset();
  });

  // The whole point of moving authoring here: an SLO alert has no stream, and
  // the generic form's stream fields are what made it unusable.
  it("renders no stream fields", async () => {
    const wrapper = await mountForm();
    const html = wrapper.html();
    expect(html).not.toContain("add-alert-stream-type-select-dropdown");
    expect(html).not.toContain("add-alert-stream-name-select-dropdown");
  });

  // The SLO is page context, so its selector must not appear inside the form.
  it("passes the SLO down as context rather than offering a picker", async () => {
    const wrapper = await mountForm();
    expect(wrapper.find('[data-test="slos-sloalertcondition-slo-trigger"]').exists()).toBe(false);
  });

  it("prefills a descriptive, savable name", async () => {
    const wrapper = await mountForm();
    const input = wrapper.find('[data-test="slo-alert-form-name-field"]');
    expect(input.exists()).toBe(true);
    const value = (input.element as HTMLInputElement).value;
    expect(value.length).toBeGreaterThan(0);
    // The backend rejects whitespace and "/" in alert names.
    expect(value).not.toMatch(/[:#?\s'"%&/]/);
  });

  it("creates through the API with an SLO-shaped payload", async () => {
    const wrapper = await mountForm();
    await wrapper.find('[data-test="slo-alert-form-submit"]').trigger("click");
    await flushPromises();

    expect(createSpy).toHaveBeenCalled();
    const body = createSpy.mock.calls[0][1];
    expect(body.query_condition.type).toBe("slo");
    expect(body.query_condition.slo_condition.slo_id).toBe("slo-123");
    expect(body.stream_name).toBe("");
    expect(body.is_real_time).toBe(false);
    // SA-4: the count gate must be at its defaults or the save is rejected.
    expect(body.trigger_condition.operator).toBe("=");
    expect(body.trigger_condition.threshold).toBe(0);
  });

  it("emits saved so the page can refresh its list", async () => {
    const wrapper = await mountForm();
    await wrapper.find('[data-test="slo-alert-form-submit"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("saved")).toBeTruthy();
  });

  // The name is the only field this form validates client-side, and the
  // validation is worth nothing if its message never reaches the screen.
  // `OInput` gates the message on the BOOLEAN `error` prop and reads the text
  // from `errorMessage` — passing the message to `error` alone leaves
  // `effectiveError` as a single space, which the component deliberately
  // refuses to render (it would open an empty row). So the field went red-ish
  // and said nothing about why the save did not happen.
  describe("name validation", () => {
    const nameField = (w: any) => w.find('[data-test="slo-alert-form-name-field"]');
    const nameError = (w: any) => w.find('[data-test="slo-alert-form-name-error"]');

    // vue-i18n returns the KEY when a message is missing, so asserting
    // `text() === t(key)` passes even when the key does not exist and the user
    // is shown "alerts.validation.nameRequired" verbatim. Both halves are
    // needed: the resolved text, and proof it is not a raw key.
    const expectResolvedMessage = (text: string, key: string) => {
      expect(text).not.toBe(key);
      expect(text).not.toMatch(/^[a-z]+(\.[A-Za-z]+)+$/);
      expect(text).toBe(i18n.global.t(key));
    };

    it("shows why an empty name is rejected", async () => {
      const wrapper = await mountForm();
      await nameField(wrapper).setValue("");
      await flushPromises();

      const err = nameError(wrapper);
      expect(err.exists()).toBe(true);
      expectResolvedMessage(err.text(), "alerts.nameRequired");
    });

    it("shows why an unsupported character is rejected", async () => {
      const wrapper = await mountForm();
      await nameField(wrapper).setValue("checkout burn/rate");
      await flushPromises();

      const err = nameError(wrapper);
      expect(err.exists()).toBe(true);
      expectResolvedMessage(err.text(), "alerts.validation.nameUnsupportedChars");
    });

    // The counterpart: a valid name must leave no error text behind, or the
    // message above proves only that the row is always rendered.
    it("shows no error for a valid name", async () => {
      const wrapper = await mountForm();
      await nameField(wrapper).setValue("checkout-burn-14.4x-1h");
      await flushPromises();

      expect(nameError(wrapper).exists()).toBe(false);
    });

    // Without this, an implementation that adds `:error-message` and LEAVES
    // `:error="nameError"` (a string) turns every test above green while
    // keeping the string-into-boolean-prop violation. Vue only dev-warns on it;
    // vitest does not fail. `OInput`'s `error` prop is declared `boolean`.
    it("passes a boolean to OInput's boolean error prop", async () => {
      const wrapper = await mountForm();
      const input = wrapper
        .findAllComponents({ name: "OInput" })
        .find((c: any) => c.attributes("data-test") === "slo-alert-form-name");
      expect(input).toBeTruthy();

      await nameField(wrapper).setValue("");
      await flushPromises();
      expect(input!.props("error")).toBe(true);

      await nameField(wrapper).setValue("valid-name");
      await flushPromises();
      expect(input!.props("error")).toBe(false);
    });

    // `hint` is not an OInput prop. OInput sets `inheritAttrs: false` and binds
    // the leftovers onto its root element, so a stray `:hint` becomes a raw DOM
    // attribute — invisible to every other assertion here, and dead weight.
    it("does not leave a stray hint attribute on the field", async () => {
      const wrapper = await mountForm();
      expect(wrapper.find('[data-test="slo-alert-form-name"]').attributes("hint")).toBeUndefined();
    });

    it("does not call the API while the name is invalid", async () => {
      const wrapper = await mountForm();
      await nameField(wrapper).setValue("");
      await flushPromises();
      await wrapper.find('[data-test="slo-alert-form-submit"]').trigger("click");
      await flushPromises();

      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  it("emits cancel without calling the API", async () => {
    const wrapper = await mountForm();
    await wrapper.find('[data-test="slo-alert-form-cancel"]').trigger("click");
    expect(wrapper.emitted("cancel")).toBeTruthy();
    expect(createSpy).not.toHaveBeenCalled();
  });

  describe("edit mode", () => {
    const stored = {
      id: "alert-9",
      name: "existing-alert",
      description: "d",
      enabled: true,
      destinations: ["dest1"],
      workflows: [],
      tags: ["team:payments"],
      priority: 1,
      trigger_condition: { frequency: 12, silence: 34, period: 12, frequency_type: "minutes" },
      query_condition: {
        type: "slo",
        slo_condition: {
          slo_id: "slo-123",
          kind: "burn_rate",
          operator: ">",
          critical: 6,
          long_window_secs: 21600,
          short_window_secs: 1800,
        },
      },
    };

    it("loads the alert and updates rather than creating", async () => {
      getSpy.mockResolvedValue({ data: stored });
      const wrapper = await mountForm({ alertId: "alert-9" });

      expect(getSpy).toHaveBeenCalled();
      await wrapper.find('[data-test="slo-alert-form-submit"]').trigger("click");
      await flushPromises();

      expect(updateSpy).toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });

    // The PUT replaces the whole alert, so anything the form does not own must
    // ride along or it is deleted.
    it("preserves fields the form does not own", async () => {
      getSpy.mockResolvedValue({ data: stored });
      const wrapper = await mountForm({ alertId: "alert-9" });
      await wrapper.find('[data-test="slo-alert-form-submit"]').trigger("click");
      await flushPromises();

      const body = updateSpy.mock.calls[0][1];
      expect(body.tags).toEqual(["team:payments"]);
      expect(body.priority).toBe(1);
      expect(body.id).toBe("alert-9");
    });

    it("shows the stored values rather than the defaults", async () => {
      getSpy.mockResolvedValue({ data: stored });
      const wrapper = await mountForm({ alertId: "alert-9" });
      const name = wrapper.find('[data-test="slo-alert-form-name-field"]')
        .element as HTMLInputElement;
      expect(name.value).toBe("existing-alert");
    });

    // A failed load must not silently present an empty create form — saving
    // from it would make a SECOND alert instead of editing the first.
    it("surfaces a load failure instead of falling back to a create form", async () => {
      getSpy.mockRejectedValue(new Error("boom"));
      const wrapper = await mountForm({ alertId: "missing" });
      await flushPromises();

      expect(wrapper.emitted("load-error")).toBeTruthy();
      expect(createSpy).not.toHaveBeenCalled();
    });
  });
});
