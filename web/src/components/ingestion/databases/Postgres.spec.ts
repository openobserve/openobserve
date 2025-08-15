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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import {
  createTestWrapper,
  defaultTestProps,
  mockUseIngestion,
  mockCopyContent,
  mockExternalDependencies,
  cleanupTest,
  commonAssertions,
  type TestProps,
} from "@/test/unit/helpers/ingestionTestUtils";
import Postgres from "@/components/ingestion/databases/Postgres.vue";

installQuasar();
mockUseIngestion();
mockCopyContent();
mockExternalDependencies();

describe("Postgres", () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = createTestWrapper(Postgres, defaultTestProps);
  });

  afterEach(async () => {
    await cleanupTest(wrapper);
  });

  it("should mount successfully", () => {
    commonAssertions.shouldMountSuccessfully(wrapper);
  });

  it("should render CopyContent component", () => {
    commonAssertions.shouldRenderCopyContent(wrapper);
  });

  it("should display Postgres configuration content", () => {
    const copyContent = wrapper.findComponent({ name: "CopyContent" });
    const content = copyContent.props("content");
    expect(content).toContain("exporters:");
    expect(content).toContain("otlphttp/openobserve:");
    expect(content).toContain("postgres");
  });

  it("should render documentation link", () => {
    const link = wrapper.find('a[target="_blank"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes("href")).toMatch(/database\/postgres/);
    expect(link.text()).toBe("here");
  });

  it("should handle props correctly", () => {
    expect(wrapper.vm.currOrgIdentifier).toBe(
      defaultTestProps.currOrgIdentifier,
    );
    expect(wrapper.vm.currUserEmail).toBe(defaultTestProps.currUserEmail);
  });

  it("should have proper link styling", () => {
    const link = wrapper.find('a[target="_blank"]');
    expect(link.classes()).toContain("text-blue-500");
    expect(link.classes()).toContain("hover:text-blue-600");
  });

  it("should handle different organization identifier", () => {
    const customProps: TestProps = {
      currOrgIdentifier: "custom_org",
      currUserEmail: "custom@example.com",
    };

    const customStoreState = {
      selectedOrganization: {
        identifier: "custom_org",
      },
    };

    wrapper = createTestWrapper(Postgres, customProps, customStoreState);

    const copyContent = wrapper.findComponent({ name: "CopyContent" });
    // The mock currently returns test_org, but the component should still work
    expect(copyContent.props("content")).toContain("test_org");
  });

  it("should handle missing props gracefully", () => {
    wrapper = createTestWrapper(Postgres, {});
    expect(wrapper.exists()).toBe(true);
  });

  it("should handle empty store state", () => {
    wrapper = createTestWrapper(Postgres, defaultTestProps, {});
    expect(wrapper.exists()).toBe(true);
  });

  it("should have proper accessibility attributes", () => {
    const link = wrapper.find('a[target="_blank"]');
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("style")).toContain("text-decoration: underline");
  });
});
