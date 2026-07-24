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
  <div class="cipher-keys-add-akeyless-type space-y-2">
    <!-- Every editable control is an OForm* field bound to the parent OForm (in
         AddCipherKey.vue) by `name`; all rules (URL/HTML/regex + the conditional
         requireds) live in AddCipherKey.schema.ts. No manual error refs, no
         validate() — the parent schema gates the whole form on submit. -->
    <OFormInput
      data-test="add-cipher-key-akeyless-baseurl-input"
      name="key.store.akeyless.base_url"
      :label="t('cipherKey.baseURL')"
      required
      class="showLabelOnTop w-full"
    />
    <!-- Access ID: editable on create / when toggled / when empty; otherwise a
         read-only display with an Update toggle (pure UI). -->
    <div v-if="!isUpdate || isUpdateAccessID || accessId == ''">
      <OFormInput
        data-test="add-cipher-key-akeyless-access-id-input"
        name="key.store.akeyless.access_id"
        :label="t('cipherKey.accessId')"
        required
        class="showLabelOnTop w-full"
      />
      <OButton
        data-test="add-cipher-key-akeyless-access-id-input-cancel"
        variant="outline"
        size="sm-action"
        class="mt-2"
        v-if="isUpdate && accessId != ''"
        @click="isUpdateAccessID = false"
        >{{ t("common.cancel") }}</OButton
      >
    </div>
    <div v-else>
      <label class="mb-3 flex">
        <b>{{ t("cipherKey.accessId") }}</b>
      </label>
      <pre class="border-input-border mb-1.25 border p-1.25 [text-wrap:auto] break-words">{{
        accessId
      }}</pre>
      <OButton
        data-test="add-cipher-key-akeyless-access-id-input-update"
        variant="primary"
        size="sm-action"
        @click="isUpdateAccessID = true"
        >{{ t("common.update") }}</OButton
      >
    </div>
    <OFormSelect
      data-test="add-cipher-key-auth-method-input"
      name="key.store.akeyless.auth.type"
      :label="t('cipherKey.authenticationType')"
      required
      class="showLabelOnTop w-full"
      :options="authenticationTypeOptions"
      labelKey="label"
      valueKey="value"
    />
    <fieldset
      class="rounded-default relative w-full border border-[lightgray] p-3"
      v-if="authType != ''"
    >
      <legend class="text-text-heading ml-2 px-1 px-2 py-0 text-xs">
        {{ getAuthenticationTypeLabel(authType) }}
        Configuration
      </legend>
      <div v-if="authType === 'access_key'">
        <div v-if="!isUpdate || isUpdateAccessKey || accessKey == ''">
          <OFormInput
            data-test="add-cipher-key-akeyless-access-key-input"
            name="key.store.akeyless.auth.access_key"
            :label="t('cipherKey.accessKey')"
            required
            class="showLabelOnTop w-full"
          />
          <OButton
            data-test="add-cipher-key-akeyless-access-key-input-cancel"
            variant="outline"
            size="sm-action"
            class="mt-2"
            v-if="isUpdate && accessKey != ''"
            @click="isUpdateAccessKey = false"
            >{{ t("common.cancel") }}</OButton
          >
        </div>
        <div v-else>
          <label class="mb-3 flex">
            <b>{{ t("cipherKey.accessKey") }}</b>
          </label>
          <pre class="border-input-border mb-1.25 border p-1.25 [text-wrap:auto] break-words">{{
            accessKey
          }}</pre>
          <OButton
            data-test="add-cipher-key-akeyless-access-key-input-update"
            variant="primary"
            size="sm-action"
            @click="isUpdateAccessKey = true"
            >{{ t("common.update") }}</OButton
          >
        </div>
      </div>
      <div v-if="authType === 'ldap'">
        <div v-if="!isUpdate || isUpdateLDAPUsername || ldapUsername == ''">
          <OFormInput
            data-test="add-cipher-key-akeyless-ldap-username-input"
            name="key.store.akeyless.auth.ldap.username"
            :label="t('cipherKey.ldapUsername')"
            required
            class="showLabelOnTop w-full"
          />
          <OButton
            data-test="add-cipher-key-akeyless-ldap-username-input-cancel"
            variant="outline"
            size="sm-action"
            class="mt-2"
            v-if="isUpdate && ldapUsername != ''"
            @click="isUpdateLDAPUsername = false"
            >{{ t("common.cancel") }}</OButton
          >
        </div>
        <div v-else>
          <label class="mb-3 flex">
            <b>{{ t("cipherKey.ldapUsername") }}</b>
          </label>
          <pre class="border-input-border mb-1.25 border p-1.25 [text-wrap:auto] break-words">{{
            ldapUsername
          }}</pre>
          <OButton
            data-test="add-cipher-key-akeyless-ldap-username-input-update"
            variant="primary"
            size="sm-action"
            @click="isUpdateLDAPUsername = true"
            >{{ t("common.update") }}</OButton
          >
        </div>
        <div v-if="!isUpdate || isUpdateLDAPPass || ldapPassword == ''">
          <OFormInput
            data-test="add-cipher-key-akeyless-ldap-password-input"
            name="key.store.akeyless.auth.ldap.password"
            :label="t('cipherKey.ldapPassword')"
            required
            class="showLabelOnTop w-full"
            type="password"
            autocomplete="new-password"
          />
          <OButton
            data-test="add-cipher-key-akeyless-ldap-password-input-cancel"
            variant="outline"
            size="sm-action"
            class="mt-2"
            v-if="isUpdate && ldapPassword != ''"
            @click="isUpdateLDAPPass = false"
            >{{ t("common.cancel") }}</OButton
          >
        </div>
        <div v-else>
          <label class="mb-3 flex">
            <b>{{ t("cipherKey.ldapPassword") }}</b>
          </label>
          <pre class="border-input-border mb-1.25 border p-1.25 [text-wrap:auto] break-words">{{
            ldapPassword
          }}</pre>
          <OButton
            data-test="add-cipher-key-akeyless-ldap-password-input-update"
            variant="primary"
            size="sm-action"
            @click="isUpdateLDAPPass = true"
            >{{ t("common.update") }}</OButton
          >
        </div>
      </div>
    </fieldset>
    <OFormSelect
      data-test="add-cipher-key-secret-type-input"
      name="key.store.akeyless.store.type"
      :label="t('cipherKey.secretType')"
      required
      class="showLabelOnTop w-full"
      :options="secretTypeOptions"
      labelKey="label"
      valueKey="value"
    />
    <fieldset
      class="rounded-default relative w-full border border-[lightgray] p-3"
      v-if="secretType != ''"
    >
      <legend class="text-text-heading ml-2 px-1 px-2 py-0 text-xs">
        {{ getSecretOptionLabel(secretType) }}
        Configuration
      </legend>
      <div v-if="secretType === 'static_secret'">
        <OFormInput
          data-test="add-cipher-key-akeyless-static-secret-name-input"
          name="key.store.akeyless.store.static_secret"
          :label="t('cipherKey.staticSecretName')"
          required
          class="showLabelOnTop w-full"
        />
      </div>
      <div v-if="secretType === 'dfc'">
        <OFormInput
          data-test="add-cipher-key-akeyless-dfc-name-input"
          name="key.store.akeyless.store.dfc.name"
          :label="t('cipherKey.dfcName')"
          required
          class="showLabelOnTop w-full"
        />
        <OFormInput
          data-test="add-cipher-key-akeyless-dfc-iv-input"
          name="key.store.akeyless.store.dfc.iv"
          :label="t('cipherKey.dfcIV')"
          class="showLabelOnTop w-full"
        />
        <OFormTextarea
          data-test="add-cipher-key-akeyless-dfc-encrypted-data-input"
          name="key.store.akeyless.store.dfc.encrypted_data"
          :label="t('cipherKey.dfcEncryptedData')"
          required
          class="showLabelOnTop w-full"
        />
      </div>
    </fieldset>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";

export default defineComponent({
  name: "PageAddAkeylessType",
  components: { OButton, OFormInput, OFormTextarea, OFormSelect },
  props: {
    // Edit-vs-create flag from AddCipherKey. UI display state (drives the
    // read-only/edit branches for the secret fields) — NOT form data.
    isUpdate: {
      type: Boolean,
      default: false,
    },
  },
  setup() {
    const { t } = useI18n();

    // Local "edit the stored value" toggles (pure UI).
    const isUpdateLDAPPass = ref(false);
    const isUpdateLDAPUsername = ref(false);
    const isUpdateAccessID = ref(false);
    const isUpdateAccessKey = ref(false);

    // Form-owned values read reactively from the parent OForm (drive conditional
    // display + the read-only/edit branches). `useStore` keeps them reactive.
    const form = inject(FORM_CONTEXT_KEY, null);
    const select = <T,>(fn: (_s: any) => T, fallback: T) =>
      form ? form.useStore((s: any) => fn(s) ?? fallback) : computed(() => fallback);

    const accessId = select((s) => s?.values?.key?.store?.akeyless?.access_id, "");
    const authType = select((s) => s?.values?.key?.store?.akeyless?.auth?.type, "");
    const accessKey = select((s) => s?.values?.key?.store?.akeyless?.auth?.access_key, "");
    const ldapUsername = select((s) => s?.values?.key?.store?.akeyless?.auth?.ldap?.username, "");
    const ldapPassword = select((s) => s?.values?.key?.store?.akeyless?.auth?.ldap?.password, "");
    const secretType = select((s) => s?.values?.key?.store?.akeyless?.store?.type, "");

    const authenticationTypeOptions = [
      { label: "Access Key", value: "access_key" },
      { label: "LDAP", value: "ldap" },
    ];
    const secretTypeOptions = [
      { label: "Static Secret", value: "static_secret" },
      { label: "DFC", value: "dfc" },
    ];

    const getSecretOptionLabel = (value: string) =>
      secretTypeOptions.find((option) => option.value === value)?.label ?? "";

    const getAuthenticationTypeLabel = (value: string) =>
      authenticationTypeOptions.find((option) => option.value === value)?.label ?? "";

    return {
      t,
      authenticationTypeOptions,
      secretTypeOptions,
      getSecretOptionLabel,
      getAuthenticationTypeLabel,
      isUpdateLDAPPass,
      isUpdateLDAPUsername,
      isUpdateAccessID,
      isUpdateAccessKey,
      accessId,
      authType,
      accessKey,
      ldapUsername,
      ldapPassword,
      secretType,
    };
  },
});
</script>
