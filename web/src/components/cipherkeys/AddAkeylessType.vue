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
  <div class="cipher-keys-add-akeyless-type">
    <!-- Add input filed for base URL, access id with URL validation from OInput-->
    <OInput
      data-test="add-cipher-key-akeyless-baseurl-input"
      v-model="formData.key.store.akeyless.base_url"
      :label="t('cipherKey.baseURL') + ' *'"
      class="showLabelOnTop tw:w-full"
      :error="!!baseUrlError"
      :error-message="baseUrlError"
      @update:model-value="baseUrlError = ''"
    />
    <!-- Add input field for access id with URL validation from OInput -->
    <div v-if="!formData.isUpdate || isUpdateAccessID || formData.key.store.akeyless.access_id == ''">
      <OInput
        data-test="add-cipher-key-akeyless-access-id-input"
        v-model="formData.key.store.akeyless.access_id"
        :label="t('cipherKey.accessId') + ' *'"
        class="showLabelOnTop tw:w-full"
        :error="!!accessIdError"
        :error-message="accessIdError"
        @update:model-value="accessIdError = ''"
      />
      <OButton data-test="add-cipher-key-akeyless-access-id-input-cancel" variant="outline" size="sm-action" class="tw:mt-2" v-if="formData.isUpdate && formData.key.store.akeyless.access_id != ''" @click="isUpdateAccessID = false">{{ t('common.cancel') }}</OButton>
    </div>
    <div v-else>
      <label class="tw:flex q-field tw:mb-3">
        <b>{{ t('cipherKey.accessId') }}</b>
      </label>
      <pre class="pre-text">{{ formData.key.store.akeyless.access_id }}</pre>
      <OButton data-test="add-cipher-key-akeyless-access-id-input-update" variant="primary" size="sm-action" @click="isUpdateAccessID = true">{{ t('common.update') }}</OButton>
    </div>
    <OSelect
      data-test="add-cipher-key-auth-method-input"
      v-model="formData.key.store.akeyless.auth.type"
      :label="t('cipherKey.authenticationType') + ' *'"
      class="showLabelOnTop tw:w-full"
      :options="authenticationTypeOptions"
      labelKey="label"
      valueKey="value"
      :error="!!authTypeError"
      :error-message="authTypeError"
      @update:model-value="authTypeError = ''"
    />
    <fieldset
      class="q-fieldset tw:p-3 tw:w-full"
      v-if="formData.key.store.akeyless.auth.type != ''"
    >
      <legend class="q-caption tw:px-2">
        {{ getAuthenticationTypeLabel(formData.key.store.akeyless.auth.type) }}
        Configuration
      </legend>
      <div v-if="formData.key.store.akeyless.auth.type === 'access_key'">
        <div v-if="!formData.isUpdate || isUpdateAccessKey || formData.key.store.akeyless.auth.access_key == ''">
          <OInput
            data-test="add-cipher-key-akeyless-access-key-input"
            v-model="formData.key.store.akeyless.auth.access_key"
            :label="t('cipherKey.accessKey') + ' *'"
            class="showLabelOnTop tw:w-full"
            :error="!!accessKeyError"
            :error-message="accessKeyError"
            @update:model-value="accessKeyError = ''"
          />
          <OButton data-test="add-cipher-key-akeyless-access-key-input-cancel" variant="outline" size="sm-action" class="tw:mt-2" v-if="formData.isUpdate && formData.key.store.akeyless.auth.access_key != ''" @click="isUpdateAccessKey = false">{{ t('common.cancel') }}</OButton>
        </div>
        <div v-else>
          <label class="tw:flex q-field tw:mb-3">
            <b>{{ t('cipherKey.accessKey') }}</b>
          </label>
          <pre class="pre-text">{{ formData.key.store.akeyless.auth.access_key }}</pre>
          <OButton data-test="add-cipher-key-akeyless-access-key-input-update" variant="primary" size="sm-action" @click="isUpdateAccessKey = true">{{ t('common.update') }}</OButton>
        </div>
      </div>
      <div v-if="formData.key.store.akeyless.auth.type === 'ldap'">
        <div v-if="!formData.isUpdate || isUpdateLDAPUsername || formData.key.store.akeyless.auth.ldap.username == ''">
          <OInput
            data-test="add-cipher-key-akeyless-ldap-username-input"
            v-model="formData.key.store.akeyless.auth.ldap.username"
            :label="t('cipherKey.ldapUsername') + ' *'"
            class="showLabelOnTop tw:w-full"
            :error="!!ldapUsernameError"
            :error-message="ldapUsernameError"
            @update:model-value="ldapUsernameError = ''"
          />
          <OButton data-test="add-cipher-key-akeyless-ldap-username-input-cancel" variant="outline" size="sm-action" class="tw:mt-2" v-if="formData.isUpdate && formData.key.store.akeyless.auth.ldap.username != ''" @click="isUpdateLDAPUsername = false">{{ t('common.cancel') }}</OButton>
        </div>
        <div v-else>
          <label class="tw:flex q-field tw:mb-3">
            <b>{{ t('cipherKey.ldapUsername') }}</b>
          </label>
          <pre class="pre-text">{{ formData.key.store.akeyless.auth.ldap.username }}</pre>
          <OButton data-test="add-cipher-key-akeyless-ldap-username-input-update" variant="primary" size="sm-action" @click="isUpdateLDAPUsername = true">{{ t('common.update') }}</OButton>
        </div>
        <div v-if="!formData.isUpdate || isUpdateLDAPPass || formData.key.store.akeyless.auth.ldap.password == ''">
          <OInput
            data-test="add-cipher-key-akeyless-ldap-password-input"
            v-model="formData.key.store.akeyless.auth.ldap.password"
            :label="t('cipherKey.ldapPassword') + ' *'"
            class="showLabelOnTop tw:w-full"
            type="password"
            autocomplete="new-password"
            :error="!!ldapPasswordError"
            :error-message="ldapPasswordError"
            @update:model-value="ldapPasswordError = ''"
          />
          <OButton data-test="add-cipher-key-akeyless-ldap-password-input-cancel" variant="outline" size="sm-action" class="tw:mt-2" v-if="formData.isUpdate && formData.key.store.akeyless.auth.ldap.password != ''" @click="isUpdateLDAPPass = false">{{ t('common.cancel') }}</OButton>
        </div>
        <div v-else>
          <label class="tw:flex q-field tw:mb-3">
            <b>{{ t('cipherKey.ldapPassword') }}</b>
          </label>
          <pre class="pre-text">{{ formData.key.store.akeyless.auth.ldap.password }}</pre>
          <OButton data-test="add-cipher-key-akeyless-ldap-password-input-update" variant="primary" size="sm-action" @click="isUpdateLDAPPass = true">{{ t('common.update') }}</OButton>
        </div>
      </div>
    </fieldset>
    <OSelect
      data-test="add-cipher-key-secret-type-input"
      v-model="formData.key.store.akeyless.store.type"
      :label="t('cipherKey.secretType') + ' *'"
      class="showLabelOnTop tw:w-full"
      :options="secretTypeOptions"
      labelKey="label"
      valueKey="value"
      :error="!!secretTypeError"
      :error-message="secretTypeError"
      @update:model-value="secretTypeError = ''"
    />
    <fieldset
      class="q-fieldset tw:p-3 tw:w-full"
      v-if="formData.key.store.akeyless.store.type != ''"
    >
      <legend class="q-caption tw:px-2">
        {{ getSecretOptionLabel(formData.key.store.akeyless.store.type) }}
        Configuration
      </legend>
      <div v-if="formData.key.store.akeyless.store.type === 'static_secret'">
        <OInput
          data-test="add-cipher-key-akeyless-static-secret-name-input"
          v-model="formData.key.store.akeyless.store.static_secret"
          :label="t('cipherKey.staticSecretName') + ' *'"
          class="showLabelOnTop tw:w-full"
          :error="!!staticSecretError"
          :error-message="staticSecretError"
          @update:model-value="staticSecretError = ''"
        />
      </div>
      <div v-if="formData.key.store.akeyless.store.type === 'dfc'">
        <OInput
          data-test="add-cipher-key-akeyless-dfc-name-input"
          v-model="formData.key.store.akeyless.store.dfc.name"
          :label="t('cipherKey.dfcName') + ' *'"
          class="showLabelOnTop tw:w-full"
          :error="!!dfcNameError"
          :error-message="dfcNameError"
          @update:model-value="dfcNameError = ''"
        />
        <OInput
          data-test="add-cipher-key-akeyless-dfc-iv-input"
          v-model="formData.key.store.akeyless.store.dfc.iv"
          :label="t('cipherKey.dfcIV')"
          class="showLabelOnTop tw:w-full"
        />
        <OTextarea
          data-test="add-cipher-key-akeyless-dfc-encrypted-data-input"
          v-model="formData.key.store.akeyless.store.dfc.encrypted_data"
          :label="t('cipherKey.dfcEncryptedData') + ' *'"
          class="showLabelOnTop tw:w-full"
          :error="!!dfcEncryptedDataError"
          :error-message="dfcEncryptedDataError"
          @update:model-value="dfcEncryptedDataError = ''"
        />
      </div>
    </fieldset>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { validateUrl } from "@/utils/zincutils";
import OButton from '@/lib/core/Button/OButton.vue';
import OInput from '@/lib/forms/Input/OInput.vue';
import OTextarea from '@/lib/forms/Input/OTextarea.vue';
import OSelect from '@/lib/forms/Select/OSelect.vue';

export interface AkeylessStore {
  store: {
    akeyless: {
      access_id: string;
      base_url: string;
      auth: {
        type: string;
        access_key: string;
        ldap: {
          username: string;
          password: string;
        };
      };
      store: {
        type: string;
        static_secret: string;
        dfc: {
          name: string;
          iv: string;
          encrypted_data: string;
        };
      };
    };
  };
}

export interface FormData {
  name: string;
  key: AkeylessStore;
  provider: Object;
}
export default defineComponent({
  name: "PageAddAkeylessType",
  components: { OButton, OInput, OTextarea, OSelect },
  props: {
    formData: {
      type: Object,
      required: true,
      default: () => ({
        key: {
          store: {
            type: "local",
            akeyless: {
              base_url: "",
              access_id: "",
              auth: {
                type: "access_key",
                access_key: "",
                ldap: {
                  username: "",
                  password: "",
                },
              },
              store: {
                type: "static_secret",
                static_secret: "",
                dfc: {
                  name: "",
                  iv: "",
                  encrypted_data: "",
                },
              },
            },
            local: "",
          },
          mechanism: {
            type: "simple",
            simple_algorithm: "aes-256-siv",
          },
        },
      }),
    },
  },
  setup(props: any, { emit, expose }) {
    const { t } = useI18n();
    const isUpdateLDAPPass = ref(false);
    const isUpdateLDAPUsername = ref(false);
    const isUpdateAccessID = ref(false);
    const isUpdateAccessKey = ref(false);

    // Validation error refs
    const baseUrlError = ref('');
    const accessIdError = ref('');
    const authTypeError = ref('');
    const accessKeyError = ref('');
    const ldapUsernameError = ref('');
    const ldapPasswordError = ref('');
    const secretTypeError = ref('');
    const staticSecretError = ref('');
    const dfcNameError = ref('');
    const dfcEncryptedDataError = ref('');

    const validateAkeylessFields = (): boolean => {
      const akeyless = props.formData.key.store.akeyless;
      baseUrlError.value = !akeyless.base_url ? 'Base URL is required'
        : validateUrl(akeyless.base_url) !== true ? 'Please provide correct URL.'
        : /<[^>]*>/.test(akeyless.base_url) ? 'HTML tags are not allowed'
        : '';
      accessIdError.value = !akeyless.access_id ? 'Access ID is required'
        : !/^[a-zA-Z0-9-]*$/.test(akeyless.access_id) ? 'Access ID should be alphanumeric'
        : '';
      authTypeError.value = !akeyless.auth.type ? 'Authentication type is required' : '';
      secretTypeError.value = !akeyless.store.type ? 'Secret type is required' : '';
      if (akeyless.auth.type === 'access_key') {
        accessKeyError.value = !akeyless.auth.access_key ? 'Access Key is required' : '';
      }
      if (akeyless.auth.type === 'ldap') {
        ldapUsernameError.value = !akeyless.auth.ldap.username ? 'LDAP Username is required'
          : !/^[a-zA-Z0-9._-]+$/.test(akeyless.auth.ldap.username) ? 'Username can only contain alphanumeric characters, dots, underscores, and hyphens'
          : '';
        ldapPasswordError.value = !akeyless.auth.ldap.password ? 'LDAP Password is required' : '';
      }
      if (akeyless.store.type === 'static_secret') {
        staticSecretError.value = !akeyless.store.static_secret ? 'Static Secret Name is required' : '';
      }
      if (akeyless.store.type === 'dfc') {
        dfcNameError.value = !akeyless.store.dfc.name ? 'DFC Name is required' : '';
        dfcEncryptedDataError.value = !akeyless.store.dfc.encrypted_data ? 'DFC Encrypted Data is required' : '';
      }
      return !baseUrlError.value && !accessIdError.value && !authTypeError.value
        && !accessKeyError.value && !ldapUsernameError.value && !ldapPasswordError.value
        && !secretTypeError.value && !staticSecretError.value && !dfcNameError.value
        && !dfcEncryptedDataError.value;
    };

    // Parent (AddCipherKey) calls validate() from its Continue handler so
    // every required Akeyless field surfaces its inline error at once.
    expose({ validate: validateAkeylessFields });

    const authenticationTypeOptions = ref([
      { label: "Access Key", value: "access_key" },
      { label: "LDAP", value: "ldap" },
    ]);
    const secretTypeOptions = ref([
      { label: "Static Secret", value: "static_secret" },
      { label: "DFC", value: "dfc" },
    ]);

    const getSecretOptionLabel = (value: string) => {
      const option = secretTypeOptions.value.find(
        (option) => option.value === value,
      );
      return option ? option.label : "";
    };

    const getAuthenticationTypeLabel = (value: string) => {
      const option = authenticationTypeOptions.value.find(
        (option) => option.value === value,
      );
      return option ? option.label : "";
    };

    return {
      t,
      authenticationTypeOptions,
      secretTypeOptions,
      getSecretOptionLabel,
      getAuthenticationTypeLabel,
      validateUrl,
      isUpdateLDAPPass,
      isUpdateLDAPUsername,
      isUpdateAccessID,
      isUpdateAccessKey,
      baseUrlError,
      accessIdError,
      authTypeError,
      accessKeyError,
      ldapUsernameError,
      ldapPasswordError,
      secretTypeError,
      staticSecretError,
      dfcNameError,
      dfcEncryptedDataError,
      validateAkeylessFields,
    };
  },
});
</script>

<style lang="scss">
.cipher-keys-add-akeyless-type {
  // Small consistent gap between every top-level field (inputs, selects,
  // fieldsets) so they don't render flush against each other.
  > * + * {
    margin-top: 0.5rem;
  }

  .q-field--labeled.showLabelOnTop .q-field__bottom {
    padding: 0px;
  }

  .q-fieldset {
    border: 1px solid lightgray;
    border-radius: 4px;
    position: relative;
  }

  legend {
    font-size: 12px;
    color: var(--q-color-dark);
    margin-left: 8px;
    padding: 0 4px;
  }

  .pre-text {
    text-wrap: auto;
    word-wrap: break-word;
    border: 1px solid #E1E1E1;
    padding: 5px;
    margin-bottom: 5px;
  }
}
</style>
