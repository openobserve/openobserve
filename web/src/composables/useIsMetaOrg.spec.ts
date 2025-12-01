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

import { describe, expect, it, vi } from "vitest";

// Mock Vuex store
const mockStore = {
  state: {
    selectedOrganization: { 
      label: "regular-org", 
      identifier: "regular-org-id" 
    },
    zoConfig: { 
      meta_org: "meta-organization" 
    },
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

import useIsMetaOrg from "./useIsMetaOrg";

describe("useIsMetaOrg", () => {
  it("should return false when selected org is not meta org", () => {
    mockStore.state.selectedOrganization.label = "regular-org";
    mockStore.state.selectedOrganization.identifier = "regular-org-id";
    mockStore.state.zoConfig.meta_org = "meta-organization";

    const { isMetaOrg } = useIsMetaOrg();

    expect(isMetaOrg.value).toBe(false);
  });

  it("should return false when selected org label matches meta org", () => {
    mockStore.state.selectedOrganization.label = "meta-organization";
    mockStore.state.selectedOrganization.identifier = "regular-org-id";
    mockStore.state.zoConfig.meta_org = "meta-organization";

    const { isMetaOrg } = useIsMetaOrg();

    expect(isMetaOrg.value).toBe(false);
  });

  it("should return true when selected org identifier matches meta org", () => {
    mockStore.state.selectedOrganization.label = "regular-org";
    mockStore.state.selectedOrganization.identifier = "meta-organization";
    mockStore.state.zoConfig.meta_org = "meta-organization";

    const { isMetaOrg } = useIsMetaOrg();

    expect(isMetaOrg.value).toBe(true);
  });

  it("should return true when both label and identifier match meta org", () => {
    mockStore.state.selectedOrganization.label = "meta-organization";
    mockStore.state.selectedOrganization.identifier = "meta-organization";
    mockStore.state.zoConfig.meta_org = "meta-organization";

    const { isMetaOrg } = useIsMetaOrg();

    expect(isMetaOrg.value).toBe(true);
  });

  it("should return false when meta org is empty string", () => {
    mockStore.state.selectedOrganization.label = "regular-org";
    mockStore.state.selectedOrganization.identifier = "regular-org-id";
    mockStore.state.zoConfig.meta_org = "";

    const { isMetaOrg } = useIsMetaOrg();

    expect(isMetaOrg.value).toBe(false);
  });

  it("should return false when meta org is null", () => {
    mockStore.state.selectedOrganization.label = "regular-org";
    mockStore.state.selectedOrganization.identifier = "regular-org-id";
    mockStore.state.zoConfig.meta_org = null;

    const { isMetaOrg } = useIsMetaOrg();

    expect(isMetaOrg.value).toBe(false);
  });

  it("should handle empty selected organization values", () => {
    mockStore.state.selectedOrganization.label = "";
    mockStore.state.selectedOrganization.identifier = "";
    mockStore.state.zoConfig.meta_org = "meta-organization";

    const { isMetaOrg } = useIsMetaOrg();

    expect(isMetaOrg.value).toBe(false);
  });

  it("should return expected composable structure", () => {
    const composable = useIsMetaOrg();

    expect(composable.isMetaOrg).toHaveProperty("value");
    expect(typeof composable.isMetaOrg.value).toBe("boolean");
  });

  it("should create independent instances", () => {
    const composable1 = useIsMetaOrg();
    const composable2 = useIsMetaOrg();

    expect(composable1).not.toBe(composable2);
    expect(composable1.isMetaOrg).toHaveProperty("value");
    expect(composable2.isMetaOrg).toHaveProperty("value");
  });
});