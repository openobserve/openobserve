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

import { describe, expect, it, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";

import CreateAlertFromSourceDialog from "@/components/alerts/CreateAlertFromSourceDialog.vue";
import { ALERT_PREFILL_VERSION, type AlertPrefill } from "@/ts/interfaces/alertPrefill";

// ODialog and OCodeBlock are portal/highlighter heavy — stub them down to what
// this component's own logic needs.
const ODialogStub = {
  name: "ODialog",
  props: ["open", "primaryButtonDisabled"],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `<div data-test="dialog-stub"><slot /></div>`,
};

const stubs = {
  ODialog: ODialogStub,
  OCodeBlock: { name: "OCodeBlock", props: ["code"], template: `<pre>{{ code }}</pre>` },
  ORadioGroup: { name: "ORadioGroup", template: `<div><slot /></div>` },
  ORadio: { name: "ORadio", props: ["value", "label"], template: `<label>{{ label }}</label>` },
  OToggleGroup: { name: "OToggleGroup", template: `<div><slot /></div>` },
  OToggleGroupItem: { name: "OToggleGroupItem", props: ["value"], template: `<button><slot /></button>` },
};

const prefill = (overrides: Partial<AlertPrefill> = {}): AlertPrefill => ({
  version: ALERT_PREFILL_VERSION,
  source: "logs",
  sourceLabel: "k8s_logs",
  streamType: "logs",
  streamName: "k8s_logs",
  queryType: "sql",
  sql: 'SELECT * FROM "k8s_logs"',
  periodMinutes: 15,
  warnings: [],
  ...overrides,
});

const mountDialog = (p: AlertPrefill | null, open = true) =>
  mount(CreateAlertFromSourceDialog, {
    props: { open, prefill: p },
    global: { plugins: [i18n], stubs },
  });

let wrapper: ReturnType<typeof mount> | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("CreateAlertFromSourceDialog", () => {
  it("renders the resolved query", () => {
    wrapper = mountDialog(prefill());
    expect(wrapper.find('[data-test="create-alert-query-preview"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('SELECT * FROM "k8s_logs"');
  });

  it("shows the promql query for a promql prefill", () => {
    wrapper = mountDialog(
      prefill({ queryType: "promql", sql: undefined, promql: "rate(cpu[5m])" }),
    );
    expect(wrapper.text()).toContain("rate(cpu[5m])");
  });

  it("hides the stream picker when there is only one stream", () => {
    wrapper = mountDialog(prefill());
    expect(wrapper.find('[data-test="create-alert-stream-picker"]').exists()).toBe(false);
  });

  it("shows the stream picker when the surface offered a choice", () => {
    wrapper = mountDialog(
      prefill({
        streamCandidates: [
          { name: "a", type: "logs" },
          { name: "b", type: "logs" },
        ],
      }),
    );
    expect(wrapper.find('[data-test="create-alert-stream-picker"]').exists()).toBe(true);
  });

  it("renders one banner per warning", () => {
    wrapper = mountDialog(
      prefill({
        warnings: [
          { key: "limitStripped", level: "warning" },
          { key: "absoluteToRolling", level: "warning", params: { minutes: 30 } },
        ],
      }),
    );
    expect(wrapper.find('[data-test="create-alert-warning-limitStripped"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="create-alert-warning-absoluteToRolling"]').exists()).toBe(true);
  });

  it("disables Continue when the prefill is blocked", () => {
    wrapper = mountDialog(prefill({ warnings: [{ key: "noStream", level: "blocking" }] }));
    expect(wrapper.findComponent(ODialogStub).props("primaryButtonDisabled")).toBe(true);
  });

  it("emits the prefill with the chosen threshold shape on confirm", async () => {
    wrapper = mountDialog(prefill());
    await wrapper.findComponent(ODialogStub).vm.$emit("click:primary");

    const emitted = wrapper.emitted("confirm");
    expect(emitted).toHaveLength(1);
    expect((emitted![0][0] as AlertPrefill).thresholdShape).toBe("matching-rows");
  });

  it("defaults the threshold shape from the source registry", async () => {
    wrapper = mountDialog(prefill({ source: "patterns" }));
    await wrapper.findComponent(ODialogStub).vm.$emit("click:primary");

    const emitted = wrapper.emitted("confirm");
    expect((emitted![0][0] as AlertPrefill).thresholdShape).toBe("count");
  });

  it("does not emit confirm when the prefill is blocked", async () => {
    wrapper = mountDialog(prefill({ warnings: [{ key: "noStream", level: "blocking" }] }));
    await wrapper.findComponent(ODialogStub).vm.$emit("click:primary");
    expect(wrapper.emitted("confirm")).toBeUndefined();
  });

  it("emits cancel and closes on the secondary button", async () => {
    wrapper = mountDialog(prefill());
    await wrapper.findComponent(ODialogStub).vm.$emit("click:secondary");

    expect(wrapper.emitted("cancel")).toHaveLength(1);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("renders nothing but the shell when there is no prefill", () => {
    wrapper = mountDialog(null);
    expect(wrapper.find('[data-test="create-alert-query-preview"]').exists()).toBe(false);
  });

  it("reseeds its controls when a new prefill arrives", async () => {
    wrapper = mountDialog(prefill({ source: "logs" }));
    await wrapper.setProps({ prefill: prefill({ source: "patterns", streamName: "other" }) });
    await wrapper.findComponent(ODialogStub).vm.$emit("click:primary");

    const confirmed = wrapper.emitted("confirm")![0][0] as AlertPrefill;
    expect(confirmed.streamName).toBe("other");
    expect(confirmed.thresholdShape).toBe("count");
  });
});
