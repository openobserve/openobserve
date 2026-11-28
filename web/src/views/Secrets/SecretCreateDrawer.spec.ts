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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import SecretCreateDrawer from "./SecretCreateDrawer.vue";
import secrets from "@/services/secrets";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { createDefaults } from "./SecretForms.schema";

vi.mock("@/services/secrets", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, default: { create: vi.fn() } };
});

describe("SecretCreateDrawer", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it.each([
    ["saved", () => Promise.resolve({ data: { id: "s1" } })],
    ["refused", () => Promise.reject(new Error("refused"))],
  ])("keeps no submitted value in the mutation cache once %s", async (_label, reply) => {
    vi.mocked(secrets.create).mockImplementation(reply as any);
    const w: any = mount(SecretCreateDrawer, {
      props: { kind: "secret", fgaOn: false },
      global: { plugins: [i18n, store, router], provide: { store } },
    });
    await flushPromises();
    await w.vm.$.setupState.onSubmit({
      ...createDefaults("secret"),
      name: "PD_KEY",
      value: "cr3ate-s3cret",
    });
    await flushPromises();
    expect(secrets.create).toHaveBeenCalled();
    const cached = queryClient
      .getMutationCache()
      .getAll()
      .map((m) => m.state);
    expect(JSON.stringify(cached)).not.toContain("cr3ate-s3cret");
    w.unmount();
  });
});
