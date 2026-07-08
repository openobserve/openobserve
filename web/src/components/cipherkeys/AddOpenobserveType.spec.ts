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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import AddOpenobserveType from "./AddOpenobserveType.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import i18n from "@/locales";
import {
  makeAddCipherKeySchema,
  addCipherKeyDefaults,
  type AddCipherKeyForm,
} from "./AddCipherKey.schema";

// Rebuild the shared schema with the real i18n `t` (default locale = English).
const addCipherKeySchema = makeAddCipherKeySchema((k: string) => i18n.global.t(k));

// AddOpenobserveType is presentational: its only field (the secret) is hosted by
// the parent schema as `key.store.local`. Mount it inside a REAL OForm so the
// OFormTextarea binds to the actual form by name.

const baseDefaults = (local = ""): AddCipherKeyForm => {
  const v = JSON.parse(
    JSON.stringify(addCipherKeyDefaults()),
  ) as AddCipherKeyForm;
  v.name = "valid-key";
  v.key.store.type = "local";
  v.key.store.local = local;
  return v;
};

const Harness = defineComponent({
  components: { OForm, AddOpenobserveType },
  props: {
    defaults: { type: Object, required: true },
    isUpdate: { type: Boolean, default: false },
  },
  setup(props) {
    return { schema: addCipherKeySchema, defaultValues: props.defaults };
  },
  template: `
    <OForm :schema="schema" :default-values="defaultValues" @submit="() => {}">
      <AddOpenobserveType :is-update="isUpdate" />
    </OForm>
  `,
});

const mountIn = (defaults: AddCipherKeyForm, isUpdate = false) =>
  mount(Harness, {
    props: { defaults, isUpdate },
    global: { plugins: [i18n] },
  });

describe("AddOpenobserveType.vue", () => {
  let wrapper: any;

  const form = () => wrapper.findComponent({ name: "OForm" }).vm.form;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  describe("create mode", () => {
    beforeEach(() => {
      wrapper = mountIn(baseDefaults(""));
    });

    it("renders the editable secret textarea", () => {
      expect(
        wrapper
          .find('[data-test="add-cipher-key-openobserve-secret-input"]')
          .exists(),
      ).toBe(true);
    });

    it("flags a missing secret on submit (store.type === local)", async () => {
      await form().handleSubmit();
      expect(form().state.isValid).toBe(false);
      expect(
        (form().getFieldMeta("key.store.local")?.errors ?? []).length,
      ).toBeGreaterThan(0);
    });

    it("passes validation once a secret is provided", async () => {
      form().setFieldValue("key.store.local", "my-secret");
      await form().handleSubmit();
      expect(form().state.isValid).toBe(true);
    });
  });

  describe("update mode with an existing secret", () => {
    beforeEach(() => {
      wrapper = mountIn(baseDefaults("stored-secret"), true);
    });

    it("shows the read-only display + Update button (not the textarea)", () => {
      expect(
        wrapper
          .find('[data-test="add-cipher-key-openobserve-secret-input"]')
          .exists(),
      ).toBe(false);
      expect(
        wrapper
          .find('[data-test="add-cipher-key-openobserve-secret-input-update"]')
          .exists(),
      ).toBe(true);
    });

    it("reveals the editable textarea after clicking Update", async () => {
      await wrapper
        .find('[data-test="add-cipher-key-openobserve-secret-input-update"]')
        .trigger("click");
      await nextTick();
      expect(
        wrapper
          .find('[data-test="add-cipher-key-openobserve-secret-input"]')
          .exists(),
      ).toBe(true);
    });
  });
});
