<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->
<template>
  <div class="cipher-keys-add-encryption-mechanism flex flex-col gap-y-2">
    <!-- Both selects are OForm* controls connected to the parent OForm (in
         AddCipherKey.vue) by `name`; their rules live in AddCipherKey.schema.ts.
         No manual error/touched refs, no validate() — the parent schema gates. -->
    <OFormSelect
      data-test="add-cipher-key-auth-method-input"
      name="key.mechanism.type"
      :label="t('cipherKey.providerType')"
      required
      class="w-full"
      :options="providerTypeOptions"
      labelKey="label"
      valueKey="value"
      tabindex="0"
    />

    <OFormSelect
      v-if="mechanismType === 'simple'"
      data-test="add-cipher-algorithm-input"
      name="key.mechanism.simple_algorithm"
      :label="t('cipherKey.algorithm')"
      required
      class="w-full"
      :options="plainAlgorithmOptions"
      labelKey="label"
      valueKey="value"
      tabindex="0"
    />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, inject } from "vue";
import { useI18n } from "vue-i18n";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";

export default defineComponent({
  name: "PageAddEncryptionMechanism",
  components: { OFormSelect },
  setup() {
    const { t } = useI18n();

    // Read the (form-owned) mechanism type reactively from the parent OForm so
    // the conditional algorithm select shows/hides as it changes. `useStore`
    // (NOT a snapshot of form.state.values) keeps the computed reactive.
    const form = inject(FORM_CONTEXT_KEY, null);
    const mechanismType = form
      ? form.useStore((s: any) => s?.values?.key?.mechanism?.type)
      : computed(() => "simple");

    const providerTypeOptions = [
      { value: "simple", label: "Simple" },
      { value: "tink_keyset", label: "Tink KeySet" },
    ];

    const plainAlgorithmOptions = [{ value: "aes-256-siv", label: "AES 256 SIV" }];

    return {
      t,
      mechanismType,
      providerTypeOptions,
      plainAlgorithmOptions,
    };
  },
});
</script>

