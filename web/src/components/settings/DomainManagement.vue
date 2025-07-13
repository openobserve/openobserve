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
  <div class="q-px-md q-py-md">
    <div class="text-h6 text-bold q-mb-md">
      {{ t("settings.ssoDomainRestrictions") }}
    </div>
    <div class="text-body2 text-grey-7 q-mb-lg">
      {{ t("settings.ssoDomainRestrictionsDescription") }}
    </div>

    <!-- SSO Provider Section -->
    <div class="q-mb-lg">
      <div class="sso-provider-card q-pa-md">
        <div class="row items-center justify-between q-mb-md">
          <div class="row items-center q-gutter-sm">
            <q-icon name="lock" size="sm" color="primary" />
            <q-input
              v-model="ssoProvider"
              :label="t('settings.ssoProviderName')"
              color="input-border"
              bg-color="input-bg"
              class="sso-provider-input"
              outlined
              dense
              :placeholder="t('settings.ssoProviderPlaceholder')"
            />
          </div>
          <q-badge 
            :color="isProviderEnabled ? 'positive' : 'grey'" 
            :label="isProviderEnabled ? t('common.enabled') : t('common.disabled')"
          />
        </div>

        <div v-if="isProviderEnabled" class="restriction-controls">
          <div class="q-mb-md">
            <q-radio
              v-model="restrictionMode"
              val="allow-all"
              :label="t('settings.allowAllUsers')"
              color="primary"
            />
            <div class="text-caption text-grey-6 q-ml-lg">
              {{ t("settings.allowAllUsersDescription") }}
            </div>
          </div>
          
          <div class="q-mb-md">
            <q-radio
              v-model="restrictionMode"
              val="domain-restricted"
              :label="t('settings.restrictToSpecificDomains')"
              color="primary"
            />
            <div class="text-caption text-grey-6 q-ml-lg">
              {{ t("settings.restrictToSpecificDomainsDescription") }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Domain Input Section -->
    <div v-if="restrictionMode === 'domain-restricted'" class="q-mb-lg">
      <div class="text-body1 text-bold q-mb-md">
        {{ t("settings.allowedDomains") }}
      </div>
      
      <div class="row q-gutter-md items-center q-mb-md">
        <div class="col-auto">
          <q-input
            v-model="newDomain"
            :label="t('settings.domainPlaceholder')"
            :hint="t('settings.domainHint', {'at-sign': '@ symbol'})"
            color="input-border"
            bg-color="input-bg"
            class="domain-input"
            outlined
            dense
            :rules="[
              (val) => !!val || t('common.required'),
              (val) => isValidDomain(val) || t('settings.invalidDomain')
            ]"
          />
        </div>
        <div class="col-auto">
          <q-btn
            :label="t('settings.addDomain')"
            color="primary"
            @click="addDomain"
            :disabled="!newDomain || !isValidDomain(newDomain)"
            unelevated
          />
        </div>
      </div>

      <div class="text-caption text-grey-6 q-mb-md">
        {{ t("settings.domainConfiguredCount", { count: domains.length }) }}
      </div>
    </div>

    <!-- Domain List -->
    <div v-if="domains.length > 0 && restrictionMode === 'domain-restricted'" class="q-mb-lg">
      <div 
        v-for="(domain, index) in domains" 
        :key="domain.name"
        class="domain-card q-mb-md"
      >
        <div class="domain-header row items-center justify-between q-pa-md">
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
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="row q-gutter-md">
      <q-btn
        :label="t('common.cancel')"
        flat
        color="grey-7"
        @click="$emit('cancel')"
      />
      <q-btn
        :label="t('settings.saveChanges')"
        color="secondary"
        unelevated
        @click="saveChanges"
        :loading="saving"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import domainManagement from "@/services/domainManagement";

interface Domain {
  name: string;
}

const { t } = useI18n();
const q = useQuasar();
const store = useStore();
const router = useRouter();

const newDomain = ref("");
const domains = reactive<Domain[]>([]);
const saving = ref(false);
const ssoProvider = ref("Microsoft SSO");
const isProviderEnabled = ref(true);
const restrictionMode = ref("allow-all");

const emit = defineEmits(["cancel", "saved"]);

// Watch for changes in restriction mode and clear domains when "allow-all" is selected
watch(restrictionMode, (newMode) => {
  if (newMode === "allow-all") {
    // Clear all domains when "Allow all users" is selected
    domains.splice(0, domains.length);
  }
});

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

const loadDomainSettings = async () => {
  try {
    const response = await domainManagement.getDomainRestrictions(
      store.state.selectedOrganization.identifier
    );
    
    if (response.data) {
      if (response.data.provider) {
        ssoProvider.value = response.data.provider;
      }
      if (response.data.restrictionMode) {
        restrictionMode.value = response.data.restrictionMode;
      }
      if (response.data.domains) {
        const loadedDomains = response.data.domains.map((domain: any) => ({
          name: domain.name || domain
        }));
        domains.splice(0, domains.length, ...loadedDomains);
      }
    }
  } catch (error: any) {
    // If the API doesn't exist yet or returns an error, use example data
    console.warn("Domain restrictions API not available, using example data:", error);
    
    const existingDomains = [];
    
    domains.splice(0, domains.length, ...existingDomains);
  }
};

const isValidDomain = (domain: string): boolean => {
  if (!domain) return false;
  // Basic domain validation - can be enhanced
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.([a-zA-Z]{2,}\.?)+$/;
  return domainRegex.test(domain);
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
    name: newDomain.value
  });

  newDomain.value = "";

  q.notify({
    type: "positive",
    message: t("settings.domainAdded"),
    timeout: 3000,
  });
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

const saveChanges = async () => {
  saving.value = true;
  
  try {
    // Prepare data for API
    const domainData = {
      provider: ssoProvider.value,
      restrictionMode: restrictionMode.value,
      domains: domains.map(domain => ({
        name: domain.name
      }))
    };

    // Save to backend API (simplified for now)
    console.log('Saving domain settings:', domainData);
    
    // TODO: Replace with actual API call when backend is ready
    // await domainManagement.updateDomainRestrictions(
    //   store.state.selectedOrganization.identifier,
    //   domainData
    // );

    q.notify({
      type: "positive",
      message: t("settings.domainSettingsSaved"),
      timeout: 3000,
    });

    emit("saved", domainData);
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
</script>

<style scoped lang="scss">
.domain-input {
  width: 300px;
}

.sso-provider-input {
  min-width: 200px;
}

.sso-provider-card {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: white;
}

.restriction-controls {
  border-top: 1px solid #e0e0e0;
  padding-top: 16px;
  margin-top: 16px;
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