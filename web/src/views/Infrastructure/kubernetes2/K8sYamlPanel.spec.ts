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
import { enableAutoUnmount, mount } from "@vue/test-utils";
import i18n from "@/locales";
import { copyToClipboard } from "@/utils/clipboard";
import K8sYamlPanel from "./K8sYamlPanel.vue";

vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn() }));

enableAutoUnmount(afterEach);

const row = (object: unknown) =>
  ({ kind: "pod", cluster: "prod", namespace: "shop", name: "web-1", object }) as any;

const object = {
  metadata: { name: "web-1", namespace: "shop" },
  spec: { nodeName: "n1" },
  status: { phase: "Running" },
};

const mountPanel = (r: unknown) =>
  mount(K8sYamlPanel, { props: { row: r as any }, global: { plugins: [i18n] } });

describe("K8sYamlPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(copyToClipboard).mockResolvedValue(true);
  });

  it("renders a numbered YAML block, the read-only note and a disabled Edit", () => {
    const wrapper = mountPanel(row(object));
    expect(wrapper.find('[data-test="k8s2-yaml-line-numbers"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="k8s2-yaml-pre"]').text()).toContain("name: web-1");
    expect(wrapper.find('[data-test="k8s2-yaml-readonly"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="k8s2-yaml-edit"]').attributes("aria-disabled")).toBe("true");
    expect(wrapper.find('[data-test="k8s2-yaml-unavailable"]').exists()).toBe(false);
  });

  it("copies the YAML text", async () => {
    const wrapper = mountPanel(row(object));
    await wrapper.find('[data-test="k8s2-yaml-copy-btn"]').trigger("click");
    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(copyToClipboard).mock.calls[0][0]).toContain("phase: Running");
  });

  it("shows the unavailable state instead of a code block when the object is missing", () => {
    const wrapper = mountPanel(row(null));
    expect(wrapper.find('[data-test="k8s2-yaml-unavailable"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="k8s2-yaml-pre"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="k8s2-yaml-copy-btn"]').exists()).toBe(false);
  });
});
