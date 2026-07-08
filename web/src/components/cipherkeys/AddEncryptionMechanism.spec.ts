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
import AddEncryptionMechanism from "./AddEncryptionMechanism.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import i18n from "@/locales";
import {
  makeAddCipherKeySchema,
  addCipherKeyDefaults,
  type AddCipherKeyForm,
} from "./AddCipherKey.schema";

// Rebuild the shared schema with the real i18n `t` (default locale = English).
const addCipherKeySchema = makeAddCipherKeySchema((k: string) => i18n.global.t(k));

// AddEncryptionMechanism is now presentational: it renders OForm* selects bound
// (by name) to the PARENT OForm. So we mount it inside a REAL OForm carrying the
// shared schema — that exercises the actual inject + validation wiring.

const validBase = (): AddCipherKeyForm => {
  const v = JSON.parse(
    JSON.stringify(addCipherKeyDefaults()),
  ) as AddCipherKeyForm;
  v.name = "valid-key";
  v.key.store.type = "local";
  v.key.store.local = "secret";
  return v;
};

const Harness = defineComponent({
  components: { OForm, AddEncryptionMechanism },
  props: { defaults: { type: Object, required: true } },
  setup(props) {
    return { schema: addCipherKeySchema, defaultValues: props.defaults };
  },
  template: `
    <OForm :schema="schema" :default-values="defaultValues" @submit="() => {}">
      <AddEncryptionMechanism />
    </OForm>
  `,
});

const mountIn = (defaults: AddCipherKeyForm) =>
  mount(Harness, {
    props: { defaults },
    global: { plugins: [i18n] },
  });

describe("AddEncryptionMechanism.vue", () => {
  let wrapper: any;

  const form = () => wrapper.findComponent({ name: "OForm" }).vm.form;

  beforeEach(() => {
    wrapper = mountIn(validBase());
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the provider type select", () => {
    expect(
      wrapper.find('[data-test="add-cipher-key-auth-method-input"]').exists(),
    ).toBe(true);
  });

  it("shows the algorithm select when the mechanism type is simple", () => {
    expect(
      wrapper.find('[data-test="add-cipher-algorithm-input"]').exists(),
    ).toBe(true);
  });

  it("hides the algorithm select for a non-simple mechanism", async () => {
    form().setFieldValue("key.mechanism.type", "tink_keyset");
    await nextTick();
    expect(
      wrapper.find('[data-test="add-cipher-algorithm-input"]').exists(),
    ).toBe(false);
  });

  it("flags a missing algorithm on submit when the mechanism is simple", async () => {
    const defaults = validBase();
    defaults.key.mechanism.type = "simple";
    defaults.key.mechanism.simple_algorithm = "";
    wrapper = mountIn(defaults);

    await form().handleSubmit();
    expect(form().state.isValid).toBe(false);
    expect(
      (form().getFieldMeta("key.mechanism.simple_algorithm")?.errors ?? [])
        .length,
    ).toBeGreaterThan(0);
  });

  it("passes validation once the algorithm is provided", async () => {
    await form().handleSubmit();
    expect(form().state.isValid).toBe(true);
  });
});
