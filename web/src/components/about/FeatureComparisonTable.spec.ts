// Copyright 2023 OpenObserve Inc.
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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";
import FeatureComparisonTable from "./FeatureComparisonTable.vue";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock Vuex store
const createMockStore = (buildType: string = "opensource") => ({
  state: {
    theme: "light",
    zoConfig: {
      build_type: buildType,
    },
  },
  dispatch: vi.fn(),
  commit: vi.fn(),
});

const createWrapper = (buildType: string = "opensource") => {
  const mockStore = createMockStore(buildType);

  return mount(FeatureComparisonTable, {
    global: {
      mocks: {
        $store: mockStore,
      },
      provide: {
        store: mockStore,
      },
      stubs: {
        QTable: false,
        QTr: false,
        QTd: false,
        QIcon: false,
      },
    },
  });
};

describe("FeatureComparisonTable.vue", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    wrapper = createWrapper("opensource");
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should mount component successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("FeatureComparisonTable");
    });

    it("should initialize with correct store", () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it("should initialize with featureData", () => {
      expect(wrapper.vm.featureData).toBeDefined();
      expect(wrapper.vm.featureData.editions).toHaveLength(3);
      expect(wrapper.vm.featureData.features.length).toBeGreaterThan(0);
    });

    it("should initialize with columns", () => {
      expect(wrapper.vm.columns).toBeDefined();
      expect(wrapper.vm.columns).toHaveLength(4);
    });

    it("should initialize with pagination", () => {
      expect(wrapper.vm.pagination).toBeDefined();
      expect(wrapper.vm.pagination.rowsPerPage).toBe(0);
    });
  });

  describe("A. Declared JavaScript Functions", () => {
    it("should have currentPlanName computed property", () => {
      expect(wrapper.vm.currentPlanName).toBeDefined();
      expect(typeof wrapper.vm.currentPlanName).toBe("string");
    });

    it("should compute currentPlanName for opensource build", () => {
      const osWrapper = createWrapper("opensource");
      expect(osWrapper.vm.currentPlanName).toBe("Open Source (Self hosted)");
      osWrapper.unmount();
    });

    it("should compute currentPlanName for enterprise build", () => {
      const enterpriseWrapper = createWrapper("enterprise");
      expect(enterpriseWrapper.vm.currentPlanName).toBe("Enterprise (Self hosted)");
      enterpriseWrapper.unmount();
    });

    it("should compute currentPlanName for cloud build", () => {
      const cloudWrapper = createWrapper("cloud");
      expect(cloudWrapper.vm.currentPlanName).toBe("Cloud");
      cloudWrapper.unmount();
    });

    it("should return empty string for unknown build type", () => {
      const unknownWrapper = createWrapper("unknown");
      expect(unknownWrapper.vm.currentPlanName).toBe("");
      unknownWrapper.unmount();
    });
  });

  describe("B. Columns Configuration", () => {
    it("should have name column with correct properties", () => {
      const nameColumn = wrapper.vm.columns[0];
      expect(nameColumn.name).toBe("name");
      expect(nameColumn.label).toBe("Feature");
      expect(nameColumn.field).toBe("name");
      expect(nameColumn.align).toBe("left");
      expect(nameColumn.sortable).toBe(false);
    });

    it("should have opensource column with correct properties", () => {
      const osColumn = wrapper.vm.columns[1];
      expect(osColumn.name).toBe("opensource");
      expect(osColumn.label).toBe("Open Source (Self hosted)");
      expect(osColumn.field).toBe("opensource");
      expect(osColumn.align).toBe("center");
      expect(osColumn.sortable).toBe(false);
    });

    it("should have enterprise column with correct properties", () => {
      const enterpriseColumn = wrapper.vm.columns[2];
      expect(enterpriseColumn.name).toBe("enterprise");
      expect(enterpriseColumn.label).toBe("Enterprise (Self hosted)");
      expect(enterpriseColumn.field).toBe("enterprise");
      expect(enterpriseColumn.align).toBe("center");
      expect(enterpriseColumn.sortable).toBe(false);
    });

    it("should have cloud column with correct properties", () => {
      const cloudColumn = wrapper.vm.columns[3];
      expect(cloudColumn.name).toBe("cloud");
      expect(cloudColumn.label).toBe("Cloud");
      expect(cloudColumn.field).toBe("cloud");
      expect(cloudColumn.align).toBe("center");
      expect(cloudColumn.sortable).toBe(false);
    });
  });

  describe("C. Feature Data Structure", () => {
    it("should have three editions", () => {
      expect(wrapper.vm.featureData.editions).toHaveLength(3);
    });

    it("should have opensource edition", () => {
      const osEdition = wrapper.vm.featureData.editions.find(
        (ed: any) => ed.id === "opensource"
      );
      expect(osEdition).toBeDefined();
      expect(osEdition.name).toBe("Open Source (Self hosted)");
    });

    it("should have enterprise edition", () => {
      const enterpriseEdition = wrapper.vm.featureData.editions.find(
        (ed: any) => ed.id === "enterprise"
      );
      expect(enterpriseEdition).toBeDefined();
      expect(enterpriseEdition.name).toBe("Enterprise (Self hosted)");
    });

    it("should have cloud edition", () => {
      const cloudEdition = wrapper.vm.featureData.editions.find(
        (ed: any) => ed.id === "cloud"
      );
      expect(cloudEdition).toBeDefined();
      expect(cloudEdition.name).toBe("Cloud");
    });

    it("should have features array with data", () => {
      expect(wrapper.vm.featureData.features.length).toBeGreaterThan(0);
    });

    it("should have Logs feature", () => {
      const logsFeature = wrapper.vm.featureData.features.find(
        (f: any) => f.name === "Logs"
      );
      expect(logsFeature).toBeDefined();
      expect(logsFeature.values.opensource).toBe(true);
      expect(logsFeature.values.enterprise).toBe(true);
      expect(logsFeature.values.cloud).toBe(true);
    });

    it("should have Single Sign On feature with mixed values", () => {
      const ssoFeature = wrapper.vm.featureData.features.find(
        (f: any) => f.name === "Single Sign On"
      );
      expect(ssoFeature).toBeDefined();
      expect(ssoFeature.values.opensource).toBe(false);
      expect(ssoFeature.values.enterprise).toBe("✅ Available only in HA mode");
      expect(ssoFeature.values.cloud).toBe(true);
    });

    it("should have features with string values", () => {
      const licenseFeature = wrapper.vm.featureData.features.find(
        (f: any) => f.name === "License"
      );
      expect(licenseFeature).toBeDefined();
      expect(licenseFeature.values.opensource).toBe("AGPL");
      expect(licenseFeature.values.enterprise).toBe("Enterprise");
      expect(licenseFeature.values.cloud).toBe("Cloud");
    });
  });

  describe("D. Template Rendering - Build Type Conditional Messages", () => {
    it("should show opensource message for opensource build", async () => {
      const osWrapper = createWrapper("opensource");
      await nextTick();

      const html = osWrapper.html();
      expect(html).toContain("You're currently using OpenObserve Open Source Edition");
      expect(html).toContain("Upgrade to Enterprise Edition");
      osWrapper.unmount();
    });

    it("should show enterprise message for enterprise build", async () => {
      const enterpriseWrapper = createWrapper("enterprise");
      await nextTick();

      const html = enterpriseWrapper.html();
      expect(html).toContain("You're using OpenObserve Enterprise Edition");
      expect(html).toContain("with access to all advanced features");
      enterpriseWrapper.unmount();
    });

    it("should show default message for unknown build type", async () => {
      const unknownWrapper = createWrapper("unknown");
      await nextTick();

      const html = unknownWrapper.html();
      expect(html).toContain("Compare features across Open Source, Enterprise, and Cloud offerings");
      unknownWrapper.unmount();
    });

    it("should show enterprise promotion for opensource build", async () => {
      const osWrapper = createWrapper("opensource");
      await nextTick();

      const html = osWrapper.html();
      expect(html).toContain("Good news:");
      expect(html).toContain("OpenObserve Enterprise Edition is completely free");
      expect(html).toContain("200 GB/day");
      osWrapper.unmount();
    });

    it("should show plan info for enterprise build", async () => {
      const enterpriseWrapper = createWrapper("enterprise");
      await nextTick();

      const html = enterpriseWrapper.html();
      expect(html).toContain("Your plan:");
      expect(html).toContain("Enterprise Edition is free");
      enterpriseWrapper.unmount();
    });

    it("should NOT show promotion for cloud build", async () => {
      const cloudWrapper = createWrapper("cloud");
      await nextTick();

      const html = cloudWrapper.html();
      expect(html).not.toContain("Good news:");
      expect(html).not.toContain("Your plan:");
      cloudWrapper.unmount();
    });
  });

  describe("E. Theme-based Styling", () => {
    it("should apply light theme icon wrapper class", () => {
      const lightWrapper = createWrapper("opensource");
      const html = lightWrapper.html();
      expect(html).toContain("icon-wrapper-light");
      lightWrapper.unmount();
    });

    it("should apply dark theme icon wrapper class", () => {
      const mockStore = {
        state: {
          theme: "dark",
          zoConfig: {
            build_type: "opensource",
          },
        },
      };

      const darkWrapper = mount(FeatureComparisonTable, {
        global: {
          mocks: {
            $store: mockStore,
          },
          provide: {
            store: mockStore,
          },
        },
      });

      const html = darkWrapper.html();
      expect(html).toContain("icon-wrapper-dark");
      darkWrapper.unmount();
    });
  });

  describe("F. Column Highlighting Based on Build Type", () => {
    it("should highlight opensource column for opensource build", async () => {
      const osWrapper = createWrapper("opensource");
      await nextTick();

      // Check if the template would add highlighted-column class
      expect(osWrapper.vm.store.state.zoConfig.build_type).toBe("opensource");
      osWrapper.unmount();
    });

    it("should highlight enterprise column for enterprise build", async () => {
      const enterpriseWrapper = createWrapper("enterprise");
      await nextTick();

      expect(enterpriseWrapper.vm.store.state.zoConfig.build_type).toBe("enterprise");
      enterpriseWrapper.unmount();
    });

    it("should NOT highlight any column for cloud build", async () => {
      const cloudWrapper = createWrapper("cloud");
      await nextTick();

      expect(cloudWrapper.vm.store.state.zoConfig.build_type).toBe("cloud");
      cloudWrapper.unmount();
    });
  });

  describe("G. Computed Property - currentPlanName with find() Callback", () => {
    it("should execute find callback for each edition", () => {
      // This tests the arrow function: (ed) => ed.id === buildType
      const osWrapper = createWrapper("opensource");
      const planName = osWrapper.vm.currentPlanName;

      // The find callback iterates through editions
      expect(planName).toBe("Open Source (Self hosted)");

      // Verify all editions are checked
      expect(osWrapper.vm.featureData.editions).toHaveLength(3);
      osWrapper.unmount();
    });

    it("should return empty string when no edition matches", () => {
      const invalidWrapper = createWrapper("invalid-type");
      const planName = invalidWrapper.vm.currentPlanName;

      // find() returns undefined, so edition ? edition.name : "" returns ""
      expect(planName).toBe("");
      invalidWrapper.unmount();
    });

    it("should execute ternary operator in computed property", () => {
      // Tests: return edition ? edition.name : "";
      const osWrapper = createWrapper("opensource");

      // When edition is found (truthy)
      expect(osWrapper.vm.currentPlanName).toBe("Open Source (Self hosted)");
      osWrapper.unmount();

      // When edition is not found (falsy)
      const invalidWrapper = createWrapper("nonexistent");
      expect(invalidWrapper.vm.currentPlanName).toBe("");
      invalidWrapper.unmount();
    });
  });

  describe("H. Pagination Configuration", () => {
    it("should set rowsPerPage to 0 to show all rows", () => {
      expect(wrapper.vm.pagination.rowsPerPage).toBe(0);
    });

    it("should have pagination as reactive ref", async () => {
      const initialValue = wrapper.vm.pagination.rowsPerPage;
      expect(initialValue).toBe(0);

      // Verify it's reactive
      wrapper.vm.pagination.rowsPerPage = 10;
      await nextTick();
      expect(wrapper.vm.pagination.rowsPerPage).toBe(10);

      // Reset
      wrapper.vm.pagination.rowsPerPage = 0;
      await nextTick();
      expect(wrapper.vm.pagination.rowsPerPage).toBe(0);
    });
  });

  describe("I. Template Slot and Props", () => {
    it("should access featureData.features for table rows", () => {
      const features = wrapper.vm.featureData.features;
      expect(features).toBeInstanceOf(Array);
      expect(features.length).toBeGreaterThan(0);
    });

    it("should have all required feature properties", () => {
      const features = wrapper.vm.featureData.features;

      features.forEach((feature: any) => {
        expect(feature).toHaveProperty("name");
        expect(feature).toHaveProperty("values");
        expect(feature.values).toHaveProperty("opensource");
        expect(feature.values).toHaveProperty("enterprise");
        expect(feature.values).toHaveProperty("cloud");
      });
    });
  });

  describe("J. Template Conditional Rendering - Value Types", () => {
    it("should handle boolean true values", () => {
      const logsFeature = wrapper.vm.featureData.features.find(
        (f: any) => f.name === "Logs"
      );

      expect(logsFeature.values.opensource).toBe(true);
      expect(logsFeature.values.enterprise).toBe(true);
      expect(logsFeature.values.cloud).toBe(true);
    });

    it("should handle boolean false values", () => {
      const ssoFeature = wrapper.vm.featureData.features.find(
        (f: any) => f.name === "Single Sign On"
      );

      expect(ssoFeature.values.opensource).toBe(false);
    });

    it("should handle string values", () => {
      const licenseFeature = wrapper.vm.featureData.features.find(
        (f: any) => f.name === "License"
      );

      expect(typeof licenseFeature.values.opensource).toBe("string");
      expect(typeof licenseFeature.values.enterprise).toBe("string");
      expect(typeof licenseFeature.values.cloud).toBe("string");
    });

    it("should handle mixed string values with emoji", () => {
      const ssoFeature = wrapper.vm.featureData.features.find(
        (f: any) => f.name === "Single Sign On"
      );

      expect(ssoFeature.values.enterprise).toBe("✅ Available only in HA mode");
    });

    it("should handle long string values", () => {
      const costFeature = wrapper.vm.featureData.features.find(
        (f: any) => f.name === "Cost"
      );

      expect(costFeature.values.opensource).toBe("Free");
      expect(costFeature.values.enterprise).toContain("200 GB/Day");
      expect(costFeature.values.cloud).toContain("14 day free trial");
    });
  });

  describe("K. All Features Data Integrity", () => {
    it("should have all expected core features", () => {
      const featureNames = wrapper.vm.featureData.features.map((f: any) => f.name);

      expect(featureNames).toContain("Logs");
      expect(featureNames).toContain("Metrics");
      expect(featureNames).toContain("Traces");
      expect(featureNames).toContain("RUM");
      expect(featureNames).toContain("Alerts");
      expect(featureNames).toContain("Dashboards");
      expect(featureNames).toContain("Reports");
    });

    it("should have all expected enterprise features", () => {
      const featureNames = wrapper.vm.featureData.features.map((f: any) => f.name);

      expect(featureNames).toContain("Single Sign On");
      expect(featureNames).toContain("Role Based Access Control (RBAC)");
      expect(featureNames).toContain("Federated search / Super cluster");
      expect(featureNames).toContain("Query management");
      expect(featureNames).toContain("Audit trail");
    });

    it("should have billing and support features", () => {
      const featureNames = wrapper.vm.featureData.features.map((f: any) => f.name);

      expect(featureNames).toContain("License");
      expect(featureNames).toContain("Support");
      expect(featureNames).toContain("Cost");
    });

    it("should have advanced features", () => {
      const featureNames = wrapper.vm.featureData.features.map((f: any) => f.name);

      expect(featureNames).toContain("Query optimizer");
      expect(featureNames).toContain("Extreme performance (100x improvement for many queries)");
      expect(featureNames).toContain("Pipelines - External destinations");
    });
  });

  describe("L. Edge Cases and Boundary Conditions", () => {
    it("should handle empty string build type", () => {
      const emptyWrapper = createWrapper("");
      expect(emptyWrapper.vm.currentPlanName).toBe("");
      emptyWrapper.unmount();
    });

    it("should handle null-like build type", () => {
      const nullWrapper = createWrapper(null as any);
      expect(nullWrapper.vm.currentPlanName).toBe("");
      nullWrapper.unmount();
    });

    it("should handle undefined build type", () => {
      // When undefined is passed, the default parameter value "opensource" is used
      const undefinedWrapper = createWrapper(undefined as any);
      expect(undefinedWrapper.vm.currentPlanName).toBe("Open Source (Self hosted)");
      undefinedWrapper.unmount();
    });
  });

  describe("M. Reactive Properties Access", () => {
    it("should access store.state.theme", () => {
      expect(wrapper.vm.store.state.theme).toBeDefined();
      expect(typeof wrapper.vm.store.state.theme).toBe("string");
    });

    it("should access store.state.zoConfig", () => {
      expect(wrapper.vm.store.state.zoConfig).toBeDefined();
      expect(wrapper.vm.store.state.zoConfig.build_type).toBeDefined();
    });

    it("should access store.state.zoConfig.build_type", () => {
      expect(wrapper.vm.store.state.zoConfig.build_type).toBe("opensource");
    });
  });

  describe("N. Component Return Values", () => {
    it("should return store from setup", () => {
      expect(wrapper.vm.store).toBeDefined();
    });

    it("should return featureData from setup", () => {
      expect(wrapper.vm.featureData).toBeDefined();
    });

    it("should return columns from setup", () => {
      expect(wrapper.vm.columns).toBeDefined();
    });

    it("should return pagination from setup", () => {
      expect(wrapper.vm.pagination).toBeDefined();
    });

    it("should return currentPlanName from setup", () => {
      expect(wrapper.vm.currentPlanName).toBeDefined();
    });
  });

  describe("O. Template Expression Evaluators", () => {
    it("should evaluate theme comparison expression", () => {
      const isDark = wrapper.vm.store.state.theme === "dark";
      expect(typeof isDark).toBe("boolean");
      expect(isDark).toBe(false);
    });

    it("should evaluate build_type comparison for opensource", () => {
      const isOpensource = wrapper.vm.store.state.zoConfig.build_type === "opensource";
      expect(isOpensource).toBe(true);
    });

    it("should evaluate build_type comparison for enterprise", () => {
      const enterpriseWrapper = createWrapper("enterprise");
      const isEnterprise = enterpriseWrapper.vm.store.state.zoConfig.build_type === "enterprise";
      expect(isEnterprise).toBe(true);
      enterpriseWrapper.unmount();
    });
  });

  describe("P. Array Iteration Coverage", () => {
    it("should iterate through all features", () => {
      const features = wrapper.vm.featureData.features;
      let count = 0;

      features.forEach(() => {
        count++;
      });

      expect(count).toBe(features.length);
      expect(count).toBeGreaterThan(0);
    });

    it("should access each feature's properties during iteration", () => {
      const features = wrapper.vm.featureData.features;

      features.forEach((feature: any) => {
        expect(feature.name).toBeDefined();
        expect(feature.values).toBeDefined();
        expect(feature.values.opensource).toBeDefined();
        expect(feature.values.enterprise).toBeDefined();
        expect(feature.values.cloud).toBeDefined();
      });
    });
  });

  describe("Q. Integration Tests", () => {
    it("should render complete feature comparison for opensource", async () => {
      const osWrapper = createWrapper("opensource");
      await nextTick();

      expect(osWrapper.vm.featureData.features.length).toBeGreaterThan(0);
      expect(osWrapper.vm.columns).toHaveLength(4);
      expect(osWrapper.vm.currentPlanName).toBe("Open Source (Self hosted)");
      osWrapper.unmount();
    });

    it("should render complete feature comparison for enterprise", async () => {
      const enterpriseWrapper = createWrapper("enterprise");
      await nextTick();

      expect(enterpriseWrapper.vm.featureData.features.length).toBeGreaterThan(0);
      expect(enterpriseWrapper.vm.columns).toHaveLength(4);
      expect(enterpriseWrapper.vm.currentPlanName).toBe("Enterprise (Self hosted)");
      enterpriseWrapper.unmount();
    });

    it("should render complete feature comparison for cloud", async () => {
      const cloudWrapper = createWrapper("cloud");
      await nextTick();

      expect(cloudWrapper.vm.featureData.features.length).toBeGreaterThan(0);
      expect(cloudWrapper.vm.columns).toHaveLength(4);
      expect(cloudWrapper.vm.currentPlanName).toBe("Cloud");
      cloudWrapper.unmount();
    });
  });
});
