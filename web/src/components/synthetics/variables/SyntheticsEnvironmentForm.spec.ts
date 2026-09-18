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

import { afterEach, describe, expect, it, vi } from "vitest";
import { shallowMount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";

const { createEnvironment, toastMock } = vi.hoisted(() => ({
  createEnvironment: vi.fn(),
  toastMock: vi.fn(),
}));
vi.mock("@/services/synthetics", () => ({
  default: { createEnvironment, updateEnvironment: vi.fn() },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

import SyntheticsEnvironmentForm from "./SyntheticsEnvironmentForm.vue";
import { makeSyntheticsEnvironmentFormSchema } from "./SyntheticsVariableForm.schema";

const REFUSAL = "name: 'global' is reserved for the environment every org already has";

function mountForm() {
  return shallowMount(SyntheticsEnvironmentForm, {
    props: { open: true },
    global: {
      plugins: [i18n],
      provide: { store: { state: { selectedOrganization: { identifier: "default" } } } },
    },
  }) as VueWrapper;
}

describe("SyntheticsEnvironmentForm — the reserved global name", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("lets every casing of global through to the server, which owns the rule", () => {
    const schema = makeSyntheticsEnvironmentFormSchema((key) => key);
    for (const name of ["global", "Global", "GLOBAL"]) {
      expect(schema.safeParse({ name, description: "" }).success).toBe(true);
    }
  });

  it("shows the server's refusal verbatim", async () => {
    createEnvironment.mockRejectedValueOnce({ response: { data: { message: REFUSAL } } });
    wrapper = mountForm();

    await (wrapper.vm as unknown as { save: (v: Record<string, unknown>) => Promise<void> }).save({
      name: "Global",
      description: "",
    });

    expect(createEnvironment).toHaveBeenCalledWith("default", { name: "Global", description: "" });
    expect(toastMock).toHaveBeenCalledWith({ variant: "error", message: REFUSAL });
    expect(wrapper.emitted("update:list")).toBeUndefined();
  });
});
