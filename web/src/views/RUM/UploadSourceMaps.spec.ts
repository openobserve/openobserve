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
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { createStore } from "vuex";
import i18n from "@/locales";
import UploadSourceMaps from "./UploadSourceMaps.vue";
import sourcemapsService from "@/services/sourcemaps";

vi.mock("@/services/sourcemaps", () => ({
  default: {
    uploadSourceMaps: vi.fn(),
  },
}));

describe("UploadSourceMaps", () => {
  let store: any;
  let router: any;

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
        selectedOrganization: { identifier: "test-org" },
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", name: "SourceMaps", component: { template: "<div/>" } },
        {
          path: "/upload",
          name: "UploadSourceMaps",
          component: { template: "<div/>" },
        },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mountPage = async (query: Record<string, string> = {}) => {
    await router.push({ path: "/upload", query });
    await router.isReady();
    const wrapper = mount(UploadSourceMaps, {
      global: { plugins: [store, router, i18n] },
    });
    await flushPromises();
    return wrapper;
  };

  const getForm = (w: any) => (w.findComponent({ name: "OForm" }).vm as any).form;

  const submit = async (w: any) => {
    await getForm(w).handleSubmit();
    await flushPromises();
  };

  const zip = () =>
    new File(["sourcemap-content"], "app.js.map.zip", {
      type: "application/zip",
    });

  it("renders the page with the dropzone + native file input", async () => {
    const wrapper = await mountPage();
    expect(wrapper.findComponent({ name: "OForm" }).exists()).toBe(true);
    expect(wrapper.find('[data-test="rum-upload-source-maps-file-dropzone"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rum-upload-source-maps-file-input"]').exists()).toBe(true);
  });

  it("prefills service/version/environment from the route query", async () => {
    const wrapper = await mountPage({
      service: "checkout",
      version: "1.2.3",
      environment: "prod",
    });
    const form = getForm(wrapper);
    expect(form.state.values.service).toBe("checkout");
    expect(form.state.values.version).toBe("1.2.3");
    expect(form.state.values.environment).toBe("prod");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Real-OForm validation wiring (playbook §5 / R22): the Zod schema — not a
  // disabled button — gates an empty submit. Restores the service/version
  // required rules + the `.zip` file rule (was a manual toast).
  describe("OForm schema validation (real form)", () => {
    it("blocks submit + does NOT upload when required fields are empty", async () => {
      const wrapper = await mountPage();
      await submit(wrapper);

      expect(getForm(wrapper).state.isValid).toBe(false);
      expect(sourcemapsService.uploadSourceMaps).not.toHaveBeenCalled();
    });

    it("blocks submit when no file is selected (file required)", async () => {
      const wrapper = await mountPage();
      const form = getForm(wrapper);
      form.setFieldValue("service", "checkout");
      form.setFieldValue("version", "1.0.0");
      await submit(wrapper);

      expect(form.state.isValid).toBe(false);
      expect(sourcemapsService.uploadSourceMaps).not.toHaveBeenCalled();
    });

    it("rejects a non-.zip file (restored .zip rule)", async () => {
      const wrapper = await mountPage();
      const form = getForm(wrapper);
      form.setFieldValue("service", "checkout");
      form.setFieldValue("version", "1.0.0");
      form.setFieldValue("file", new File(["x"], "map.txt", { type: "text/plain" }));
      await submit(wrapper);

      expect(form.state.isValid).toBe(false);
      expect(sourcemapsService.uploadSourceMaps).not.toHaveBeenCalled();
    });

    it("uploads when service, version and a .zip file are provided", async () => {
      (sourcemapsService.uploadSourceMaps as any).mockResolvedValue({
        data: {},
      });
      const pushSpy = vi.spyOn(router, "push");

      const wrapper = await mountPage();
      const form = getForm(wrapper);
      form.setFieldValue("service", "checkout");
      form.setFieldValue("version", "1.0.0");
      form.setFieldValue("environment", "prod");
      form.setFieldValue("file", zip());
      await submit(wrapper);

      expect(form.state.isValid).toBe(true);
      expect(sourcemapsService.uploadSourceMaps).toHaveBeenCalledTimes(1);
      const [orgId, formDataArg] = (sourcemapsService.uploadSourceMaps as any).mock.calls[0];
      expect(orgId).toBe("test-org");
      expect(formDataArg).toBeInstanceOf(FormData);
      expect(formDataArg.get("service")).toBe("checkout");
      expect(formDataArg.get("version")).toBe("1.0.0");
      expect(formDataArg.get("env")).toBe("prod");
      expect(formDataArg.get("file")).toBeInstanceOf(File);

      // Success navigates back to the SourceMaps list.
      expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "SourceMaps" }));
    });

    it("uploads with an empty environment (environment is optional)", async () => {
      (sourcemapsService.uploadSourceMaps as any).mockResolvedValue({
        data: {},
      });

      const wrapper = await mountPage();
      const form = getForm(wrapper);
      form.setFieldValue("service", "checkout");
      form.setFieldValue("version", "1.0.0");
      form.setFieldValue("file", zip());
      await submit(wrapper);

      expect(form.state.isValid).toBe(true);
      expect(sourcemapsService.uploadSourceMaps).toHaveBeenCalledTimes(1);
      const formDataArg = (sourcemapsService.uploadSourceMaps as any).mock.calls[0][1];
      expect(formDataArg.get("env")).toBe("");
    });
  });
});
