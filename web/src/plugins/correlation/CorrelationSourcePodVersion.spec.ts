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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import CorrelationSourcePodVersion from "./CorrelationSourcePodVersion.vue";

describe("CorrelationSourcePodVersion", () => {
  it("names the pod chip like every other Kubernetes dimension, not by its key", () => {
    const wrapper = mount(CorrelationSourcePodVersion, {
      props: { pod: "checkout-7f9", version: "1.2.0" },
      global: { plugins: [i18n] },
    });
    const chips = wrapper.findAllComponents(ODimensionChip);
    expect(chips[0].props("keyLabel")).toBe("K8s Pod");
    expect(wrapper.text()).not.toContain("k8s-pod");
    wrapper.unmount();
  });
});
