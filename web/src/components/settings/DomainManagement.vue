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
    <!-- Claim Parser Function Selection -->
    <div class="q-mb-xl">
      <div class="text-h6 text-bold q-mb-xs">
        {{ t("settings.claimParserFunction") }}
      </div>
      <div class="text-body2 text-grey-7 q-mb-md">
        {{ t("settings.claimParserFunctionDescription") }}
      </div>

      <div class="row q-gutter-md items-end">
        <div class="col-auto claim-parser-select">
          <q-select
            v-model="claimParserFunction"
            :options="functionOptions"
            :label="t('settings.claimParserFunctionLabel')"
            color="input-border"
            bg-color="input-bg"
            class="showLabelOnTop"
            stack-label
            outlined
            dense
            :loading="loadingFunctions"
            @filter="filterFunctions"
            use-input
            fill-input
            hide-selected
            input-debounce="300"
            clearable
          >
            <template v-slot:hint>
              {{ t("settings.claimParserFunctionHint") }}
            </template>
            <template v-slot:no-option>
              <q-item>
                <q-item-section class="text-grey">
                  {{ t("settings.noVrlFunctionsFound") }}
                </q-item-section>
              </q-item>
            </template>
          </q-select>
        </div>
        <div class="col-auto">
          <q-btn
            :label="t('common.save')"
            color="primary"
            class="text-bold text-capitalize no-border"
            unelevated
            @click="saveClaimParserFunction"
            :loading="savingClaimParser"
            :disable="!hasClaimParserChanged"
          />
        </div>
        <div class="col-auto">
          <q-btn
            flat
            round
            dense
            icon="help_outline"
            @click="showVrlInfo = true"
          >
            <q-tooltip>{{ t("settings.claimParserFunctionInfoTitle") }}</q-tooltip>
          </q-btn>
        </div>
      </div>

      <!-- Right Drawer for VRL Information -->
      <q-drawer
        v-model="showVrlInfo"
        side="right"
        bordered
        :width="450"
        overlay
        elevated
      >
        <div class="q-pa-md">
          <div class="row items-center q-mb-md">
            <div class="col text-h6 text-bold">
              {{ t("settings.claimParserFunctionInfoTitle") }}
            </div>
            <div class="col-auto">
              <q-btn
                flat
                round
                dense
                icon="close"
                @click="showVrlInfo = false"
              />
            </div>
          </div>

          <div class="text-body2">
            <div class="q-mb-md q-pa-md info-box">
              <div class="text-weight-medium q-mb-sm">{{ t("settings.claimParserFunctionInputTitle") }}</div>
              <div>{{ t("settings.claimParserFunctionInputDescription") }}</div>
            </div>

            <div class="q-mb-md q-pa-md info-box">
              <div class="text-weight-medium q-mb-sm">{{ t("settings.claimParserFunctionOutputTitle") }}</div>
              <div class="q-mb-sm">{{ t("settings.claimParserFunctionOutputDescription") }}</div>
              <div class="q-ml-md">
                <div class="q-mb-xs">{{ t("settings.claimParserFunctionOutputExample1") }}</div>
                <div>{{ t("settings.claimParserFunctionOutputExample2") }}</div>
              </div>
            </div>

            <!-- Recent Errors Section -->
            <div v-if="claimParserFunction" class="q-pa-md info-box error-section">
              <div class="row items-center q-mb-sm">
                <div class="col text-weight-medium">{{ t("settings.claimParserRecentErrors") }}</div>
                <div class="col-auto">
                  <q-btn
                    flat
                    dense
                    size="sm"
                    icon="refresh"
                    @click="loadRecentErrors"
                    :loading="loadingErrors"
                  >
                    <q-tooltip>{{ t("common.refresh") }}</q-tooltip>
                  </q-btn>
                </div>
              </div>

              <div v-if="loadingErrors" class="text-center q-py-md">
                <q-spinner color="primary" size="sm" />
              </div>

              <div v-else-if="recentErrors.length === 0" class="text-grey-7 text-center q-py-sm">
                {{ t("settings.noRecentErrors") }}
              </div>

              <div v-else class="error-list">
                <div
                  v-for="(error, index) in recentErrors.slice(0, 3)"
                  :key="index"
                  class="error-item q-pa-sm q-mb-xs"
                >
                  <div class="row items-start q-mb-xs">
                    <q-icon name="error" color="negative" size="xs" class="q-mr-xs q-mt-xs" />
                    <div class="col">
                      <div class="text-caption text-weight-medium">{{ error.error_type }}</div>
                      <div class="text-caption text-grey-7">{{ formatTimestamp(error._timestamp) }}</div>
                    </div>
                  </div>
                  <div class="text-caption error-message">{{ error.error }}</div>
                </div>

                <!-- Show More Button -->
                <div class="q-mt-sm text-center">
                  <q-btn
                    flat
                    dense
                    color="primary"
                    :label="t('common.showMore')"
                    icon-right="open_in_new"
                    size="sm"
                    @click="viewAllErrors"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </q-drawer>
    </div>

    <!-- Divider -->
    <q-separator class="q-mb-xl" />

    <div class="text-h6 text-bold q-mb-xs">
      {{ t("settings.domainRestrictionsSubsection") }}
    </div>
    <div class="text-body2 text-grey-7 q-mb-lg">
      {{ t("settings.domainRestrictionsSubsectionDescription") }}
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
            :hint="t('settings.domainHint', { 'at_sign': '@' })"
            class="domain-input"
            borderless
            hide-bottom-space
            dense
            @keydown.enter="addDomain"
            :placeholder="t('settings.domainPlaceholder')"
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
      <template v-for="(domain, index) in domains" :key="domain?.name || `domain-${index}`">
        <div 
          v-if="domain && domain.name"
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
      </template>
    </div>
    <div v-else class="text-h6 text-grey-6 q-mt-md q-mb-lg tw:w-full text-center q-pa-lg domain-card">
      {{ t("settings.noDomainMessage") }}
    </div>

    <!-- Action Buttons -->
    <div class="flex justify-end q-px-lg q-py-lg full-width tw:absolute tw:bottom-0">
      <q-btn
        :label="t('common.cancel')"
        class="q-mr-md o2-secondary-button tw:h-[36px]"
        @click="resetForm"
      />
      <q-btn
        :label="t('settings.saveChanges')"
        class="o2-primary-button no-border tw:h-[36px] q-mr-md"
        unelevated
        @click="saveChanges"
        :loading="saving"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onActivated, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import domainManagement from "@/services/domainManagement";
import { useRouter } from "vue-router";
import { add, formatDistanceToNow } from "date-fns";
import jstransform from "@/services/jstransform";
import organizations from "@/services/organizations";
import searchService from "@/services/search";

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

// Claim parser function state
const claimParserFunction = ref("");
const originalClaimParserFunction = ref(""); // Track original value to detect changes
const functionOptions = ref<string[]>([]);
const allFunctions = ref<string[]>([]);
const loadingFunctions = ref(false);
const savingClaimParser = ref(false);
const showVrlInfo = ref(false);
const recentErrors = ref<any[]>([]);
const loadingErrors = ref(false);

const emit = defineEmits(["cancel", "saved"]);

// Computed property to check if claim parser function value has changed
const hasClaimParserChanged = computed(() => {
  return claimParserFunction.value !== originalClaimParserFunction.value;
});

onMounted(() => {
  if(store.state.zoConfig.meta_org == store.state.selectedOrganization.identifier) {
    loadDomainSettings();
    loadFunctions();
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
    loadFunctions();
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
      const loadedDomains = response.data.domains
        .filter((domain: any) => domain && typeof domain === 'object' && domain.domain) // Filter out invalid entries
        .map((domain: any) => ({
          name: domain.domain,
          allowAllUsers: domain.allow_all_users,
          allowedEmails: domain.allowed_emails || []
        }));
      domains.splice(0, domains.length, ...loadedDomains);
    }

    // Load claim parser function from organization settings
    const storedFunction = store.state?.organizationData?.organizationSettings?.claim_parser_function || "";
    claimParserFunction.value = storedFunction;
    originalClaimParserFunction.value = storedFunction; // Store original for change detection
  } catch (error: any) {
    // If the API doesn't exist yet or returns an error, use example data
    console.warn("Domain restrictions API not available, using example data:", error);

    const existingDomains = [];

    domains.splice(0, domains.length, ...existingDomains);
  }
};

const isValidDomain = (domain: any): boolean => {
  // Handle null, undefined, and non-string inputs
  if (domain === null || domain === undefined) return true; // Empty is valid
  if (typeof domain !== 'string') return false; // Non-strings are invalid
  
  // Handle empty strings - empty is valid, but whitespace-only is not
  const trimmed = domain.trim();
  if (!trimmed) return domain.length === 0; // Empty string is valid, whitespace-only is not
  
  // Security: Check for potentially malicious content (more targeted patterns)
  const maliciousPatterns = [
    '<script', '</script', 'javascript:', 'DROP TABLE', 'SELECT FROM', 'INSERT INTO', 
    'UPDATE SET', 'DELETE FROM', 'UNION SELECT', '--', '/*', '*/', '\0', '\n', '\r'
  ];
  
  const upperDomain = trimmed.toUpperCase();
  if (maliciousPatterns.some(pattern => upperDomain.includes(pattern.toUpperCase()))) {
    return false;
  }
  
  // Length validation (DNS limit is 253 characters)
  if (trimmed.length > 253) return false;
  
  // Remove trailing dot if present (valid in DNS)
  const cleanDomain = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
  
  // Improved domain validation that properly handles hyphens and edge cases
  // Domain parts can contain letters, numbers, and hyphens (but not start/end with hyphens)
  // Each label can be 1-63 characters, and the domain must have at least one dot
  const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  
  try {
    return domainRegex.test(cleanDomain);
  } catch (error) {
    return false; // Any regex error means invalid
  }
};

const isValidEmail = (email: any, domain: any): boolean => {
  // Handle null, undefined, and non-string inputs
  if (email === null || email === undefined || typeof email !== 'string') return false;
  if (domain === null || domain === undefined || typeof domain !== 'string') return false;
  
  // Handle empty strings
  if (!email.trim() || !domain.trim()) return false;
  
  // Security: Check for potentially malicious content
  const maliciousPatterns = [
    '<', '>', 'script', 'javascript:', 'DROP', 'SELECT', 'INSERT', 'UPDATE', 'DELETE',
    'UNION', 'CREATE', 'ALTER', 'TABLE', 'FROM', '--', '/*', '*/', "'", '"',
    '\0', '\n', '\r', '\t'
  ];
  
  const upperEmail = email.toUpperCase();
  if (maliciousPatterns.some(pattern => upperEmail.includes(pattern.toUpperCase()))) {
    return false;
  }
  
  // Length validation (practical email limit)
  if (email.length > 254 || domain.length > 253) return false;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  try {
    if (!emailRegex.test(email)) return false;
    
    // Check if email belongs to the domain
    return email.toLowerCase().endsWith(`@${domain.toLowerCase()}`);
  } catch (error) {
    return false; // Any error means invalid
  }
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

// Load VRL functions from _meta org
const loadFunctions = async () => {
  try {
    loadingFunctions.value = true;
    const response = await jstransform.list(1, 10000, "name", false, "", store.state.zoConfig.meta_org);

    allFunctions.value = response.data.list.map((fn: any) => fn.name);
    functionOptions.value = allFunctions.value;

    // Set the current value from store if it exists
    const storedFunction = store.state?.organizationData?.organizationSettings?.claim_parser_function || "";
    claimParserFunction.value = storedFunction;
    originalClaimParserFunction.value = storedFunction; // Store original for change detection
  } catch (e: any) {
    console.error("Error loading functions:", e);
  } finally {
    loadingFunctions.value = false;
  }
};

// Filter functions for autocomplete
const filterFunctions = (val: string, update: Function) => {
  update(() => {
    if (val === "") {
      functionOptions.value = allFunctions.value;
    } else {
      const needle = val.toLowerCase();
      functionOptions.value = allFunctions.value.filter(
        (v) => v.toLowerCase().indexOf(needle) > -1
      );
    }
  });
};

// Save claim parser function separately
const saveClaimParserFunction = async () => {
  savingClaimParser.value = true;

  try {
    const orgSettingsPayload: any = {
      claim_parser_function: claimParserFunction.value || "",
    };

    await organizations.post_organization_settings(
      store.state.zoConfig.meta_org,
      orgSettingsPayload,
    );

    // Update store with new settings
    const updatedSettings: any = {
      ...store.state?.organizationData?.organizationSettings,
      claim_parser_function: claimParserFunction.value || "",
    };
    store.dispatch("setOrganizationSettings", updatedSettings);

    // Update original value after successful save
    originalClaimParserFunction.value = claimParserFunction.value || "";

    q.notify({
      type: "positive",
      message: t("settings.claimParserFunctionSaved"),
      timeout: 3000,
    });
  } catch (error: any) {
    q.notify({
      type: "negative",
      message: error?.message || t("settings.errorSavingClaimParserFunction"),
      timeout: 3000,
    });
  } finally {
    savingClaimParser.value = false;
  }
};

// Build SQL query for claim parser errors
const buildErrorsQuery = (functionName: string, limit?: number): string => {
  const limitClause = limit ? ` LIMIT ${limit}` : '';
  return `SELECT * FROM "errors" WHERE error_source='${functionName}' ORDER BY _timestamp DESC${limitClause}`;
};

// Load recent errors for the claim parser function
const loadRecentErrors = async () => {
  if (!claimParserFunction.value) {
    recentErrors.value = [];
    return;
  }

  loadingErrors.value = true;
  try {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const query = {
      query: {
        sql: buildErrorsQuery(claimParserFunction.value, 10),
        start_time: last24Hours.getTime() * 1000, // microseconds
        end_time: now.getTime() * 1000,
        from: 0,
        size: 10,
      },
    };

    const response = await searchService.search(
      {
        org_identifier: store.state.zoConfig.meta_org,
        query: query,
        page_type: "logs",
      },
      "ui"
    );

    if (response.data && response.data.hits) {
      recentErrors.value = response.data.hits.map((hit: any) => hit);
    } else {
      recentErrors.value = [];
    }
  } catch (error: any) {
    console.error("Error loading recent errors:", error);
    recentErrors.value = [];
  } finally {
    loadingErrors.value = false;
  }
};

// Format timestamp for display
const formatTimestamp = (timestamp: number) => {
  try {
    const date = new Date(timestamp / 1000); // Convert microseconds to milliseconds
    return formatDistanceToNow(date, { addSuffix: true });
  } catch (e) {
    return "Unknown time";
  }
};

// Watch for drawer opening and load errors
watch(showVrlInfo, (newVal) => {
  if (newVal && claimParserFunction.value) {
    loadRecentErrors();
  }
});

// Navigate to logs page with error filters
const viewAllErrors = () => {
  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Build the SQL query for the logs page using the reusable function
  const sqlQuery = buildErrorsQuery(claimParserFunction.value);

  // Base64 encode the query
  const encodedQuery = btoa(sqlQuery);

  // Navigate to logs page with pre-filled parameters
  router.push({
    path: "/logs",
    query: {
      org_identifier: store.state.zoConfig.meta_org,
      stream: "errors",
      stream_type: "logs",
      from: last24Hours.getTime() * 1000, // microseconds
      to: now.getTime() * 1000,
      refresh: "0",
      sql_mode: "true",
      query: encodedQuery,
      type: "logs",
    },
  });

  // Close the drawer
  showVrlInfo.value = false;
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
.claim-parser-select {
  min-width: 400px;
}

.info-box {
  background-color: #f5f5f5;
  border-radius: 4px;
}

.domain-input {
  width: 300px;
}

.email-input {
  min-width: 250px;
}

.function-select {
  max-width: 500px;
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

.error-section {
  border-left: 3px solid #c10015;
}

.error-list {
  max-height: 400px;
  overflow-y: auto;
}

.error-item {
  background: #fff9f9;
  border-radius: 4px;
  border-left: 2px solid #ff9e9e;
}

.error-message {
  color: #666;
  word-break: break-word;
}

.body--dark {
  .info-box {
    background-color: #2a2a2a;
  }

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

  .error-section {
    border-left-color: #ff6b6b;
  }

  .error-item {
    background: #2a1f1f;
    border-left-color: #ff6b6b;
  }

  .error-message {
    color: #ccc;
  }
}
</style>
<style lang="scss">
.domain_management .q-field__bottom {
  padding-left: 0px;
}
</style>