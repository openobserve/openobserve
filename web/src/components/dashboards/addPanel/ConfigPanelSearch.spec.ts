// Copyright 2026 OpenObserve Inc.
//
// Licensed under the GNU Affero General Public License, Version 3.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.gnu.org/licenses/agpl-3.0.en.html
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import ConfigPanelSearch from "./ConfigPanelSearch.vue";
import i18n from "@/locales";

installQuasar({ plugins: [Notify] });

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("ConfigPanelSearch", () => {
  let wrapper: ReturnType<typeof mount>;

  const mountComponent = (props: Record<string, any> = {}) =>
    mount(ConfigPanelSearch, {
      attachTo: "#app",
      props: {
        modelValue: "",
        ...props,
      },
      global: {
        plugins: [i18n],
      },
    });

  beforeEach(() => {
    wrapper = mountComponent();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  describe("rendering", () => {
    it("renders a q-input element", () => {
      expect(wrapper.find("input").exists()).toBe(true);
    });

    it("renders a search icon", () => {
      // Quasar renders the prepend slot — OIcon with name 'search'
      expect(wrapper.html()).toContain("search");
    });
  });

  // -------------------------------------------------------------------------
  // Props
  // -------------------------------------------------------------------------

  describe("props", () => {
    it("reflects modelValue in the input element", async () => {
      const w = mountComponent({ modelValue: "hello" });
      await flushPromises();
      const input = w.find("input");
      expect((input.element as HTMLInputElement).value).toBe("hello");
      w.unmount();
    });

  });

  // -------------------------------------------------------------------------
  // Emits
  // -------------------------------------------------------------------------

  describe("emits", () => {
    it("emits update:modelValue when input value changes", async () => {
      const input = wrapper.find("input");
      await input.setValue("axis");
      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toContain("axis");
    });

  });
});
