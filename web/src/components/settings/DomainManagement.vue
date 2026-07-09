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
    <div class="mb-6">
      <div
        data-test="domain-management-claim-parser-title"
        class="text-xl font-semibold font-bold mb-1"
      >
        {{ t("settings.claimParserFunction") }}
      </div>
      <div class="text-sm text-gray-400 mb-3">
        {{ t("settings.claimParserFunctionDescription") }}
      </div>

      <div class="flex gap-3 items-end">
        <div class="col-auto claim-parser-select min-w-100">
          <OSelect
            v-model="claimParserFunction"
            :options="functionOptions"
            :label="t('settings.claimParserFunctionLabel')"
            searchable
            clearable
            :loading="loadingFunctions"
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
        <div class="p-4 text-sm">
          <div class="mb-4 p-4 rounded" :class="store.state.theme === 'dark' ? 'bg-[#2a2a2a]' : 'bg-[#f5f5f5]'">
            <div class="font-medium mb-2">{{ t("settings.claimParserFunctionInputTitle") }}</div>
            <div>{{ t("settings.claimParserFunctionInputDescription") }}</div>
          </div>

          <div class="mb-4 p-4 rounded" :class="store.state.theme === 'dark' ? 'bg-[#2a2a2a]' : 'bg-[#f5f5f5]'">
            <div class="font-medium mb-2">{{ t("settings.claimParserFunctionOutputTitle") }}</div>
            <div class="mb-2">{{ t("settings.claimParserFunctionOutputDescription") }}</div>
            <div class="ml-4">
              <div class="mb-1">{{ t("settings.claimParserFunctionOutputExample1") }}</div>
              <div>{{ t("settings.claimParserFunctionOutputExample2") }}</div>
            </div>
          </div>

          <!-- Recent Errors Section -->
          <div v-if="claimParserFunction" class="p-4 rounded border-l-[3px]" :class="store.state.theme === 'dark' ? 'bg-[#2a2a2a] border-l-[#ff6b6b]' : 'bg-[#f5f5f5] border-l-[#c10015]'">
            <div class="flex items-center mb-2">
              <div class="flex-1 font-medium">{{ t("settings.claimParserRecentErrors") }}</div>
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

            <div v-if="loadingErrors" class="text-center py-4">
              <OSpinner size="xs" />
            </div>

            <div v-else-if="recentErrors.length === 0" class="text-center py-2" style="color: var(--o2-text-muted)">
              {{ t("settings.noRecentErrors") }}
            </div>

            <div v-else class="error-list max-h-100 overflow-y-auto">
              <div
                v-for="(error, index) in recentErrors.slice(0, 3)"
                :key="index"
                class="p-2 mb-1 rounded border-l-2"
                :class="store.state.theme === 'dark' ? 'bg-[#2a1f1f] border-l-[#ff6b6b]' : 'bg-[#fff9f9] border-l-[#ff9e9e]'"
              >
                <div class="flex items-start mb-1">
                  <OIcon name="error" size="xs" class="mr-1 mt-1" />
                  <div class="flex-1">
                    <div class="text-xs font-medium">{{ error.error_type }}</div>
                    <div class="text-xs" style="color: var(--o2-text-muted)">{{ formatTimestamp(error._timestamp) }}</div>
                  </div>
                </div>
                <div class="text-xs wrap-break-word" :class="store.state.theme === 'dark' ? 'text-[#ccc]' : 'text-[#666]'">{{ error.error }}</div>
              </div>

              <!-- Show More Button -->
              <div class="mt-2 text-center">
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
    <OSeparator class="mb-8" />

    <div
      data-test="domain-management-domain-restrictions-title"
      class="text-xl font-semibold font-bold mb-1"
    >
      {{ t("settings.domainRestrictionsSubsection") }}
    </div>
    <div class="text-sm text-gray-400 mb-4">
      {{ t("settings.domainRestrictionsSubsectionDescription") }}
    </div>

    <!-- Domain Input Section -->
    <div class="mb-1">
      <div class="text-base font-bold mb-3">
        {{ t("settings.domainAndAllowedUsers") }}
      </div>

      <div class="flex gap-x-2 items-center">
          <!-- Fixed-width wrapper: OInput fills its parent (w-full), so
               constraining the parent sizes the input without overriding it. -->
          <div class="w-[18.75rem] shrink-0">
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
          </div>
          <OButton
            data-test="domain-management-add-domain-btn"
            variant="primary"
            size="sm-action"
            @click="addDomain"
            :disabled="!newDomain || !isValidDomain(newDomain)"
          >{{ t('settings.addDomain') }}
          </OButton>
      </div>
      <div class="text-xs text-gray-400 mt-1">
        {{ t('settings.domainHint', { at_sign: '@' }) }}
      </div>

      <div class="text-xs text-gray-400 mt-1 mb-3" v-if="domains.length > 0">
        {{ t("settings.domainConfiguredCount", { count: domains.length }) }}
      </div>
    </div>

    <!-- Domain List -->
    <div v-if="domains.length > 0" class="mb-4">
      <template v-for="(domain, index) in domains" :key="domain?.name || `domain-${index}`">
        <div
          v-if="domain && domain.name"
          class="mb-1 border border-(--o2-border) rounded-lg"
          :class="store.state.theme === 'dark' ? 'border-[#444] bg-[#1e1e1e]' : 'bg-white'"
        >
          <div class="flex items-center justify-between px-3 py-2 border-b border-b-(--o2-border) rounded-t-lg" :class="store.state.theme === 'dark' ? 'bg-[#2a2a2a] border-b-[#444]' : 'bg-[#f5f5f5]'">
          <div class="text-base font-bold" :data-test="`domain-management-domain-name-${domain.name}`">{{ domain.name }}</div>
          <OButton
            icon-left="close"
            variant="ghost-destructive"
            size="icon-xs-sq"
            @click="removeDomain(index)"
            :title="t('common.delete')"
          />
        </div>

        <div class="p-3">
          <!-- Access policy for this domain (allow/block are mutually exclusive per domain) -->
          <ORadioGroup v-model="domain.policy" orientation="vertical">
            <div class="mb-1">
              <ORadio
                :data-test="`domain-management-allow-all-radio-${domain.name}`"
                val="allow_all"
                :label="t('settings.allowAllUsersFromDomain', { domain: '@'+domain.name })"
              />
            </div>
            <div class="mb-1">
              <ORadio
                :data-test="`domain-management-allow-specific-radio-${domain.name}`"
                val="allow_specific"
                :label="t('settings.allowOnlySpecificUsers', { domain: '@'+domain.name })"
              />
            </div>
            <div class="mb-1">
              <ORadio
                :data-test="`domain-management-block-specific-radio-${domain.name}`"
                val="block_specific"
                :label="t('settings.blockSpecificUsers', { domain: '@'+domain.name })"
              />
            </div>
            <div class="mb-3">
              <ORadio
                :data-test="`domain-management-block-all-radio-${domain.name}`"
                val="block_all"
                :label="t('settings.blockAllUsersFromDomain', { domain: '@'+domain.name })"
              />
            </div>
          </ORadioGroup>

          <!-- Info message for all users -->
          <div
            v-if="domain.policy === 'allow_all'"
            class="p-2 rounded mb-3"
            :class="store.state.theme === 'dark' ? 'bg-[#1a2535] text-blue-300' : 'bg-blue-50 text-blue-700'"
          >
            {{ t("settings.allUsersAllowedMessage", { domain: '@'+domain.name }) }}
          </div>

          <!-- Info message for whole-domain block -->
          <div
            v-if="domain.policy === 'block_all'"
            class="p-2 rounded mb-3"
            :class="store.state.theme === 'dark' ? 'bg-[#351a1a] text-red-300' : 'bg-red-50 text-red-700'"
          >
            {{ t("settings.allUsersBlockedMessage", { domain: '@'+domain.name }) }}
          </div>

          <!-- Specific allowed users section -->
          <div v-if="domain.policy === 'allow_specific'" class="specific-users-section ml-6">
              <div class="flex gap-x-2 items-center">
                <OInput
                  :data-test="`domain-management-allow-email-input-${domain.name}`"
                  v-model="domain.newEmail"
                  :placeholder="t('settings.emailPlaceholder', { domain: '@' + domain.name })"
                  class="email-input min-w-62.5"
                  @keydown.enter="addEmail(domain)"
                />
                <OButton
                  data-test="domain-management-add-email-btn"
                  variant="primary"
                  size="icon-sm"
                  icon-left="add"
                  :title="t('settings.addEmail')"
                  @click="addEmail(domain)"
                  :disabled="!domain.newEmail || !isValidEmail(domain.newEmail, domain.name)"
                />
              </div>

            <!-- Allowed Email pills -->
            <div v-if="domain.allowedEmails && domain.allowedEmails.length > 0" class="flex flex-wrap gap-2 mt-3">
              <span
                v-for="(email, emailIndex) in domain.allowedEmails"
                :key="email"
                class="inline-flex items-center gap-1 pl-3 pr-1 py-0.5 rounded-full text-sm border border-(--o2-border)"
                :class="store.state.theme === 'dark' ? 'bg-[#2a2a2a]' : 'bg-[#f4f4f5]'"
              >
                {{ email }}
                <button
                  type="button"
                  class="flex items-center justify-center rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                  @click="removeEmail(domain, emailIndex)"
                  :title="t('common.delete')"
                >
                  <OIcon name="close" size="xs" />
                </button>
              </span>
            </div>
          </div>

          <!-- Specific blocked users section -->
          <div v-if="domain.policy === 'block_specific'" class="specific-users-section ml-6">
              <div class="flex gap-x-2 items-center">
                <OInput
                  :data-test="`domain-management-block-email-input-${domain.name}`"
                  v-model="domain.newBlockedEmail"
                  :placeholder="t('settings.blockedEmailPlaceholder', { domain: '@' + domain.name })"
                  class="email-input min-w-62.5"
                  @keydown.enter="addBlockedEmail(domain)"
                />
                <OButton
                  data-test="domain-management-block-email-btn"
                  variant="destructive"
                  size="icon-sm"
                  icon-left="add"
                  :title="t('settings.addBlockedEmail')"
                  @click="addBlockedEmail(domain)"
                  :disabled="!domain.newBlockedEmail || !isValidEmail(domain.newBlockedEmail, domain.name)"
                />
              </div>

            <!-- Blocked Email pills -->
            <div v-if="domain.blockedEmails && domain.blockedEmails.length > 0" class="flex flex-wrap gap-2 mt-3">
              <span
                v-for="(email, emailIndex) in domain.blockedEmails"
                :key="email"
                class="inline-flex items-center gap-1 pl-3 pr-1 py-0.5 rounded-full text-sm border"
                :class="store.state.theme === 'dark' ? 'bg-[#3a2020] border-[#5a3a3a] text-red-300' : 'bg-[#fff1f1] border-[#f3c6c6] text-red-700'"
              >
                {{ email }}
                <button
                  type="button"
                  class="flex items-center justify-center rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                  @click="removeBlockedEmail(domain, emailIndex)"
                  :title="t('common.delete')"
                >
                  <OIcon name="close" size="xs" />
                </button>
              </span>
            </div>
          </div>

          <!-- Hint for any block policy -->
          <div
            v-if="domain.policy === 'block_specific' || domain.policy === 'block_all'"
            class="text-xs text-gray-400 mt-3"
          >
            {{ t("settings.blockedUsersHint") }}
          </div>
        </div>
      </div>
      </template>
    </div>
    <div
      v-else
      data-test="domain-management-no-domain-message"
      class="text-xl font-semibold text-gray-400 mt-3 mb-4 w-full text-center p-4 border border-(--o2-border) rounded-lg"
      :class="store.state.theme === 'dark' ? 'border-[#444] bg-[#1e1e1e]' : 'bg-white'"
    >
      {{ t("settings.noDomainMessage") }}
    </div>

  </div>
    <!-- Action Buttons — flow inline at the end of the constrained column. -->
    <div class="flex items-center justify-between gap-2 pt-4 mt-2 border-t border-(--o2-border-color)">
      <!-- Unsaved-changes indicator: makes it obvious the in-card edits (domains, policies,
           allow/block emails) are staged until Save is clicked. -->
      <div
        v-if="isDirty"
        data-test="domain-management-unsaved-indicator"
        class="flex items-center gap-2 text-sm"
        style="color: var(--o2-text-muted)"
      >
        <span
          class="inline-block w-2 h-2 rounded-full shrink-0"
          style="background: var(--o2-primary-color)"
        ></span>
        {{ t('common.unsavedChanges') }}
      </div>
      <div v-else></div>

      <div class="flex gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="!isDirty || saving"
          @click="resetForm"
        >{{ t('common.cancel') }}</OButton>
        <OButton
          data-test="domain-management-save-changes-btn"
          variant="primary"
          size="sm-action"
          @click="saveChanges"
          :loading="saving"
          :disabled="!isDirty"
        >{{ t('settings.saveChanges') }}</OButton>
      </div>
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
    <p v-if="pendingRemoveEmail !== null">{{ pendingRemoveEmail.blocked ? t('settings.confirmRemoveBlockedEmail', { email: pendingRemoveEmail.email }) : t('settings.confirmRemoveEmail', { email: pendingRemoveEmail.email }) }}</p>
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

type DomainPolicy = "allow_all" | "allow_specific" | "block_specific" | "block_all";

interface Domain {
  name: string;
  policy: DomainPolicy;
  allowedEmails: string[];
  blockedEmails: string[];
  newEmail: string;
  newBlockedEmail: string;
}

const { t } = useI18n();

// Dialog state for domain/email removal confirmations
const confirmRemoveDomainOpen = ref(false);
const pendingRemoveDomainIndex = ref<number | null>(null);
const confirmRemoveEmailOpen = ref(false);
const pendingRemoveEmail = ref<{ domain: any; emailIndex: number; email: string; blocked: boolean } | null>(null);
const store = useStore();
const router = useRouter();

const newDomain = ref("");
const domainError = ref("");
const domains = reactive<Domain[]>([]);
const saving = ref(false);

// Baseline snapshot of the persisted domain-restriction state. `isDirty` compares the current
// (normalized) config to this — set on load and after a successful save. Transient input fields
// (newEmail/newBlockedEmail) are excluded so typing doesn't mark the form dirty.
const savedSnapshot = ref("");
const domainSnapshot = (): string =>
  JSON.stringify(
    domains
      .map((d) => ({
        name: (d.name || "").toLowerCase(),
        policy: d.policy,
        allowedEmails: [...(d.allowedEmails || [])].sort(),
        blockedEmails: [...(d.blockedEmails || [])].sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
const isDirty = computed(() => domainSnapshot() !== savedSnapshot.value);

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

// Computed property to check if claim parser function value has changed.
// The field is pre-populated with the saved value, so Save stays disabled until
// the user picks a genuinely different function.
const hasClaimParserChanged = computed(() => {
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

    if (response.data) {
      // Decompose the flat backend model (domains + blocked_domains + blocked_emails) into one
      // per-domain card each, keyed by domain name. Policy precedence when a domain appears in
      // more than one list: block_all > block_specific > allow rules (block wins over allow).
      const byDomain = new Map<string, Domain>();
      const ensure = (name: string): Domain => {
        const key = name.toLowerCase();
        if (!byDomain.has(key)) {
          byDomain.set(key, {
            name,
            policy: "allow_all",
            allowedEmails: [],
            blockedEmails: [],
            newEmail: "",
            newBlockedEmail: "",
          });
        }
        return byDomain.get(key) as Domain;
      };

      // Allow rules
      (response.data.domains || [])
        .filter((d: any) => d && typeof d === "object" && d.domain)
        .forEach((d: any) => {
          const card = ensure(d.domain);
          card.policy = d.allow_all_users ? "allow_all" : "allow_specific";
          card.allowedEmails = d.allowed_emails || [];
        });

      // Blocked specific emails — grouped under their domain
      (response.data.blocked_emails || [])
        .filter((e: any) => typeof e === "string" && e.includes("@"))
        .forEach((email: string) => {
          const domainPart = email.split("@")[1];
          const card = ensure(domainPart);
          card.policy = "block_specific";
          card.blockedEmails.push(email.toLowerCase());
        });

      // Blocked whole domains — highest precedence
      (response.data.blocked_domains || [])
        .filter((d: any) => typeof d === "string" && d)
        .forEach((d: string) => {
          const card = ensure(d);
          card.policy = "block_all";
        });

      domains.splice(0, domains.length, ...Array.from(byDomain.values()));
    }

    // Pre-populate the OSelect with the saved value so the configured parser is
    // visible on load. Save stays disabled (hasClaimParserChanged) until the user
    // selects a different function.
    const storedFunction = store.state?.organizationData?.organizationSettings?.claim_parser_function || "";
    claimParserFunction.value = storedFunction;
    originalClaimParserFunction.value = storedFunction;
  } catch (error: any) {
    // If the API doesn't exist yet or returns an error, use example data
    console.warn("Domain restrictions API not available, using example data:", error);

    const existingDomains = [];

    domains.splice(0, domains.length, ...existingDomains);
  }

  // Capture the loaded state as the clean baseline → the form starts not-dirty.
  savedSnapshot.value = domainSnapshot();
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
    policy: "allow_all",
    allowedEmails: [],
    blockedEmails: [],
    newEmail: "",
    newBlockedEmail: ""
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

  // Stage the entry — persisted only when the user clicks Save. No success toast here so we don't
  // imply it's already saved.
  domain.allowedEmails.push(domain.newEmail.toLowerCase());
  domain.newEmail = "";
};

const removeEmail = (domain: Domain, emailIndex: number) => {
  pendingRemoveEmail.value = { domain, emailIndex, email: domain.allowedEmails[emailIndex], blocked: false };
  confirmRemoveEmailOpen.value = true;
};

const addBlockedEmail = (domain: Domain) => {
  if (!domain.newBlockedEmail || !isValidEmail(domain.newBlockedEmail, domain.name)) return;

  if (domain.blockedEmails.includes(domain.newBlockedEmail.toLowerCase())) {
    toast({
      variant: "error",
      message: t("settings.emailAlreadyExists"),
    });
    return;
  }

  // Stage the entry — persisted only on Save (avoid implying it's already saved).
  domain.blockedEmails.push(domain.newBlockedEmail.toLowerCase());
  domain.newBlockedEmail = "";
};

const removeBlockedEmail = (domain: Domain, emailIndex: number) => {
  pendingRemoveEmail.value = { domain, emailIndex, email: domain.blockedEmails[emailIndex], blocked: true };
  confirmRemoveEmailOpen.value = true;
};

const doRemoveEmail = () => {
  const pending = pendingRemoveEmail.value;
  if (!pending) return;
  const list = pending.blocked ? pending.domain.blockedEmails : pending.domain.allowedEmails;
  list.splice(pending.emailIndex, 1);
  pendingRemoveEmail.value = null;
  confirmRemoveEmailOpen.value = false;
};

// Load VRL functions from _meta org
const loadFunctions = async () => {
  try {
    loadingFunctions.value = true;
    const response = await jstransform.list(1, 10000, "name", false, "", store.state.zoConfig.meta_org);

    // Populate options. The model value (claimParserFunction) is set in loadDomainSettings;
    // here we only keep the change-detection baseline in sync.
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

    // Update original value after successful save so Save disables again
    originalClaimParserFunction.value = claimParserFunction.value || "";

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
      if (domain.policy === "allow_specific" && domain.allowedEmails.length === 0) {
        toast({
          variant: "error",
          message: t("settings.domainNeedsEmails", { domain: domain.name }),
        });
        saving.value = false;
        return;
      }
      if (domain.policy === "block_specific" && domain.blockedEmails.length === 0) {
        toast({
          variant: "error",
          message: t("settings.domainNeedsBlockedEmails", { domain: domain.name }),
        });
        saving.value = false;
        return;
      }
    }

    // Compose the flat backend model from the per-domain cards.
    const domainData: any = {
      // Allow rules → domains[]
      domains: domains
        .filter(d => d.policy === "allow_all" || d.policy === "allow_specific")
        .map(domain => ({
          domain: domain.name,
          allow_all_users: domain.policy === "allow_all",
          allowed_emails: domain.policy === "allow_specific" ? domain.allowedEmails : []
        })),
      // Whole-domain blocks → blocked_domains[]
      blocked_domains: domains
        .filter(d => d.policy === "block_all")
        .map(domain => domain.name),
      // Specific blocked users → flat blocked_emails[]
      blocked_emails: domains
        .filter(d => d.policy === "block_specific")
        .flatMap(domain => domain.blockedEmails)
    };

    // Save to backend API
    await domainManagement.updateDomainRestrictions(store.state.zoConfig.meta_org, domainData);

    toast({
      variant: "success",
      message: t("settings.domainSettingsSaved"),
    });

    // Persisted → this is now the clean baseline, so isDirty resets to false.
    savedSnapshot.value = domainSnapshot();

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

