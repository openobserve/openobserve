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
  <div class="cipher-keys-add-encryption-mechanism">
    <OSelect
      data-test="add-cipher-key-auth-method-input"
      v-model="frmData.key.mechanism.type"
      :label="t('cipherKey.providerType') + ' *'"
      class="full-width"
      :options="providerTypeOptions"
      labelKey="label"
      valueKey="value"
      :error="providerTypeTouched && !frmData.key.mechanism.type"
      :error-message="t('cipherKey.providerTypeRequired') || 'Provider type is required'"
      @update:model-value="providerTypeTouched = true"
    />

    <OSelect
      v-if="frmData.key.mechanism.type === 'simple'"
      data-test="add-cipher-algorithm-input"
      v-model="frmData.key.mechanism.simple_algorithm"
      :label="t('cipherKey.algorithm') + ' *'"
      class="full-width"
      :options="plainAlgorithmOptions"
      labelKey="label"
      valueKey="value"
      :error="algorithmTouched && !frmData.key.mechanism.simple_algorithm"
      :error-message="t('cipherKey.algorithmRequired') || 'Algorithm is required'"
      @update:model-value="algorithmTouched = true"
    />

  </div>
</template>

<script lang="ts">
import { ref, defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";

export default defineComponent({
  name: "PageAddEncryptionMechanism",
  components: { OSelect },
  props: {
    formData: Object,
  },
  setup(props: any) {
    const { t } = useI18n();
    const frmData = ref(props.formData || {});
    const providerTypeTouched = ref(false);
    const algorithmTouched = ref(false);

    const providerTypeOptions = ref([
      { value: "simple", label: "Simple" },
      { value: "tink_keyset", label: "Tink KeySet" },
    ]);

    const plainAlgorithmOptions = ref([
      { value: "aes-256-siv", label: "AES 256 SIV" },
    ]);

    return {
      t,
      frmData,
      providerTypeTouched,
      algorithmTouched,
      providerTypeOptions,
      plainAlgorithmOptions,
    };
  },
});
</script>

<style lang="scss">
.cipher-keys-add-encryption-mechanism {
  .q-field--labeled.showLabelOnTop .q-field__bottom {
    padding: 0px;
  }  
}
</style>
