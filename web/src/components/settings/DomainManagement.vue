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
  <div class="domain_management">
  <!-- Section header is provided full-width by the Settings shell. This page is a
       CONSTRAINED section, so ConstrainedPage owns the scroll + page gutter — the
       content just flows. (A nested h-full/overflow here can't resolve against
       ConstrainedPage's auto-height column and only forces a premature scrollbar.) -->
  <div>
    <!-- Claim Parser Function Selection -->
    <div class="tw:mb-6">
      <div
        data-test="domain-management-claim-parser-title"
        class="tw:text-xl tw:font-semibold tw:font-bold tw:mb-1"
      >
        {{ t("settings.claimParserFunction") }}
      </div>
      <div class="tw:text-sm tw:text-gray-400 tw:mb-3">
        {{ t("settings.claimParserFunctionDescription") }}
      </div>

      <div class="tw:flex tw:gap-3 tw:items-end">
        <div class="col-auto claim-parser-select">
          <OSelect
            v-model="claimParserFunction"
            :options="functionOptions"
            :label="t('settings.claimParserFunctionLabel')"
            searchable
            clearable
            :loading="loadingFunctions"
            @update:model-value="userTouched = true"
          >
            <template #empty>
              <span>{{ t('settings.noVrlFunctionsFound') }}</span>
            </template>
          </OSelect>
        </div>
        <div class="col-auto">
          <OButton
            variant="primary"
            size="sm-action"
            @click="saveClaimParserFunction"
            :loading="savingClaimParser"
            :disabled="!hasClaimParserChanged"
          >{{ t('common.save') }}</OButton>
        </div>
        <div class="col-auto">
          <OButton
            variant="ghost-muted"
            size="icon-xs-sq"
            @click="showVrlInfo = true"
            icon-left="help-outline"
          >
            <OTooltip :content="t('settings.claimParserFunctionInfoTitle')" side="top" />
          </OButton>
        </div>
      </div>

      <!-- Right Drawer for VRL Information -->
      <ODrawer
        v-model:open="showVrlInfo"
        :title="t('settings.claimParserFunctionInfoTitle')"
        side="right"
        :width="40"
      >
        <div class="tw:p-4 tw:text-sm">
          <div class="tw:mb-4 tw:p-4 info-box">
            <div class="tw:font-medium tw:mb-2">{{ t("settings.claimParserFunctionInputTitle") }}</div>
            <div>{{ t("settings.claimParserFunctionInputDescription") }}</div>
          </div>

          <div class="tw:mb-4 tw:p-4 info-box">
            <div class="tw:font-medium tw:mb-2">{{ t("settings.claimParserFunctionOutputTitle") }}</div>
            <div class="tw:mb-2">{{ t("settings.claimParserFunctionOutputDescription") }}</div>
            <div class="tw:ml-4">
              <div class="tw:mb-1">{{ t("settings.claimParserFunctionOutputExample1") }}</div>
              <div>{{ t("settings.claimParserFunctionOutputExample2") }}</div>
            </div>
          </div>

          <!-- Recent Errors Section -->
          <div v-if="claimParserFunction" class="tw:p-4 info-box error-section">
            <div class="tw:flex tw:items-center tw:mb-2">
              <div class="tw:flex-1 tw:font-medium">{{ t("settings.claimParserRecentErrors") }}</div>
              <div>
                <OButton
                  icon-left="refresh"
                  variant="ghost-muted"
                  size="icon-xs-sq"
                  @click="loadRecentErrors"
                  :loading="loadingErrors"
                >
                  <OTooltip :content="t('common.refresh')" side="top" />
                </OButton>
              </div>
            </div>

            <div v-if="loadingErrors" class="tw:text-center tw:py-4">
              <OSpinner size="xs" />
            </div>

            <div v-else-if="recentErrors.length === 0" class="tw:text-center tw:py-2" style="color: var(--o2-text-muted)">
              {{ t("settings.noRecentErrors") }}
            </div>

            <div v-else class="error-list">
              <div
                v-for="(error, index) in recentErrors.slice(0, 3)"
                :key="index"
                class="error-item tw:p-2 tw:mb-1"
              >
                <div class="tw:flex tw:items-start tw:mb-1">
                  <OIcon name="error" size="xs" class="tw:mr-1 tw:mt-1" />
                  <div class="tw:flex-1">
                    <div class="tw:text-xs tw:font-medium">{{ error.error_type }}</div>
                    <div class="tw:text-xs" style="color: var(--o2-text-muted)">{{ formatTimestamp(error._timestamp) }}</div>
                  </div>
                </div>
                <div class="tw:text-xs error-message">{{ error.error }}</div>
              </div>

              <!-- Show More Button -->
              <div class="tw:mt-2 tw:text-center">
                <OButton
                  icon-right="open-in-new"
                  variant="ghost-primary"
                  size="sm"
                  @click="viewAllErrors"
                >
                  {{ t('common.showMore') }}
                </OButton>
              </div>
            </div>
          </div>
        </div>
      </ODrawer>
    </div>

    <!-- Divider -->
    <OSeparator class="tw:mb-8" />

    <div
      data-test="domain-management-domain-restrictions-title"
      class="tw:text-xl tw:font-semibold tw:font-bold tw:mb-1"
    >
      {{ t("settings.domainRestrictionsSubsection") }}
    </div>
    <div class="tw:text-sm tw:text-gray-400 tw:mb-4">
      {{ t("settings.domainRestrictionsSubsectionDescription") }}
    </div>

    <!-- Domain Input Section -->
    <div class="tw:mb-1">
      <div class="tw:text-base tw:font-bold tw:mb-3">
        {{ t("settings.domainAndAllowedUsers") }}
      </div>
      
      <div class="tw:flex tw:gap-x-2 tw:items-center">
          <OInput
            data-test="domain-management-new-domain-input"
            v-model="newDomain"
            class="domain-input"
            @keydown.enter="addDomain"
            :placeholder="t('settings.domainPlaceholder')"
            :error="!!domainError"
            :error-message="domainError"
            @update:model-value="domainError = ''"
          />
          <OButton
            data-test="domain-management-add-domain-btn"
            variant="primary"
            size="sm-action"
            @click="addDomain"
            :disabled="!newDomain || !isValidDomain(newDomain)"
          >{{ t('settings.addDomain') }}
          </OButton>
      </div>
      <div class="tw:text-xs tw:text-gray-400 tw:mt-1">
        {{ t('settings.domainHint', { at_sign: '@' }) }}
      </div>

      <div class="tw:text-xs tw:text-gray-400 tw:mt-1 tw:mb-3" v-if="domains.length > 0">
        {{ t("settings.domainConfiguredCount", { count: domains.length }) }}
      </div>
    </div>

    <!-- Domain List -->
    <div v-if="domains.length > 0" class="tw:mb-4">
      <template v-for="(domain, index) in domains" :key="domain?.name || `domain-${index}`">
        <div 
          v-if="domain && domain.name"
          class="domain-card tw:mb-1"
        >
          <div class="domain-header tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2">
          <div
            :data-test="`domain-management-domain-name-${domain.name}`"
            class="tw:text-base tw:font-bold"
          >{{ domain.name }}</div>
          <OButton
            icon-left="close"
            variant="ghost-destructive"
            size="icon-xs-sq"
            @click="removeDomain(index)"
            :title="t('common.delete')"
          />
        </div>

        <div class="tw:p-3">
          <!-- Radio Button Options -->
          <ORadioGroup v-model="domain.allowAllUsers" orientation="vertical">
            <div class="tw:mb-1">
              <ORadio
                :val="true"
                :label="t('settings.allowAllUsersFromDomain', { domain: '@'+domain.name })"
              />
            </div>
            <div class="tw:mb-3">
              <ORadio
                :val="false"
                :label="t('settings.allowOnlySpecificUsers', { domain: '@'+domain.name })"
              />
            </div>
          </ORadioGroup>

          <!-- Info message for all users -->
          <div 
            v-if="domain.allowAllUsers"
            class="tw:p-2 tw:bg-blue-50 tw:text-blue-700 tw:rounded tw:mb-3"
          >
            {{ t("settings.allUsersAllowedMessage", { domain: '@'+domain.name }) }}
          </div>

          <!-- Specific users section -->
          <div v-if="!domain.allowAllUsers" class="specific-users-section">
              <div class="tw:flex tw:gap-x-2 tw:items-end">
                <OInput
                  v-model="domain.newEmail"
                  :label="t('settings.emailPlaceholder', { domain: '@' + domain.name })"
                  class="email-input"
                  @keydown.enter="addEmail(domain)"
                />
                <OButton
                  variant="primary"
                  size="sm-action"
                  @click="addEmail(domain)"
                  :disabled="!domain.newEmail || !isValidEmail(domain.newEmail, domain.name)"
                >{{ t('settings.addEmail') }}</OButton>
              </div>

            <!-- Email List -->
            <div v-if="domain.allowedEmails && domain.allowedEmails.length > 0">
              <div 
                v-for="(email, emailIndex) in domain.allowedEmails"
                :key="email"
                class="email-item tw:flex tw:items-center tw:justify-between tw:p-2 tw:mb-1"
              >
                <div class="tw:text-sm">{{ email }}</div>
                <OButton
                  icon-left="close"
                  variant="ghost-destructive"
                  size="icon-xs-sq"
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
    <div
      v-else
      data-test="domain-management-no-domain-message"
      class="tw:text-xl tw:font-semibold tw:text-gray-400 tw:mt-3 tw:mb-4 tw:w-full tw:text-center tw:p-4 domain-card"
    >
      {{ t("settings.noDomainMessage") }}
    </div>

  </div>
    <!-- Action Buttons — flow inline at the end of the constrained column. -->
    <div class="tw:flex tw:justify-end tw:gap-2 tw:pt-4 tw:mt-2 tw:border-t tw:border-(--o2-border-color)">
      <OButton
        variant="outline"
        size="sm-action"
        @click="resetForm"
      >{{ t('common.cancel') }}</OButton>
      <OButton
        data-test="domain-management-save-changes-btn"
        variant="primary"
        size="sm-action"
        @click="saveChanges"
        :loading="saving"
      >{{ t('settings.saveChanges') }}</OButton>
    </div>
  </div>

  <!-- Confirm remove domain dialog -->
  <ODialog
    v-model:open="confirmRemoveDomainOpen"
    size="sm"
    :title="t('common.confirm')"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('confirmDialog.ok')"
    @click:secondary="confirmRemoveDomainOpen = false"
    @click:primary="doRemoveDomain"
  >
    <p v-if="pendingRemoveDomainIndex !== null">{{ t('settings.confirmRemoveDomain', { domain: domains[pendingRemoveDomainIndex]?.name }) }}</p>
  </ODialog>

  <!-- Confirm remove email dialog -->
  <ODialog
    v-model:open="confirmRemoveEmailOpen"
    size="sm"
    :title="t('common.confirm')"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('confirmDialog.ok')"
    @click:secondary="confirmRemoveEmailOpen = false"
    @click:primary="doRemoveEmail"
  >
    <p v-if="pendingRemoveEmail !== null">{{ t('settings.confirmRemoveEmail', { email: pendingRemoveEmail.email }) }}</p>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onActivated, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";

import domainManagement from "@/services/domainManagement";
import { useRouter } from "vue-router";
import { add, formatDistanceToNow } from "date-fns";
import jstransform from "@/services/jstransform";
import organizations from "@/services/organizations";
import searchService from "@/services/search";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';

interface Domain {
  name: string;
  allowAllUsers: boolean;
  allowedEmails: string[];
  newEmail: string;
}

const { t } = useI18n();

// Dialog state for domain/email removal confirmations
const confirmRemoveDomainOpen = ref(false);
const pendingRemoveDomainIndex = ref<number | null>(null);
const confirmRemoveEmailOpen = ref(false);
const pendingRemoveEmail = ref<{ domain: any; emailIndex: number; email: string } | null>(null);
const store = useStore();
const router = useRouter();

const newDomain = ref("");
const domainError = ref("");
const domains = reactive<Domain[]>([]);
const saving = ref(false);

// Claim parser function state
const claimParserFunction = ref("");
const originalClaimParserFunction = ref(""); // Track original value to detect changes
const userTouched = ref(false); // Only true after user explicitly interacts with the select
const functionOptions = ref<string[]>([]);
const allFunctions = ref<string[]>([]);
const loadingFunctions = ref(false);
const savingClaimParser = ref(false);
const showVrlInfo = ref(false);
const recentErrors = ref<any[]>([]);
const loadingErrors = ref(false);

const emit = defineEmits(["cancel", "saved"]);

// Computed property to check if claim parser function value has changed.
// Requires explicit user interaction (userTouched) so the pre-loaded stored value
// does not enable the Save button on first render — matching main branch q-select hide-selected behaviour.
const hasClaimParserChanged = computed(() => {
  if (!userTouched.value) return false;
  return (claimParserFunction.value || "") !== originalClaimParserFunction.value;
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

    // Track the saved value for change detection without pre-populating the OSelect model.
    // This matches main branch's q-select hide-selected visual behaviour: the field appears
    // empty on first load; the user must explicitly select a value before saving.
    const storedFunction = store.state?.organizationData?.organizationSettings?.claim_parser_function || "";
    claimParserFunction.value = ""; // Always start visually empty
    userTouched.value = false;      // Reset so save button is disabled until user acts
    originalClaimParserFunction.value = storedFunction;
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
  if (!newDomain.value) {
    domainError.value = t("settings.domainRequired") || "Domain is required";
    return;
  }
  if (!isValidDomain(newDomain.value)) {
    domainError.value = t("settings.invalidDomain") || "Please enter a valid domain (e.g. example.com)";
    return;
  }
  
  // Check if domain already exists
  if (domains.some(d => d.name.toLowerCase() === newDomain.value.toLowerCase())) {
    toast({
      variant: "error",
      message: t("settings.domainAlreadyExists"),
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

  // toast({
  //   variant: "success",
  //   message: t("settings.domainAdded"),
  //   timeout: 3000,
  // });
};

const removeDomain = (index: number) => {
  pendingRemoveDomainIndex.value = index;
  confirmRemoveDomainOpen.value = true;
};

const doRemoveDomain = () => {
  const index = pendingRemoveDomainIndex.value;
  if (index === null) return;
  domains.splice(index, 1);
  pendingRemoveDomainIndex.value = null;
  confirmRemoveDomainOpen.value = false;
  toast({
    variant: "success",
    message: t("settings.domainRemoved"),
  });
};

const addEmail = (domain: Domain) => {
  if (!domain.newEmail || !isValidEmail(domain.newEmail, domain.name)) return;

  // Check if email already exists
  if (domain.allowedEmails.includes(domain.newEmail.toLowerCase())) {
    toast({
      variant: "error",
      message: t("settings.emailAlreadyExists"),
    });
    return;
  }

  domain.allowedEmails.push(domain.newEmail.toLowerCase());
  domain.newEmail = "";

  toast({
    variant: "success",
    message: t("settings.emailAdded"),
  });
};

const removeEmail = (domain: Domain, emailIndex: number) => {
  pendingRemoveEmail.value = { domain, emailIndex, email: domain.allowedEmails[emailIndex] };
  confirmRemoveEmailOpen.value = true;
};

const doRemoveEmail = () => {
  const pending = pendingRemoveEmail.value;
  if (!pending) return;
  pending.domain.allowedEmails.splice(pending.emailIndex, 1);
  pendingRemoveEmail.value = null;
  confirmRemoveEmailOpen.value = false;
  toast({
    variant: "success",
    message: t("settings.emailRemoved"),
  });
};

// Load VRL functions from _meta org
const loadFunctions = async () => {
  try {
    loadingFunctions.value = true;
    const response = await jstransform.list(1, 10000, "name", false, "", store.state.zoConfig.meta_org);

    // Populate options. The model value (claimParserFunction) is intentionally NOT set here
    // so the trigger remains visually empty until the user makes an explicit selection.
    const storedFunction = store.state?.organizationData?.organizationSettings?.claim_parser_function || "";
    originalClaimParserFunction.value = storedFunction;

    allFunctions.value = response.data.list.map((fn: any) => fn.name);
    functionOptions.value = allFunctions.value;
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

    // Update original value after successful save and reset interaction flag
    originalClaimParserFunction.value = claimParserFunction.value || "";
    userTouched.value = false;

    toast({
      variant: "success",
      message: t("settings.claimParserFunctionSaved"),
    });
  } catch (error: any) {
    toast({
      variant: "error",
      message: error?.message || t("settings.errorSavingClaimParserFunction"),
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
        toast({
          variant: "error",
          message: t("settings.domainNeedsEmails", { domain: domain.name }),
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

    toast({
      variant: "success",
      message: t("settings.domainSettingsSaved"),
    });

    emit("saved", domains);
  } catch (error: any) {
    toast({
      variant: "error",
      message: error?.message || t("settings.errorSavingDomainSettings"),
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