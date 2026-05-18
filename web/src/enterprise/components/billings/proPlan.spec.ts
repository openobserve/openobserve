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

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import proPlan from "@/enterprise/components/billings/proPlan.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

const mockProFeatures = [
  { name: "Logs, Metrics, Traces, RUM, Session Replay, Error tracking", price: "", is_parent: true },
  { name: "Ingestion", price: "$0.50 per GB", is_parent: false },
  { name: "Query", price: "$0.01 per GB", is_parent: false },
  { name: "Pipelines", price: "", is_parent: true },
  { name: "Data Processed", price: "$0.20 per GB", is_parent: false },
  { name: "Each additional destination", price: "$0.30 per GB", is_parent: false },
  { name: "Sensitive Data Redaction", price: "$0.15 / GB", is_parent: true },
  { name: "Incident Management", price: "$0 during preview", is_parent: true },
  { name: "AI Assistant", price: "$0 during preview", is_parent: true },
  { name: "AI SRE Agent", price: "$0 during preview", is_parent: true },
  { name: "Audit Trail", price: "2% of monthly spend", is_parent: true },
  { name: "Retention", price: "", is_parent: true },
  { name: "15-Days Retention", price: "Included", is_parent: false },
  { name: "Additional Retention", price: "$0.10 / 30 days", is_parent: false },
  { name: "Unlimited Users", price: "", is_parent: true },
  { name: "Role-Based Access Control (RBAC)", price: "", is_parent: true },
];

describe("proPlan.vue", () => {
  let wrapper: VueWrapper<any>;

  const createWrapper = (props = {}) => {
    return mount(proPlan, {
      props: {
        planType: "free",
        billingProvider: "stripe",
        features: mockProFeatures,
        ...props,
      },
      global: {
        plugins: [i18n],
        provide: { store },
        stubs: {
          "q-card": true,
          "q-chip": true,
          "q-separator": true,
          "OIcon": true,
          "q-btn": {
            template:
              '<button @click="$emit(\'click\')" v-bind="$attrs"><slot/></button>',
            emits: ["click"],
          },
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = createWrapper();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  // ── Component basics ──────────────────────────────────────────────────────

  describe("Component initialization", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("proPlan");
    });

    it("should initialise planName as pay-as-you-go", () => {
      expect(wrapper.vm.planName).toBe("pay-as-you-go");
    });

    it("should expose required properties from setup", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.features).toBeDefined();
      expect(wrapper.vm.cancelSubscription).toBeDefined();
      expect(wrapper.vm.onSubscribe).toBeDefined();
      expect(wrapper.vm.planName).toBeDefined();
      expect(wrapper.vm.btnSubscribe).toBeDefined();
      expect(wrapper.vm.btnCancelSubscription).toBeDefined();
    });
  });

  // ── Features array ────────────────────────────────────────────────────────

  describe("Features array", () => {
    it("should be an array", () => {
      expect(Array.isArray(wrapper.vm.features)).toBe(true);
    });

    it("should have 16 items", () => {
      expect(wrapper.vm.features).toHaveLength(16);
    });

    it("should have all required properties on every item", () => {
      wrapper.vm.features.forEach((f: any) => {
        expect(f).toHaveProperty("name");
        expect(f).toHaveProperty("price");
        expect(f).toHaveProperty("is_parent");
      });
    });

    it("should have 10 parent items", () => {
      const parents = wrapper.vm.features.filter((f: any) => f.is_parent);
      expect(parents).toHaveLength(10);
    });

    it("should have 6 child items", () => {
      const children = wrapper.vm.features.filter((f: any) => !f.is_parent);
      expect(children).toHaveLength(6);
    });

    it("first feature: Logs, Metrics, Traces header (parent, no price)", () => {
      const f = wrapper.vm.features[0];
      expect(f.name).toBe(
        "Logs, Metrics, Traces, RUM, Session Replay, Error tracking"
      );
      expect(f.price).toBe("");
      expect(f.is_parent).toBe(true);
    });

    it("second feature: Ingestion child with correct price", () => {
      const f = wrapper.vm.features[1];
      expect(f.name).toBe("Ingestion");
      expect(f.price).toBe("$0.50 per GB");
      expect(f.is_parent).toBe(false);
    });

    it("third feature: Query child with correct price", () => {
      const f = wrapper.vm.features[2];
      expect(f.name).toBe("Query");
      expect(f.price).toBe("$0.01 per GB");
      expect(f.is_parent).toBe(false);
    });

    it("fourth feature: Pipelines parent, no price", () => {
      const f = wrapper.vm.features[3];
      expect(f.name).toBe("Pipelines");
      expect(f.price).toBe("");
      expect(f.is_parent).toBe(true);
    });

    it("fifth feature: Data Processed child with correct price", () => {
      const f = wrapper.vm.features[4];
      expect(f.name).toBe("Data Processed");
      expect(f.price).toBe("$0.20 per GB");
      expect(f.is_parent).toBe(false);
    });

    it("sixth feature: Each additional destination with correct price", () => {
      const f = wrapper.vm.features[5];
      expect(f.name).toBe("Each additional destination");
      expect(f.price).toBe("$0.30 per GB");
      expect(f.is_parent).toBe(false);
    });

    it("seventh feature: Sensitive Data Redaction with correct price", () => {
      const f = wrapper.vm.features[6];
      expect(f.name).toBe("Sensitive Data Redaction");
      expect(f.price).toBe("$0.15 / GB");
      expect(f.is_parent).toBe(true);
    });

    it("eighth feature: Incident Management preview", () => {
      const f = wrapper.vm.features[7];
      expect(f.name).toBe("Incident Management");
      expect(f.price).toBe("$0 during preview");
      expect(f.is_parent).toBe(true);
    });

    it("ninth feature: AI Assistant preview", () => {
      const f = wrapper.vm.features[8];
      expect(f.name).toBe("AI Assistant");
      expect(f.price).toBe("$0 during preview");
      expect(f.is_parent).toBe(true);
    });

    it("tenth feature: AI SRE Agent preview", () => {
      const f = wrapper.vm.features[9];
      expect(f.name).toBe("AI SRE Agent");
      expect(f.price).toBe("$0 during preview");
      expect(f.is_parent).toBe(true);
    });

    it("eleventh feature: Audit Trail with correct price", () => {
      const f = wrapper.vm.features[10];
      expect(f.name).toBe("Audit Trail");
      expect(f.price).toBe("2% of monthly spend");
      expect(f.is_parent).toBe(true);
    });

    it("twelfth feature: Retention parent, no price", () => {
      const f = wrapper.vm.features[11];
      expect(f.name).toBe("Retention");
      expect(f.price).toBe("");
      expect(f.is_parent).toBe(true);
    });

    it("thirteenth feature: 15-Days Retention Included", () => {
      const f = wrapper.vm.features[12];
      expect(f.name).toBe("15-Days Retention");
      expect(f.price).toBe("Included");
      expect(f.is_parent).toBe(false);
    });

    it("fourteenth feature: Additional Retention with correct price", () => {
      const f = wrapper.vm.features[13];
      expect(f.name).toBe("Additional Retention");
      expect(f.price).toBe("$0.10 / 30 days");
      expect(f.is_parent).toBe(false);
    });

    it("fifteenth feature: Unlimited Users parent, no price", () => {
      const f = wrapper.vm.features[14];
      expect(f.name).toBe("Unlimited Users");
      expect(f.price).toBe("");
      expect(f.is_parent).toBe(true);
    });

    it("sixteenth feature: RBAC parent, no price", () => {
      const f = wrapper.vm.features[15];
      expect(f.name).toBe("Role-Based Access Control (RBAC)");
      expect(f.price).toBe("");
      expect(f.is_parent).toBe(true);
    });
  });

  // ── Props ─────────────────────────────────────────────────────────────────

  describe("Props", () => {
    it("should accept planType prop", () => {
      const w = createWrapper({ planType: "pay-as-you-go" });
      expect(w.props().planType).toBe("pay-as-you-go");
      w.unmount();
    });

    it("should accept billingProvider prop", () => {
      const w = createWrapper({ billingProvider: "aws" });
      expect(w.props().billingProvider).toBe("aws");
      w.unmount();
    });

    it("should accept azure as billingProvider", () => {
      const w = createWrapper({ billingProvider: "azure" });
      expect(w.props().billingProvider).toBe("azure");
      w.unmount();
    });
  });

  // ── Button labels ─────────────────────────────────────────────────────────

  describe("Button labels", () => {
    it("btnSubscribe should be defined", () => {
      expect(wrapper.vm.btnSubscribe).toBeDefined();
    });

    it("btnCancelSubscription should be defined", () => {
      expect(wrapper.vm.btnCancelSubscription).toBeDefined();
    });
  });

  // ── cancelSubscription ────────────────────────────────────────────────────

  describe("cancelSubscription()", () => {
    beforeEach(() => {
      wrapper = createWrapper({ planType: "pay-as-you-go" });
    });

    it("should set btnCancelSubscription to Loading...", () => {
      wrapper.vm.cancelSubscription();
      expect(wrapper.vm.btnCancelSubscription).toBe("Loading...");
    });

    it("should emit update:cancelSubscription", () => {
      wrapper.vm.cancelSubscription();
      expect(wrapper.emitted("update:cancelSubscription")).toBeTruthy();
      expect(wrapper.emitted("update:cancelSubscription")).toHaveLength(1);
    });

    it("should reset btnCancelSubscription after 1 second", async () => {
      vi.useFakeTimers();
      wrapper.vm.cancelSubscription();
      expect(wrapper.vm.btnCancelSubscription).toBe("Loading...");
      vi.advanceTimersByTime(1000);
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.btnCancelSubscription).not.toBe("Loading...");
      vi.useRealTimers();
    });
  });

  // ── onSubscribe ───────────────────────────────────────────────────────────

  describe("onSubscribe()", () => {
    it("should set btnSubscribe to Loading...", () => {
      wrapper.vm.onSubscribe();
      expect(wrapper.vm.btnSubscribe).toBe("Loading...");
    });

    it("should emit update:proSubscription", () => {
      wrapper.vm.onSubscribe();
      expect(wrapper.emitted("update:proSubscription")).toBeTruthy();
      expect(wrapper.emitted("update:proSubscription")).toHaveLength(1);
    });

    it("should reset btnSubscribe after 1 second", async () => {
      vi.useFakeTimers();
      wrapper.vm.onSubscribe();
      expect(wrapper.vm.btnSubscribe).toBe("Loading...");
      vi.advanceTimersByTime(1000);
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.btnSubscribe).not.toBe("Loading...");
      vi.useRealTimers();
    });

    it("should emit once per call", () => {
      wrapper.vm.onSubscribe();
      wrapper.vm.onSubscribe();
      expect(wrapper.emitted("update:proSubscription")).toHaveLength(2);
    });
  });

  // ── Template ──────────────────────────────────────────────────────────────

  describe("Template rendering", () => {
    it("should render without errors", () => {
      expect(wrapper.html()).toBeDefined();
      expect(wrapper.html().length).toBeGreaterThan(0);
    });

    it("should maintain features array throughout lifecycle", async () => {
      const initial = [...wrapper.vm.features];
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.features).toEqual(initial);
    });

    it("should keep planName constant throughout lifecycle", async () => {
      const name = wrapper.vm.planName;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.planName).toBe(name);
    });
  });

  // ── Setup function ────────────────────────────────────────────────────────

  describe("Setup function", () => {
    it("should use Vue 3 composition API", () => {
      expect(wrapper.vm.$options.setup).toBeDefined();
    });

    it("should expose t as a function", () => {
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should expose cancelSubscription as a function", () => {
      expect(typeof wrapper.vm.cancelSubscription).toBe("function");
    });

    it("should expose onSubscribe as a function", () => {
      expect(typeof wrapper.vm.onSubscribe).toBe("function");
    });
  });
});
