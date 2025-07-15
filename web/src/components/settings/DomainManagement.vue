<!-- Copyright 2025 OpenObserve Inc.

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
  <div class="q-px-md q-py-md domain_management">
    <div class="text-h6 text-bold q-mb-xs">
      {{ t("settings.ssoDomainRestrictions") }}
    </div>
    <div class="text-body2 text-grey-7 q-mb-lg">
      {{ t("settings.ssoDomainRestrictionsDescription") }}
    </div>

    <!-- Domain Input Section -->
    <div class="q-mb-xs">
      <div class="text-body1 text-bold q-mb-md">
        {{ t("settings.domainAndAllowedUsers") }}
      </div>
      
      <div class="row q-gutter-md items-center q-mb-md">
        <div class="col-auto">
          <q-input
            v-model="newDomain"
            :label="t('settings.domainPlaceholder')"
            :hint="t('settings.domainHint', { 'at_sign': '@' })"
            color="input-border"
            bg-color="input-bg"
            class="domain-input"
            outlined
            dense
            @keydown.enter="addDomain"
            :rules="[
              (val) => isValidDomain(val) || t('settings.invalidDomain')
            ]"
          />
        </div>
        <div class="col-auto q-my-none">
          <q-btn
            :label="t('settings.addDomain')"
            color="primary"
            class="text-bold text-capitalize no-border"
            @click="addDomain"
            :disabled="!newDomain || !isValidDomain(newDomain)"
            unelevated
          />
        </div>
      </div>

      <div class="text-caption text-grey-6 q-mb-md" v-if="domains.length > 0">
        {{ t("settings.domainConfiguredCount", { count: domains.length }) }}
      </div>
    </div>

    <!-- Domain List -->
    <div v-if="domains.length > 0" class="q-mb-lg">
      <div 
        v-for="(domain, index) in domains" 
        :key="domain.name"
        class="domain-card q-mb-xs"
      >
        <div class="domain-header row items-center justify-between q-px-md q-py-sm">
          <div class="text-body1 text-bold">{{ domain.name }}</div>
          <q-btn
            icon="close"
            flat
            round
            dense
            color="negative"
            @click="removeDomain(index)"
            :title="t('common.delete')"
          />
        </div>

        <div class="q-pa-md">
          <!-- Radio Button Options -->
          <div class="q-mb-xs">
            <q-radio
              v-model="domain.allowAllUsers"
              :val="true"
              :label="t('settings.allowAllUsersFromDomain', { domain: '@'+domain.name })"
              color="primary"
            />
          </div>
          
          <div class="q-mb-md">
            <q-radio
              v-model="domain.allowAllUsers"
              :val="false"
              :label="t('settings.allowOnlySpecificUsers', { domain: '@'+domain.name })"
              color="primary"
            />
          </div>

          <!-- Info message for all users -->
          <div 
            v-if="domain.allowAllUsers"
            class="q-pa-sm bg-blue-1 text-blue-8 rounded-borders q-mb-md"
          >
            {{ t("settings.allUsersAllowedMessage", { domain: '@'+domain.name }) }}
          </div>

          <!-- Specific users section -->
          <div v-if="!domain.allowAllUsers" class="specific-users-section">
            <div class="row q-gutter-md items-center q-mb-md">
              <div class="col">
                <q-input
                  v-model="domain.newEmail"
                  :label="t('settings.emailPlaceholder', { domain: '@' + domain.name })"
                  color="input-border"
                  bg-color="input-bg"
                  class="email-input"
                  outlined
                  dense
                  @keydown.enter="addEmail(domain)"
                  :rules="[
                    (val) => !val || isValidEmail(val, domain.name) || t('settings.invalidEmail')
                  ]"
                />
              </div>
              <div class="col-auto q-my-none">
                <q-btn
                  :label="t('settings.addEmail')"
                  color="secondary"
                  class="text-bold text-capitalize no-border"
                  @click="addEmail(domain)"
                  :disabled="!domain.newEmail || !isValidEmail(domain.newEmail, domain.name)"
                  unelevated
                  dense
                />
              </div>
            </div>

            <!-- Email List -->
            <div v-if="domain.allowedEmails && domain.allowedEmails.length > 0">
              <div 
                v-for="(email, emailIndex) in domain.allowedEmails"
                :key="email"
                class="email-item row items-center justify-between q-pa-sm q-mb-xs"
              >
                <div class="text-body2">{{ email }}</div>
                <q-btn
                  icon="close"
                  flat
                  round
                  dense
                  size="sm"
                  color="negative"
                  @click="removeEmail(domain, emailIndex)"
                  :title="t('common.delete')"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="text-h6 text-grey-6 q-mt-md q-mb-lg tw-w-full text-center q-pa-lg domain-card">
      {{ t("settings.noDomainMessage") }}
    </div>

    <!-- Action Buttons -->
    <div class="row q-gutter-md">
      <q-btn
        :label="t('common.cancel')"
        class="text-bold text-capitalize no-border"
        flat
        color="grey-7"
        @click="resetForm"
      />
      <q-btn
        :label="t('settings.saveChanges')"
        color="secondary"
        class="text-bold text-capitalize no-border"
        unelevated
        @click="saveChanges"
        :loading="saving"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onActivated } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import domainManagement from "@/services/domainManagement";
import { useRouter } from "vue-router";
import { add } from "date-fns";

interface Domain {
  name: string;
  allowAllUsers: boolean;
  allowedEmails: string[];
  newEmail: string;
}

const { t } = useI18n();
const q = useQuasar();
const store = useStore();
const router = useRouter();

const newDomain = ref("");
const domains = reactive<Domain[]>([]);
const saving = ref(false);

const emit = defineEmits(["cancel", "saved"]);

onMounted(() => {
  if(store.state.zoConfig.meta_org == store.state.selectedOrganization.identifier) {
    loadDomainSettings();
  } else {
    router.replace({
      name: "general",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
    })
  }
});

onActivated(() => {
  if(store.state.zoConfig.meta_org == store.state.selectedOrganization.identifier) {
    loadDomainSettings();
  } else {
    router.replace({
      name: "general",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
    })
  }
});

const loadDomainSettings = async () => {
  try {
    const response = await domainManagement.getDomainRestrictions(store.state.zoConfig.meta_org);
    
    if (response.data && response.data.domains) {
      const loadedDomains = response.data.domains.map((domain: any) => ({
        name: domain.domain,
        allowAllUsers: domain.allow_all_users,
        allowedEmails: domain.allowed_emails || []
      }));
      domains.splice(0, domains.length, ...loadedDomains);
    }
  } catch (error: any) {
    // If the API doesn't exist yet or returns an error, use example data
    console.warn("Domain restrictions API not available, using example data:", error);
    
    const existingDomains = [];
    
    domains.splice(0, domains.length, ...existingDomains);
  }
};

const isValidDomain = (domain: string): boolean => {
  if (!domain) return true;
  // Basic domain validation - can be enhanced
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.([a-zA-Z]{2,}\.?)+$/;
  return domainRegex.test(domain);
};

const isValidEmail = (email: string, domain: string): boolean => {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return false;
  
  // Check if email belongs to the domain
  return email.toLowerCase().endsWith(`@${domain.toLowerCase()}`);
};

const addDomain = () => {
  if (!newDomain.value || !isValidDomain(newDomain.value)) return;
  
  // Check if domain already exists
  if (domains.some(d => d.name.toLowerCase() === newDomain.value.toLowerCase())) {
    q.notify({
      type: "negative",
      message: t("settings.domainAlreadyExists"),
      timeout: 3000,
    });
    return;
  }

  domains.push({
    name: newDomain.value,
    allowAllUsers: true,
    allowedEmails: [],
    newEmail: ""
  });

  newDomain.value = "";

  // q.notify({
  //   type: "positive",
  //   message: t("settings.domainAdded"),
  //   timeout: 3000,
  // });
};

const removeDomain = (index: number) => {
  q.dialog({
    title: t("common.confirm"),
    message: t("settings.confirmRemoveDomain", { domain: domains[index].name }),
    cancel: true,
    persistent: true,
  }).onOk(() => {
    domains.splice(index, 1);
    q.notify({
      type: "positive",
      message: t("settings.domainRemoved"),
      timeout: 3000,
    });
  });
};

const addEmail = (domain: Domain) => {
  if (!domain.newEmail || !isValidEmail(domain.newEmail, domain.name)) return;

  // Check if email already exists
  if (domain.allowedEmails.includes(domain.newEmail.toLowerCase())) {
    q.notify({
      type: "negative",
      message: t("settings.emailAlreadyExists"),
      timeout: 3000,
    });
    return;
  }

  domain.allowedEmails.push(domain.newEmail.toLowerCase());
  domain.newEmail = "";

  q.notify({
    type: "positive",
    message: t("settings.emailAdded"),
    timeout: 3000,
  });
};

const removeEmail = (domain: Domain, emailIndex: number) => {
  q.dialog({
    title: t("common.confirm"),
    message: t("settings.confirmRemoveEmail", { email: domain.allowedEmails[emailIndex] }),
    cancel: true,
    persistent: true,
  }).onOk(() => {
    domain.allowedEmails.splice(emailIndex, 1);
    q.notify({
      type: "positive",
      message: t("settings.emailRemoved"),
      timeout: 3000,
    });
  });
};

const saveChanges = async () => {
  saving.value = true;
  
  try {
    // Validate all domains have proper configuration
    for (const domain of domains) {
      if (!domain.allowAllUsers && domain.allowedEmails.length === 0) {
        q.notify({
          type: "negative",
          message: t("settings.domainNeedsEmails", { domain: domain.name }),
          timeout: 3000,
        });
        saving.value = false;
        return;
      }
    }

    // Prepare data for API
    const domainData: any = {
      domains: domains.map(domain => ({
        domain: domain.name,
        allow_all_users: domain.allowAllUsers,
        allowed_emails: !domain.allowAllUsers ? domain.allowedEmails : []
      }))
    };

    // Save to backend API
    await domainManagement.updateDomainRestrictions(store.state.zoConfig.meta_org, domainData);

    q.notify({
      type: "positive",
      message: t("settings.domainSettingsSaved"),
      timeout: 3000,
    });

    emit("saved", domains);
  } catch (error: any) {
    q.notify({
      type: "negative",
      message: error?.message || t("settings.errorSavingDomainSettings"),
      timeout: 3000,
    });
  } finally {
    saving.value = false;
  }
};

const resetForm = () => {
  newDomain.value = "";
  loadDomainSettings();
};
</script>

<style scoped lang="scss">
.domain-input {
  width: 300px;
}

.email-input {
  min-width: 250px;
}

.domain-card {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: white;
}

.domain-header {
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  border-radius: 8px 8px 0 0;
}

.specific-users-section {
  margin-left: 24px;
}

.email-item {
  background: #f9f9f9;
  border-radius: 4px;
  border: 1px solid #e0e0e0;
}

.body--dark {
  .domain-card {
    border-color: #444;
    background: #1e1e1e;
  }

  .domain-header {
    background: #2a2a2a;
    border-bottom-color: #444;
  }

  .email-item {
    background: #2a2a2a;
    border-color: #444;
  }
}
</style>
<style lang="scss">
.domain_management .q-field__bottom {
  padding-left: 0px;
}
</style>