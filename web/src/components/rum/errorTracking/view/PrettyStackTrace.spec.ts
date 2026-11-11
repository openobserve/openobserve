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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import PrettyStackTrace from "@/components/rum/errorTracking/view/PrettyStackTrace.vue";
import sourcemapsService from "@/services/sourcemaps";
import i18n from "@/locales";

const { translateStackTrace } = vi.hoisted(() => ({ translateStackTrace: vi.fn() }));

vi.mock("@/services/sourcemaps", () => ({
  default: { translateStackTrace },
}));

vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuex")>()),
  useStore: () => ({ state: { selectedOrganization: { identifier: "default" } } }),
}));

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const UNAVAILABLE = '[data-test="rum-pretty-stack-trace-unavailable"]';
const MOBILE = '[data-test="rum-pretty-stack-trace-mobile-unsupported"]';

const nullFrames = {
  data: { stacktrace: [{ error: "boom", stack: [{ line: "a", source_info: null }] }] },
};

function mountPretty(source: string) {
  return mount(PrettyStackTrace, {
    props: {
      error_stack: [
        `Fatal error on ${source}`,
        "2 MyApp 0x0000000102a10a08 0x0000000102a0c000 + 18952",
      ],
      error: { source, service: "my-app", version: "1.0.0" },
    },
    global: {
      plugins: [i18n],
      stubs: {
        OButton: { template: "<button><slot /></button>" },
        OIcon: { template: "<i />" },
        OSpinner: { template: "<i />" },
        CodeQueryEditor: { template: "<div />" },
      },
    },
  });
}

describe("PrettyStackTrace mobile sources", () => {
  beforeEach(() => {
    translateStackTrace.mockReset();
    translateStackTrace.mockResolvedValue(nullFrames);
    sessionStorage.clear();
    localStorage.clear();
  });

  it.each(["ios", "android"])(
    "shows the mobile message and no upload prompt for %s errors",
    async (source) => {
      const wrapper = mountPretty(source);
      await flushPromises();

      expect(wrapper.find(MOBILE).exists()).toBe(true);
      expect(wrapper.find(UNAVAILABLE).exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Upload Source Maps");
    },
  );

  it.each(["ios", "android"])("does not call the translate API for %s errors", async (source) => {
    mountPretty(source);
    await flushPromises();

    expect(sourcemapsService.translateStackTrace).not.toHaveBeenCalled();
  });

  it("still skips the translate API when a mobile error_stack changes", async () => {
    const wrapper = mountPretty("android");
    await flushPromises();

    await wrapper.setProps({ error_stack: ["java.lang.Error: other", "\tat a.B.c(B.java:1)"] });
    await flushPromises();

    expect(wrapper.find(MOBILE).exists()).toBe(true);
    expect(sourcemapsService.translateStackTrace).not.toHaveBeenCalled();
  });

  it("keeps the upload prompt for browser errors with no source maps", async () => {
    const wrapper = mountPretty("browser");
    await flushPromises();

    expect(wrapper.find(UNAVAILABLE).exists()).toBe(true);
    expect(wrapper.find(MOBILE).exists()).toBe(false);
    expect(sourcemapsService.translateStackTrace).toHaveBeenCalledTimes(1);
  });
});
