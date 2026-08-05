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
  OCodeBlock: {
    name: "OCodeBlock",
    props: ["code", "wrap", "maxLines"],
    template: `<pre>{{ code }}</pre>`,
  },
  ORadioGroup: { name: "ORadioGroup", template: `<div><slot /></div>` },
  ORadio: { name: "ORadio", props: ["value", "label"], template: `<label>{{ label }}</label>` },
  OToggleGroup: {
    name: "OToggleGroup",
    props: ["modelValue", "type"],
    emits: ["update:modelValue"],
    template: `<div><slot /></div>`,
  },
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
    expect(wrapper.text()).toContain("k8s_logs");
  });

  it("formats the SQL for reading without changing what gets saved", () => {
    const oneLiner = `SELECT * FROM "k8s_logs" WHERE code = 500 AND ns = 'prod'`;
    wrapper = mountDialog(prefill({ sql: oneLiner }));

    // Displayed across lines...
    const shown = wrapper.findComponent({ name: "OCodeBlock" }).props("code") as string;
    expect(shown.split("\n").length).toBeGreaterThan(1);

    // ...but the prefill still carries the query verbatim.
    expect((wrapper.props("prefill") as AlertPrefill).sql).toBe(oneLiner);
  });

  it("leaves a promql query alone — the SQL formatter would mangle it", () => {
    wrapper = mountDialog(
      prefill({ queryType: "promql", sql: undefined, promql: "rate(cpu[5m])" }),
    );
    expect(wrapper.findComponent({ name: "OCodeBlock" }).props("code")).toBe("rate(cpu[5m])");
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

  describe("pattern filter", () => {
    const withPatterns = (overrides = {}) =>
      prefill({
        source: "patterns",
        patternFilter: { mode: "exclude", visibleCount: 6, totalCount: 15, filtered: true },
        ...overrides,
      });

    it("is hidden for a source that has no patterns to fold in", () => {
      wrapper = mountDialog(prefill());
      expect(wrapper.find('[data-test="create-alert-pattern-mode"]').exists()).toBe(false);
    });

    it("appears when the source declares it can fold patterns in", () => {
      wrapper = mountDialog(withPatterns());
      expect(wrapper.find('[data-test="create-alert-pattern-mode"]').exists()).toBe(true);
    });

    it("states the severity-filter dependency rather than leaving it implicit", () => {
      wrapper = mountDialog(withPatterns());
      const scope = wrapper.find('[data-test="create-alert-pattern-scope"]').text();

      expect(scope).toContain("6");
      expect(scope).toContain("15");
    });

    it("says so plainly when no severity filter is applied", () => {
      wrapper = mountDialog(
        withPatterns({
          patternFilter: { mode: "exclude", visibleCount: 15, totalCount: 15, filtered: false },
        }),
      );
      expect(wrapper.find('[data-test="create-alert-pattern-scope"]').text()).toContain("15");
    });

    it("asks the SOURCE to rebuild on mode change rather than editing SQL itself", async () => {
      wrapper = mountDialog(withPatterns());
      await wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "include");

      expect(wrapper.emitted("rebuild")).toHaveLength(1);
      expect(wrapper.emitted("rebuild")![0][0]).toEqual({ patternMode: "include" });
    });

    it("does not rebuild when the mode did not actually change", async () => {
      wrapper = mountDialog(withPatterns());
      await wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "exclude");

      expect(wrapper.emitted("rebuild")).toBeUndefined();
    });
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
