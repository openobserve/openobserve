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

const { createEnvironment, updateEnvironment, toastMock } = vi.hoisted(() => ({
  createEnvironment: vi.fn(),
  updateEnvironment: vi.fn(),
  toastMock: vi.fn(),
}));
vi.mock("@/services/synthetics", () => ({
  default: { createEnvironment, updateEnvironment },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

import SyntheticsEnvironmentForm from "./SyntheticsEnvironmentForm.vue";
import { makeSyntheticsEnvironmentFormSchema } from "./SyntheticsVariableForm.schema";
import type { SyntheticsEnvironment } from "@/types/synthetics";

const REFUSAL = "name: 'global' is reserved for the environment every org already has";

type Saver = { save: (v: Record<string, unknown>) => Promise<void> };

function env(name: string): SyntheticsEnvironment {
  return {
    id: `id-${name}`,
    name,
    description: "",
    is_global: false,
    created_at: 0,
    updated_at: 0,
    checks_count: 0,
    variables: [],
  };
}

function mountForm(props: Record<string, unknown> = {}) {
  return shallowMount(SyntheticsEnvironmentForm, {
    props: { open: true, ...props },
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

    await (wrapper.vm as unknown as Saver).save({ name: "Global", description: "" });

    expect(createEnvironment).toHaveBeenCalledWith("default", { name: "Global", description: "" });
    expect(toastMock).toHaveBeenCalledWith({ variant: "error", message: REFUSAL });
    expect(wrapper.emitted("update:list")).toBeUndefined();
  });
});

describe("SyntheticsEnvironmentForm — what a save tells the tab", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("emits created with the server's name after a create", async () => {
    // The server owns the stored name, so its answer wins over what was typed.
    createEnvironment.mockResolvedValueOnce({ data: env("staging-1") });
    wrapper = mountForm();

    await (wrapper.vm as unknown as Saver).save({ name: "staging", description: "" });

    expect(wrapper.emitted("update:list")).toHaveLength(1);
    expect(wrapper.emitted("created")).toEqual([["staging-1"]]);
  });

  it.each([{ data: undefined }, { data: {} }])(
    "falls back to the submitted name when the create response carries none (%o)",
    async (response) => {
      createEnvironment.mockResolvedValueOnce(response);
      wrapper = mountForm();

      await (wrapper.vm as unknown as Saver).save({ name: "prod", description: "" });

      expect(wrapper.emitted("created")).toEqual([["prod"]]);
    },
  );

  it("does not emit created after an edit", async () => {
    updateEnvironment.mockResolvedValueOnce({ data: env("staging") });
    wrapper = mountForm({ isEdit: true, data: env("staging") });

    await (wrapper.vm as unknown as Saver).save({ name: "staging", description: "renamed" });

    expect(updateEnvironment).toHaveBeenCalledWith("default", "staging", {
      name: "staging",
      description: "renamed",
    });
    expect(wrapper.emitted("update:list")).toHaveLength(1);
    expect(wrapper.emitted("created")).toBeUndefined();
  });

  it("emits nothing when the create fails", async () => {
    createEnvironment.mockRejectedValueOnce(new Error("boom"));
    wrapper = mountForm();

    await (wrapper.vm as unknown as Saver).save({ name: "staging", description: "" });

    expect(wrapper.emitted("created")).toBeUndefined();
    expect(wrapper.emitted("update:list")).toBeUndefined();
  });
});
