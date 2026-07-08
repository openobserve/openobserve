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
import AddAkeylessType from "./AddAkeylessType.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import i18n from "@/locales";
import {
  makeAddCipherKeySchema,
  addCipherKeyDefaults,
  type AddCipherKeyForm,
} from "./AddCipherKey.schema";

// Rebuild the shared schema with the real i18n `t` (default locale = English).
const addCipherKeySchema = makeAddCipherKeySchema((k: string) => i18n.global.t(k));

// AddAkeylessType is presentational: every control is an OForm* field bound (by
// name) to the PARENT OForm; all rules live in AddCipherKey.schema.ts. Mount it
// inside a REAL OForm (store.type === "akeyless") to exercise the wiring.

const akeylessDefaults = (
  mutate: (v: AddCipherKeyForm) => void = () => {},
): AddCipherKeyForm => {
  const v = JSON.parse(
    JSON.stringify(addCipherKeyDefaults()),
  ) as AddCipherKeyForm;
  v.name = "valid-key";
  v.key.store.type = "akeyless";
  v.key.store.akeyless.base_url = "https://api.akeyless.io";
  v.key.store.akeyless.access_id = "p-abc123";
  v.key.store.akeyless.auth.type = "access_key";
  v.key.store.akeyless.auth.access_key = "the-key";
  v.key.store.akeyless.store.type = "static_secret";
  v.key.store.akeyless.store.static_secret = "secret-name";
  mutate(v);
  return v;
};

const Harness = defineComponent({
  components: { OForm, AddAkeylessType },
  props: {
    defaults: { type: Object, required: true },
    isUpdate: { type: Boolean, default: false },
  },
  setup(props) {
    return { schema: addCipherKeySchema, defaultValues: props.defaults };
  },
  template: `
    <OForm :schema="schema" :default-values="defaultValues" @submit="() => {}">
      <AddAkeylessType :is-update="isUpdate" />
    </OForm>
  `,
});

const mountIn = (defaults: AddCipherKeyForm, isUpdate = false) =>
  mount(Harness, {
    props: { defaults, isUpdate },
    global: { plugins: [i18n] },
  });

describe("AddAkeylessType.vue", () => {
  let wrapper: any;

  const form = () => wrapper.findComponent({ name: "OForm" }).vm.form;
  const has = (testId: string) =>
    wrapper.find(`[data-test="${testId}"]`).exists();

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  describe("base fields", () => {
    beforeEach(() => {
      wrapper = mountIn(akeylessDefaults());
    });

    it("renders base URL, access ID, auth method and secret type", () => {
      expect(has("add-cipher-key-akeyless-baseurl-input")).toBe(true);
      expect(has("add-cipher-key-akeyless-access-id-input")).toBe(true);
      expect(has("add-cipher-key-auth-method-input")).toBe(true);
      expect(has("add-cipher-key-secret-type-input")).toBe(true);
    });
  });

  describe("authentication type branches", () => {
    it("shows the access key field for access_key auth", () => {
      wrapper = mountIn(akeylessDefaults((v) => (v.key.store.akeyless.auth.type = "access_key")));
      expect(has("add-cipher-key-akeyless-access-key-input")).toBe(true);
    });

    it("shows LDAP username + password for ldap auth", async () => {
      wrapper = mountIn(akeylessDefaults());
      form().setFieldValue("key.store.akeyless.auth.type", "ldap");
      await nextTick();
      expect(has("add-cipher-key-akeyless-ldap-username-input")).toBe(true);
      expect(has("add-cipher-key-akeyless-ldap-password-input")).toBe(true);
      expect(has("add-cipher-key-akeyless-access-key-input")).toBe(false);
    });
  });

  describe("secret type branches", () => {
    it("shows the static secret field for static_secret", () => {
      wrapper = mountIn(akeylessDefaults());
      expect(has("add-cipher-key-akeyless-static-secret-name-input")).toBe(true);
    });

    it("shows DFC name/iv/encrypted-data for dfc", async () => {
      wrapper = mountIn(akeylessDefaults());
      form().setFieldValue("key.store.akeyless.store.type", "dfc");
      await nextTick();
      expect(has("add-cipher-key-akeyless-dfc-name-input")).toBe(true);
      expect(has("add-cipher-key-akeyless-dfc-iv-input")).toBe(true);
      expect(has("add-cipher-key-akeyless-dfc-encrypted-data-input")).toBe(true);
    });
  });

  describe("update mode (read-only display of existing values)", () => {
    it("shows the access ID display + Update button instead of the input", async () => {
      wrapper = mountIn(akeylessDefaults(), true);
      expect(has("add-cipher-key-akeyless-access-id-input")).toBe(false);
      expect(has("add-cipher-key-akeyless-access-id-input-update")).toBe(true);

      await wrapper
        .find('[data-test="add-cipher-key-akeyless-access-id-input-update"]')
        .trigger("click");
      await nextTick();
      expect(has("add-cipher-key-akeyless-access-id-input")).toBe(true);
    });
  });

  describe("validation (real OForm)", () => {
    it("flags a missing base URL on submit", async () => {
      wrapper = mountIn(akeylessDefaults((v) => (v.key.store.akeyless.base_url = "")));
      await form().handleSubmit();
      expect(form().state.isValid).toBe(false);
      expect(
        (form().getFieldMeta("key.store.akeyless.base_url")?.errors ?? [])
          .length,
      ).toBeGreaterThan(0);
    });

    it("passes validation when all akeyless fields are valid", async () => {
      wrapper = mountIn(akeylessDefaults());
      await form().handleSubmit();
      expect(form().state.isValid).toBe(true);
    });
  });
});
