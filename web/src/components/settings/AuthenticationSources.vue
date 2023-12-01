<!-- Copyright 2023 Zinc Labs Inc.

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
  <div class="q-mx-md q-my-md">
    <div class="row items-center no-wrap">
      <div class="col">
        <div class="text-h6">{{ t("settings.authSourceLabel") }}</div>
      </div>
    </div>

    <q-separator />
    <div>
      <q-form ref="formRef">
        <div class="row q-gutter-x-sm q-gutter-y-xs q-mb-lg">
          <div class="col-10">
            <q-select
              data-test="authsource-auth-type-select"
              v-model="formData.type"
              :options="authTypes"
              placeholder="Select authentication type"
              :label="t('authenticationSources.type') + ' *'"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop q-py-lg"
              stack-label
              outlined
              filled
              dense
              :rules="[(val: any) => !!val || 'Please select atleast one value.']"
              tabindex="frm0"
            />
          </div>
          <div class="col-5">
            <q-input
              data-test="authsource-name-input"
              v-model="formData.name"
              :label="t('authenticationSources.name') + ' *'"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[(val: any) => !!val || 'Name is required!']"
              tabindex="frm1"
            />
          </div>
          <div class="col-5">
            <q-select
              data-test="authsource-protocol-select"
              v-model="formData.securityProtocol"
              :options="securityProtocolOptions"
              placeholder="Select authentication type"
              :label="t('authenticationSources.protocol') + ' *'"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[(val: any) => !!val || 'Please select atleast one value.']"
              tabindex="frm2"
            />
          </div>

          <div class="col-5">
            <q-input
              data-test="authsource-host-input"
              v-model="formData.host"
              :label="t('authenticationSources.host') + ' *'"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[(val: any) => !!val || 'Host is required!']"
              tabindex="frm3"
            />
          </div>
          <div class="col-5">
            <q-input
              data-test="authsource-port-input"
              v-model="formData.protocol"
              :label="t('authenticationSources.port') + ' *'"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[(val: any) => !!val || 'Port is required!']"
              tabindex="frm4"
            />
          </div>
          <div class="col-5">
            <q-input
              data-test="authsource-usersearch-base-input"
              v-model="formData.userSearchBase"
              :label="t('authenticationSources.userSearchBase') + ' *'"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[(val: any) => !!val || 'User Search Base is required!']"
              tabindex="frm5"
            />
          </div>
          <div class="col-5">
            <q-input
              data-test="authsource-user-filter-input"
              v-model="formData.userFilter"
              :label="t('authenticationSources.userFilter') + ' *'"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[(val: any) => !!val || 'User Filter is required!']"
              tabindex="frm6"
            />
          </div>
          <div class="col-5">
            <q-input
              data-test="authsource-binddn-input"
              v-model="formData.bindDN"
              :label="t('authenticationSources.bindDN')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              tabindex="frm7"
            />
          </div>
          <div class="col-5">
            <q-input
              data-test="authsource-bind-password-input"
              v-model="formData.bindPassword"
              :label="t('authenticationSources.bindPassword')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              tabindex="frm8"
            />
          </div>
          <div class="col-5">
            <q-input
              data-test="authsource-admin-filter-input"
              v-model="formData.adminFilter"
              :label="t('authenticationSources.adminFilter')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              tabindex="frm7"
            />
          </div>
          <div class="col-5">
            <q-input
              data-test="authsource-restricted-filter-input"
              v-model="formData.restrictedFilter"
              :label="t('authenticationSources.restrictedFilter')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              tabindex="frm8"
            />
          </div>
          <div class="col-5">
            <q-input
              data-test="authsource-email-attribute-input"
              v-model="formData.emailAttribute"
              :label="t('authenticationSources.emailAttribute') + ' *'"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[(val: any) => !!val || 'Email attribute is required!']"
              tabindex="frm9"
            />
          </div>
          <div class="col-5">
            <q-input
              data-test="authsource-username-attribute-input"
              v-model="formData.userNameAttribute"
              :label="t('authenticationSources.usernameAttribute')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              tabindex="frm10"
            />
          </div>
          <div class="col-5">
            <q-input
              data-test="authsource-firstname-attribute-input"
              v-model="formData.firstNameAttribute"
              :label="t('authenticationSources.firstnameAttribute')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              tabindex="frm11"
            />
          </div>
          <div class="col-5">
            <q-input
              data-test="authsource-surname-attribute-input"
              v-model="formData.surnameAttribute"
              :label="t('authenticationSources.surnameAttribute')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              tabindex="frm12"
            />
          </div>
          <div class="col-5">
            <q-input
              data-test="authsource-publicssh-attribute-input"
              v-model="formData.publicSSHKeyAttribute"
              :label="t('authenticationSources.sshKeyAttribute')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              tabindex="frm13"
            />
          </div>
          <div class="col-5">
            <q-input
              data-test="authsource-avatar-attribute-input"
              v-model="formData.avatarAttribute"
              :label="t('authenticationSources.avatarAttribute')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              tabindex="frm14"
            />
          </div>
          <div class="col-10 q-mt-lg">
            <q-checkbox
              data-test="authsource-enable-group-input"
              v-model="formData.enableLDAPGroups"
              :label="t('authenticationSources.enableLDAPGroup')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              tabindex="frm15"
            />
          </div>
          <div
            class="col-12 bg-blue-grey-1 rounded-borders q-pa-sm q-mb-lg"
            v-if="formData.enableLDAPGroups"
          >
            <div
              class="row q-gutter-x-sm q-gutter-y-xs q-mb-lg"
              bg-color="input-bg"
            >
              <div class="col-5">
                <q-input
                  data-test="authsource-group-basedn-input"
                  v-model="formData.group.baseDN"
                  :label="t('authenticationSources.groupSearchBaseDN')"
                  color="input-border"
                  bg-color="input-bg"
                  class="showLabelOnTop"
                  stack-label
                  outlined
                  filled
                  dense
                  tabindex="frm16"
                />
              </div>
              <div class="col-5">
                <q-input
                  data-test="authsource-group-userlist-input"
                  v-model="formData.group.userList"
                  :label="t('authenticationSources.groupAttributeUserList')"
                  color="input-border"
                  bg-color="input-bg"
                  class="showLabelOnTop"
                  stack-label
                  outlined
                  filled
                  dense
                  tabindex="frm16"
                />
              </div>
              <div class="col-5">
                <q-input
                  data-test="authsource-group-grouplist-input"
                  v-model="formData.group.groupList"
                  :label="t('authenticationSources.userListedInGroup')"
                  color="input-border"
                  bg-color="input-bg"
                  class="showLabelOnTop"
                  stack-label
                  outlined
                  filled
                  dense
                  tabindex="frm16"
                />
              </div>
              <div class="col-5">
                <q-input
                  data-test="authsource-group-verifygroupmembership-input"
                  v-model="formData.group.verifyGroupMembership"
                  :label="t('authenticationSources.verifyGroupMembership')"
                  color="input-border"
                  bg-color="input-bg"
                  class="showLabelOnTop"
                  stack-label
                  outlined
                  filled
                  dense
                  tabindex="frm16"
                />
              </div>
              <div class="col-5">
                <q-input
                  type="textarea"
                  data-test="authsource-group-mapgroupstoorganization-input"
                  v-model="formData.group.mapGroupsToOrganization"
                  :label="t('authenticationSources.mapLDAPGroup')"
                  color="input-border"
                  bg-color="input-bg"
                  class="showLabelOnTop"
                  stack-label
                  outlined
                  filled
                  dense
                  tabindex="frm16"
                />
              </div>
              <div class="col-8">
                <q-checkbox
                  data-test="authsource-group-flagremoveuser-input"
                  v-model="formData.group.flagRemoveUser"
                  :label="t('authenticationSources.removeUserLDAPGroup')"
                  color="input-border"
                  bg-color="input-bg"
                  class="showLabelOnTop q-mt-lg"
                  stack-label
                  outlined
                  filled
                  dense
                  tabindex="frm16"
                />
              </div>
            </div>
          </div>
          <div class="col-12 q-mt-lg">
            <q-btn
              data-test="add-alert-submit-btn"
              :label="t('common.update')"
              class="text-bold no-border"
              color="secondary"
              padding="sm xl"
              type="button"
              no-caps
              @click="onSubmit"
            />
          </div>
        </div>
      </q-form>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, computed, toRaw } from "vue";

import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";

import authService from "@/services/auth";

const defaultValue: any = () => {
  return {
    type: "",
    name: "",
    securityProtocol: "",
    host: "",
    port: "",
    bindDN: "",
    bindPassword: "",
    userSearchBase: "",
    userFilter: "",
    adminFilter: "",
    restrictedFilter: "",
    userNameAttribute: "",
    firstNameAttribute: "",
    surnameAttribute: "",
    emailAttribute: "",
    publicSSHKeyAttribute: "",
    avatarAttribute: "",
    enableLDAPGroups: false,
    group: {
      baseDN: "",
      userList: "",
      groupList: "",
      verifyGroupMembership: "",
      mapGroupsToOrganization: "",
      flagRemoveUser: false,
    },
  };
};

export default defineComponent({
  name: "AuthenticationSource",
  data() {
    return {
      isValidForm: false,
    };
  },
  setup() {
    const store: any = useStore();
    const formData: any = ref(defaultValue());
    const formRef: any = ref(null);
    const { t } = useI18n();
    const q = useQuasar();
    const beingUpdated = ref(false);
    const authTypes = ref([
      { label: "LDAP", value: "ldap" },
      { label: "Active Directory", value: "ad" },
      { label: "SAML", value: "saml" },
      { label: "OAuth", value: "oauth" },
    ]);

    const securityProtocolOptions = ref([
      { label: "TLS", value: "tls" },
      { label: "StartTLS", value: "starttls" },
    ]);

    onMounted(() => {
      authService
        .getAuthSource()
        .then((res: any) => {
          if (res.status === 200) {
            formData.value = res.data;
          } else {
            q.notify({
              message: "Authentication source fetch failed.",
              color: "negative",
              icon: "warning",
            });
          }
        })
        .catch((err: any) => {
          q.notify({
            message: "Authentication source fetch failed.",
            color: "negative",
            icon: "warning",
          });
        });
    });

    const onSubmit = () => {
      formRef.value.validate().then((valid: any) => {
        if (valid) {
          authService.postAuthSource({ ...formData.value }).then((res: any) => {
            if (res.status === 200) {
              q.notify({
                message: "Authentication source updated successfully.",
                color: "positive",
                icon: "check",
              });
            } else {
              q.notify({
                message: "Authentication source update failed.",
                color: "negative",
                icon: "warning",
              });
            }
          });
        } else {
          q.notify({
            message: "Please fill all the required fields.",
            color: "negative",
            icon: "warning",
          });
        }
      });
    };

    return {
      t,
      q,
      store,
      formRef,
      formData,
      beingUpdated,
      authTypes,
      onSubmit,
      securityProtocolOptions,
    };
  },
});
</script>
