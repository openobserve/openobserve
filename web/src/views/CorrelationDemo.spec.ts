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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { Notify } from "quasar";
import { nextTick } from "vue";
import CorrelationDemo from "./CorrelationDemo.vue";
import store from "@/test/unit/helpers/store";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

installQuasar({ plugins: { Notify } });

// ---------------------------------------------------------------------------
// Stub heavy child component
// ---------------------------------------------------------------------------
vi.mock("@/components/TelemetryCorrelationPanel.vue", () => ({
  default: {
    name: "TelemetryCorrelationPanel",
    props: ["show", "context", "sourceType", "timeWindowMinutes"],
    emits: ["close"],
    template:
      "<div data-test='telemetry-correlation-panel' :data-show='String(show)' :data-source-type='sourceType' :data-time-window='timeWindowMinutes'></div>",
  },
}));

const i18n = createI18n({
  locale: "en",
  legacy: false,
  messages: { en: {} },
});

// ---------------------------------------------------------------------------
// ODialog stub — replaces the migrated query preview dialog (q-dialog -> ODialog)
// ---------------------------------------------------------------------------
const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
    </div>
  `,
};

describe("CorrelationDemo.vue", () => {
  let wrapper: any;

  const createWrapper = () => {
    return mount(CorrelationDemo, {
      global: {
        plugins: [i18n, store],
        stubs: {
          ODialog: ODialogStub,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // -------------------------------------------------------------------------
  // Mounting
  // -------------------------------------------------------------------------
  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render three sample log lines", () => {
      wrapper = createWrapper();
      const logLines = wrapper.findAll(".log-line");
      expect(logLines).toHaveLength(3);
    });

    it("should render the instructions card with How to Use heading", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("How to Use");
    });

    it("should render the TelemetryCorrelationPanel child component", () => {
      wrapper = createWrapper();
      const panel = wrapper.find("[data-test='telemetry-correlation-panel']");
      expect(panel.exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  describe("Initial state", () => {
    it("should initialise showCorrelation to false", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.showCorrelation).toBe(false);
    });

    it("should initialise selectedContext to null", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.selectedContext).toBeNull();
    });

    it("should initialise showQueryDialog to false", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.showQueryDialog).toBe(false);
    });

    it("should initialise queryPreview with empty type and sql", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.queryPreview).toEqual({ type: "", sql: "" });
    });

    it("should initialise isServiceStreamsEnabled to true", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.isServiceStreamsEnabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Conditional rendering — fallback card visibility
  // -------------------------------------------------------------------------
  describe("Fallback card conditional rendering", () => {
    it("should show fallback card when showCorrelation is false", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain(
        "Click a log line to see related telemetry",
      );
    });

    it("should hide fallback card when showCorrelation is true", async () => {
      wrapper = createWrapper();
      wrapper.vm.showCorrelation = true;
      await nextTick();
      expect(wrapper.text()).not.toContain(
        "Click a log line to see related telemetry",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Service Streams status badge
  // -------------------------------------------------------------------------
  describe("Service Streams status badge", () => {
    it("should show enabled badge when isServiceStreamsEnabled is true", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("Service Streams: Enabled");
    });

    it("should show disabled badge when isServiceStreamsEnabled is false", async () => {
      wrapper = createWrapper();
      wrapper.vm.isServiceStreamsEnabled = false;
      await nextTick();
      expect(wrapper.text()).toContain("Service Streams: Disabled");
    });
  });

  // -------------------------------------------------------------------------
  // selectLog method
  // -------------------------------------------------------------------------
  describe("selectLog method", () => {
    it("should set selectedContext with timestamp and fields from log", () => {
      wrapper = createWrapper();
      const log = {
        _timestamp: 1234567890,
        "service.name": "demo-service",
        message: "hello",
      };
      wrapper.vm.selectLog(log);
      expect(wrapper.vm.selectedContext).toEqual({
        timestamp: 1234567890,
        fields: log,
      });
    });

    it("should set showCorrelation to true", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.showCorrelation).toBe(false);
      wrapper.vm.selectLog({ _timestamp: 1, "service.name": "x" });
      expect(wrapper.vm.showCorrelation).toBe(true);
    });

    it("should be triggered when a log line is clicked", async () => {
      wrapper = createWrapper();
      const firstLogLine = wrapper.findAll(".log-line")[0];
      await firstLogLine.trigger("click");
      expect(wrapper.vm.showCorrelation).toBe(true);
      expect(wrapper.vm.selectedContext).not.toBeNull();
      expect(wrapper.vm.selectedContext.fields["service.name"]).toBe(
        "checkout-api",
      );
    });

    it("should populate context fields when second log line is clicked", async () => {
      wrapper = createWrapper();
      const secondLogLine = wrapper.findAll(".log-line")[1];
      await secondLogLine.trigger("click");
      expect(wrapper.vm.selectedContext.fields["service.name"]).toBe(
        "inventory-service",
      );
      expect(wrapper.vm.selectedContext.fields["k8s.cluster"]).toBe(
        "prod-us-east",
      );
    });

    it("should populate context fields when third log line is clicked", async () => {
      wrapper = createWrapper();
      const thirdLogLine = wrapper.findAll(".log-line")[2];
      await thirdLogLine.trigger("click");
      expect(wrapper.vm.selectedContext.fields["service.name"]).toBe(
        "user-auth",
      );
      expect(wrapper.vm.selectedContext.fields.region).toBe("us-west-2");
    });

    it("should overwrite previous selectedContext on subsequent calls", () => {
      wrapper = createWrapper();
      wrapper.vm.selectLog({ _timestamp: 1, "service.name": "a" });
      const firstContext = wrapper.vm.selectedContext;
      wrapper.vm.selectLog({ _timestamp: 2, "service.name": "b" });
      expect(wrapper.vm.selectedContext).not.toEqual(firstContext);
      expect(wrapper.vm.selectedContext.timestamp).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // TelemetryCorrelationPanel wiring
  // -------------------------------------------------------------------------
  describe("TelemetryCorrelationPanel wiring", () => {
    it("should pass showCorrelation to panel's show prop", async () => {
      wrapper = createWrapper();
      wrapper.vm.showCorrelation = true;
      await nextTick();
      const panel = wrapper.find("[data-test='telemetry-correlation-panel']");
      expect(panel.attributes("data-show")).toBe("true");
    });

    it("should pass sourceType='logs' to the panel", () => {
      wrapper = createWrapper();
      const panel = wrapper.find("[data-test='telemetry-correlation-panel']");
      expect(panel.attributes("data-source-type")).toBe("logs");
    });

    it("should pass timeWindowMinutes=5 to the panel", () => {
      wrapper = createWrapper();
      const panel = wrapper.find("[data-test='telemetry-correlation-panel']");
      expect(panel.attributes("data-time-window")).toBe("5");
    });

    it("should set showCorrelation to false when panel emits close", async () => {
      wrapper = createWrapper();
      wrapper.vm.showCorrelation = true;
      await nextTick();

      const panel = wrapper.findComponent({ name: "TelemetryCorrelationPanel" });
      panel.vm.$emit("close");
      await nextTick();

      expect(wrapper.vm.showCorrelation).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // ODialog wiring (query preview dialog)
  // -------------------------------------------------------------------------
  describe("ODialog wiring (query preview dialog)", () => {
    it("should render the ODialog stub", () => {
      wrapper = createWrapper();
      const dialog = wrapper.find("[data-test='o-dialog-stub']");
      expect(dialog.exists()).toBe(true);
    });

    it("should pass size='md' to ODialog", () => {
      wrapper = createWrapper();
      const dialog = wrapper.find("[data-test='o-dialog-stub']");
      expect(dialog.attributes("data-size")).toBe("md");
    });

    it("should pass title='Generated Query' to ODialog", () => {
      wrapper = createWrapper();
      const dialog = wrapper.find("[data-test='o-dialog-stub']");
      expect(dialog.attributes("data-title")).toBe("Generated Query");
    });

    it("should pass primaryButtonLabel='Close' to ODialog", () => {
      wrapper = createWrapper();
      const dialog = wrapper.find("[data-test='o-dialog-stub']");
      expect(dialog.attributes("data-primary-label")).toBe("Close");
    });

    it("should default the ODialog open state to false", () => {
      wrapper = createWrapper();
      const dialog = wrapper.find("[data-test='o-dialog-stub']");
      expect(dialog.attributes("data-open")).toBe("false");
    });

    it("should open the ODialog when showQueryDialog becomes true", async () => {
      wrapper = createWrapper();
      wrapper.vm.showQueryDialog = true;
      await nextTick();
      const dialog = wrapper.find("[data-test='o-dialog-stub']");
      expect(dialog.attributes("data-open")).toBe("true");
    });

    it("should close ODialog when click:primary is emitted", async () => {
      wrapper = createWrapper();
      wrapper.vm.showQueryDialog = true;
      await nextTick();

      const dialog = wrapper.findComponent({ name: "ODialog" });
      dialog.vm.$emit("click:primary");
      await nextTick();

      expect(wrapper.vm.showQueryDialog).toBe(false);
    });

    it("should render query preview type in dialog body when set", async () => {
      wrapper = createWrapper();
      wrapper.vm.queryPreview = { type: "traces", sql: "SELECT * FROM traces" };
      wrapper.vm.showQueryDialog = true;
      await nextTick();

      const dialog = wrapper.find("[data-test='o-dialog-stub']");
      expect(dialog.text()).toContain("traces");
      expect(dialog.text()).toContain("SELECT * FROM traces");
    });
  });

  // -------------------------------------------------------------------------
  // Prop reactions on the correlation panel
  // -------------------------------------------------------------------------
  describe("Reactive prop forwarding to TelemetryCorrelationPanel", () => {
    it("should forward updated context after selectLog", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectLog({
        _timestamp: 999,
        "service.name": "reactive-service",
      });
      await nextTick();

      const panel = wrapper.findComponent({ name: "TelemetryCorrelationPanel" });
      expect(panel.props("context")).toEqual({
        timestamp: 999,
        fields: {
          _timestamp: 999,
          "service.name": "reactive-service",
        },
      });
      expect(panel.props("show")).toBe(true);
    });

    it("should hide panel show flag when showCorrelation is reset to false", async () => {
      wrapper = createWrapper();
      wrapper.vm.showCorrelation = true;
      await nextTick();
      wrapper.vm.showCorrelation = false;
      await nextTick();

      const panel = wrapper.find("[data-test='telemetry-correlation-panel']");
      expect(panel.attributes("data-show")).toBe("false");
    });
  });
});
