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
      <div class="text-sm text-text-secondary mb-3">
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
        <div class="text-sm">
          <div class="mb-4 p-4 rounded-default bg-surface-subtle">
            <div class="font-medium mb-2">{{ t("settings.claimParserFunctionInputTitle") }}</div>
            <div>{{ t("settings.claimParserFunctionInputDescription") }}</div>
          </div>

          <div class="mb-4 p-4 rounded-default bg-surface-subtle">
            <div class="font-medium mb-2">{{ t("settings.claimParserFunctionOutputTitle") }}</div>
            <div class="mb-2">{{ t("settings.claimParserFunctionOutputDescription") }}</div>
            <div class="ml-4">
              <div class="mb-1">{{ t("settings.claimParserFunctionOutputExample1") }}</div>
              <div>{{ t("settings.claimParserFunctionOutputExample2") }}</div>
            </div>
          </div>

          <!-- Recent Errors Section -->
          <div v-if="claimParserFunction" class="p-4 rounded-default border-l-[3px] bg-surface-subtle border-l-status-negative">
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

            <div v-else-if="recentErrors.length === 0" class="text-center py-2 text-text-muted">
              {{ t("settings.noRecentErrors") }}
            </div>

            <div v-else class="error-list max-h-100 overflow-y-auto">
              <div
                v-for="(error, index) in recentErrors.slice(0, 3)"
                :key="index"
                class="p-2 mb-1 rounded-default border-l-2 bg-status-error-bg border-l-status-negative"
              >
                <div class="flex items-start mb-1">
                  <OIcon name="error" size="xs" class="mr-1 mt-1" />
                  <div class="flex-1">
                    <div class="text-xs font-medium">{{ error.error_type }}</div>
                    <div class="text-xs text-text-muted">{{ formatTimestamp(error._timestamp) }}</div>
                  </div>
                </div>
                <div class="text-xs wrap-break-word text-text-secondary">{{ error.error }}</div>
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
    <div class="text-sm text-text-secondary mb-4">
      {{ t("settings.domainRestrictionsSubsectionDescription") }}
    </div>

    <!-- Domain Input Section -->
    <div class="mb-1">
      <div class="text-base font-bold mb-3">
        {{ t("settings.domainAndAllowedUsers") }}
      </div>
      
      <OForm
        ref="addDomainForm"
        :schema="addDomainSchema"
        :default-values="addDomainDefaults()"
        @submit="addDomain"
        v-slot="{ isSubmitting }"
        class="flex gap-x-2 items-start"
      >
          <div class="w-[18.75rem] shrink-0">
            <OFormInput
              data-test="domain-management-new-domain-input"
              name="newDomain"
              class="domain-input"
              :placeholder="t('settings.domainPlaceholder')"
            />
          </div>
          <OButton
            data-test="domain-management-add-domain-btn"
            variant="primary"
            size="sm-action"
            type="submit"
            :loading="isSubmitting"
          >{{ t('settings.addDomain') }}
          </OButton>
      </OForm>
      <div class="text-xs text-text-secondary mt-1">
        {{ t('settings.domainHint', { at_sign: '@' }) }}
      </div>

      <div class="text-xs text-text-secondary mt-1 mb-3" v-if="domains.length > 0">
        {{ t("settings.domainConfiguredCount", { count: domains.length }) }}
      </div>
    </div>

    <!-- Domain List -->
    <div v-if="domains.length > 0" class="mb-4">
      <template v-for="(domain, index) in domains" :key="domain?.name || `domain-${index}`">
        <div
          v-if="domain && domain.name"
          class="mb-1 border border-border-default rounded-default bg-surface-base"
        >
          <div class="flex items-center justify-between px-3 py-2 border-b border-b-border-default rounded-t-default bg-surface-subtle">
          <div
            :data-test="`domain-management-domain-name-${domain.name}`"
            class="text-base font-bold"
          >{{ domain.name }}</div>
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
            class="p-2 rounded-default mb-3 bg-status-info-bg text-status-info-text"
          >
            {{ t("settings.allUsersAllowedMessage", { domain: '@'+domain.name }) }}
          </div>

          <!-- Info message for whole-domain block -->
          <div
            v-if="domain.policy === 'block_all'"
            class="p-2 rounded-default mb-3 bg-status-error-bg text-status-error-text"
          >
            {{ t("settings.allUsersBlockedMessage", { domain: '@'+domain.name }) }}
          </div>

          <!-- Specific allowed users section -->
          <div v-if="domain.policy === 'allow_specific'" class="specific-users-section ml-6">
              <OForm
                :ref="(el) => setEmailFormRef(domain.name, el)"
                :schema="getEmailSchema(domain.name)"
                :default-values="addEmailDefaults()"
                @submit="(v) => addEmail(domain, v.newEmail)"
                v-slot="{ isSubmitting }"
              >
                <!-- Hint label above the row, so the error can grow below the
                     input without shoving the Add button out of alignment. -->
                <div class="o-input-label text-compact font-medium leading-tight text-input-label-text mb-1">
                  {{ t('settings.emailPlaceholder', { domain: '@' + domain.name }) }}
                </div>
                <div class="flex gap-x-2 items-start">
                  <OFormInput
                    :data-test="`domain-management-allow-email-input-${domain.name}`"
                    name="newEmail"
                    class="email-input min-w-62.5"
                  />
                  <OButton
                    data-test="domain-management-add-email-btn"
                    variant="primary"
                    size="sm-action"
                    type="submit"
                    :loading="isSubmitting"
                  >{{ t('settings.addEmail') }}</OButton>
                </div>
              </OForm>

            <!-- Allowed Email List -->
            <div v-if="domain.allowedEmails && domain.allowedEmails.length > 0" class="mt-1">
              <div
                v-for="(email, emailIndex) in domain.allowedEmails"
                :key="email"
                class="flex items-center justify-between p-2 mb-1 rounded-default border border-border-default bg-surface-subtle"
              >
                <div class="text-sm">{{ email }}</div>
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

          <!-- Specific blocked users section (mirrors the allow-email OForm pattern) -->
          <div v-if="domain.policy === 'block_specific'" class="specific-users-section ml-6">
              <OForm
                :ref="(el) => setBlockedEmailFormRef(domain.name, el)"
                :schema="getEmailSchema(domain.name)"
                :default-values="addEmailDefaults()"
                @submit="(v) => addBlockedEmail(domain, v.newEmail)"
                v-slot="{ isSubmitting }"
              >
                <div class="o-input-label text-compact font-medium leading-tight text-input-label-text mb-1">
                  {{ t('settings.blockedEmailPlaceholder', { domain: '@' + domain.name }) }}
                </div>
                <div class="flex gap-x-2 items-start">
                  <OFormInput
                    :data-test="`domain-management-block-email-input-${domain.name}`"
                    name="newEmail"
                    class="email-input min-w-62.5"
                  />
                  <OButton
                    data-test="domain-management-block-email-btn"
                    variant="destructive"
                    size="sm-action"
                    type="submit"
                    :loading="isSubmitting"
                  >{{ t('settings.addBlockedEmail') }}</OButton>
                </div>
              </OForm>

            <!-- Blocked Email List -->
            <div v-if="domain.blockedEmails && domain.blockedEmails.length > 0" class="mt-1">
              <div
                v-for="(email, emailIndex) in domain.blockedEmails"
                :key="email"
                class="flex items-center justify-between p-2 mb-1 rounded-default border bg-banner-error-soft-bg border-banner-error-soft-border"
              >
                <div class="text-sm">{{ email }}</div>
                <OButton
                  icon-left="close"
                  variant="ghost-destructive"
                  size="icon-xs-sq"
                  @click="removeBlockedEmail(domain, emailIndex)"
                  :title="t('common.delete')"
                />
              </div>
            </div>
          </div>

          <!-- Hint for any block policy -->
          <div
            v-if="domain.policy === 'block_specific' || domain.policy === 'block_all'"
            class="text-xs text-text-secondary mt-3"
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
      class="text-xl font-semibold text-text-muted mt-3 mb-4 w-full text-center p-4 border border-border-default rounded-default bg-surface-base"
    >
      {{ t("settings.noDomainMessage") }}
    </div>

  </div>
    <!-- Action Buttons — flow inline at the end of the constrained column. -->
    <div class="flex items-center justify-between gap-2 pt-4 mt-2 border-t border-card-glass-border">
      <!-- Unsaved-changes indicator: makes it obvious the in-card edits (domains, policies,
           allow/block emails) are staged until Save is clicked. -->
      <div
        v-if="isDirty"
        data-test="domain-management-unsaved-indicator"
        class="flex items-center gap-2 text-sm text-text-muted"
       
      >
        <span
          class="inline-block w-2 h-2 rounded-full shrink-0 bg-accent"
         
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
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
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
import {
  isValidEmail,
  makeAddDomainSchema,
  makeAddEmailSchema,
  addDomainDefaults,
  addEmailDefaults,
  type AddDomainForm,
} from "./DomainManagement.schema";

type DomainPolicy = "allow_all" | "allow_specific" | "block_specific" | "block_all";

interface Domain {
  name: string;
  policy: DomainPolicy;
  allowedEmails: string[];
  blockedEmails: string[];
}

const { t } = useI18n();

// Dialog state for domain/email removal confirmations
const confirmRemoveDomainOpen = ref(false);
const pendingRemoveDomainIndex = ref<number | null>(null);
const confirmRemoveEmailOpen = ref(false);
const pendingRemoveEmail = ref<{ domain: any; emailIndex: number; email: string; blocked: boolean } | null>(null);
const store = useStore();
const router = useRouter();

const domains = reactive<Domain[]>([]);
const saving = ref(false);

// Schema-driven validation (upstream): pure validators live in the schema file; the component only
// needs `isValidEmail` for the add guards, imported directly.
const addDomainForm = ref<any>(null);
const addDomainSchema = makeAddDomainSchema(t);

// Per-domain email add-row forms: a schema cache (keyed by domain name, since the email schema
// embeds the domain) + ref maps so each row can be reset after a successful add. The blocklist adds
// a parallel set of refs for the block-email add-row (same schema — the email must belong to the
// domain — but an independent form instance).
const emailSchemaCache = new Map<string, ReturnType<typeof makeAddEmailSchema>>();
const getEmailSchema = (domainName: string) => {
  if (!emailSchemaCache.has(domainName)) {
    emailSchemaCache.set(domainName, makeAddEmailSchema(domainName, t));
  }
  return emailSchemaCache.get(domainName);
};
const emailFormRefs = ref<Record<string, any>>({});
const setEmailFormRef = (domainName: string, el: any) => {
  if (el) emailFormRefs.value[domainName] = el;
  else delete emailFormRefs.value[domainName];
};
const blockedEmailFormRefs = ref<Record<string, any>>({});
const setBlockedEmailFormRef = (domainName: string, el: any) => {
  if (el) blockedEmailFormRefs.value[domainName] = el;
  else delete blockedEmailFormRefs.value[domainName];
};

// Baseline snapshot of the persisted domain-restriction state. `isDirty` compares the current
// (normalized) config to this — set on load and after a successful save.
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

// @submit handler — fires only once the schema passes (required + valid
// domain), so the old empty/invalid guards are gone. The submitted form value
// is the single source of truth; the cross-state duplicate check stays here.
const addDomain = (value?: AddDomainForm) => {
  const candidate = (value?.newDomain ?? "").trim();
  if (!candidate) return;

  // Check if domain already exists
  if (domains.some(d => d.name.toLowerCase() === candidate.toLowerCase())) {
    toast({
      variant: "error",
      message: t("settings.domainAlreadyExists"),
    });
    return;
  }

  domains.push({
    name: candidate,
    policy: "allow_all",
    allowedEmails: [],
    blockedEmails: [],
  });

  // Inline add-row cleared after save → reset() clears the field AND submit
  // state (submissionAttempts → 0), so no post-save "required" flash.
  addDomainForm.value?.form?.reset();
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

// @submit handler for a domain's email add-row. The schema is conditional
// (empty passes), so an empty submit is a no-op; otherwise the email must be
// valid + belong to the domain. Still callable directly with the row model.
const addEmail = (domain: Domain, emailValue?: string) => {
  const email = (emailValue ?? "").trim();
  if (!email || !isValidEmail(email, domain.name)) return;

  // Check if email already exists
  if (domain.allowedEmails.includes(email.toLowerCase())) {
    toast({
      variant: "error",
      message: t("settings.emailAlreadyExists"),
    });
    return;
  }

  // Staged until Save — reset the row's form field, but no "saved" toast (the unsaved-changes
  // indicator + enabled Save button already signal there are pending changes).
  domain.allowedEmails.push(email.toLowerCase());
  emailFormRefs.value[domain.name]?.form?.reset();
};

const removeEmail = (domain: Domain, emailIndex: number) => {
  pendingRemoveEmail.value = { domain, emailIndex, email: domain.allowedEmails[emailIndex], blocked: false };
  confirmRemoveEmailOpen.value = true;
};

// @submit handler for a domain's block-email add-row — mirrors addEmail (schema-validated, then
// reset the row's form). The blocked email must be valid + belong to the domain.
const addBlockedEmail = (domain: Domain, emailValue?: string) => {
  const email = (emailValue ?? "").trim();
  if (!email || !isValidEmail(email, domain.name)) return;

  if (domain.blockedEmails.includes(email.toLowerCase())) {
    toast({
      variant: "error",
      message: t("settings.emailAlreadyExists"),
    });
    return;
  }

  // Staged until Save (see addEmail) — reset the row's form field, no "saved" toast.
  domain.blockedEmails.push(email.toLowerCase());
  blockedEmailFormRefs.value[domain.name]?.form?.reset();
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
    return t("settings.domainManagement.unknownTime");
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
  // Reset the add-domain row through the form (clears the field + submit state),
  // keeping TanStack the single owner of that field — no parallel ref.
  addDomainForm.value?.form?.reset();
  loadDomainSettings();
};
</script>
