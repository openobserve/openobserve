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
  <div>
    <!-- Editable branch: a create, the user-chosen edit toggle, or an empty
         stored secret. The textarea is an OForm* control bound to the parent
         OForm by name (`key.store.local`); its required rule lives in
         AddCipherKey.schema.ts (conditional on store.type === "local"). -->
    <div v-if="!isUpdate || showSecretEdit || localValue === ''">
      <OFormTextarea
        data-test="add-cipher-key-openobserve-secret-input"
        name="key.store.local"
        :label="t('cipherKey.secret')"
        required
        class="tw:w-full tw:pb-1"
      />
      <OButton
        data-test="add-cipher-key-openobserve-secret-input-cancel"
        variant="outline"
        size="sm-action"
        class="tw:mt-2"
        v-if="isUpdate && localValue != ''"
        @click="showSecretEdit = false"
      >
        {{ t('common.cancel') }}
      </OButton>
    </div>
    <!-- Read-only display branch (edit mode, secret present, not editing): pure
         UI outside the form (R1) — not an editable field. -->
    <div v-else>
      <label class="tw:flex q-field tw:mb-3">
        <b>{{ t('cipherKey.secret') }}</b>
      </label>
      <pre class="pre-text">{{ localValue }}</pre>
      <OButton
        data-test="add-cipher-key-openobserve-secret-input-update"
        variant="primary"
        size="sm-action"
        @click="showSecretEdit = true"
      >
        {{ t('common.update') }}
      </OButton>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";

export default defineComponent({
  name: "AddOpenobserveType",
  components: { OButton, OFormTextarea },
  props: {
    // Edit-vs-create flag, passed by AddCipherKey. UI display state (drives the
    // read-only/edit branch) — NOT form data.
    isUpdate: {
      type: Boolean,
      default: false,
    },
  },
  setup() {
    const { t } = useI18n();

    // Local toggle for "edit the stored secret" (pure UI). The secret value
    // itself is form-owned — read it reactively from the parent OForm.
    const showSecretEdit = ref(false);

    const form = inject(FORM_CONTEXT_KEY, null);
    const localValue = form
      ? form.useStore((s: any) => s?.values?.key?.store?.local ?? "")
      : computed(() => "");

    return {
      t,
      showSecretEdit,
      localValue,
    };
  },
});
</script>
<style lang="scss" scoped>
.pre-text {
  text-wrap: auto;
  word-wrap: break-word;
  border: 1px solid #E1E1E1;
  padding: 5px;
  margin-bottom: 5px;
}
</style>
