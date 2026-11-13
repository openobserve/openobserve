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
  <!-- The Settings shell owns the header, scroll and gutter; the content just flows. -->
  <div class="domain_management flex flex-col gap-4">
    <OFormSection
      variant="plain"
      :title="t('settings.domainManagement.claimParserTitle')"
      :description="t('settings.domainManagement.claimParserSectionDesc')"
      data-test="domain-management-claim-parser-title"
    >
      <OSettingRow
        control-at="end"
        :loading="!loaded"
        :label="t('settings.domainManagement.claimParserLabel')"
        data-test="domain-management-claim-parser-row"
      >
        <template #description>
          {{
            t("settings.domainManagement.claimParserHelp", {
              product1: raw("VRL"),
              product2: raw("JavaScript"),
            })
          }}
          <button
            type="button"
            class="text-text-link focus-visible:outline-focus-ring-accent rounded-default cursor-pointer underline underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
            data-test="domain-management-claim-parser-help-btn"
            @click="showVrlInfo = true"
          >
            {{ t("settings.domainManagement.claimParserFormatLink") }}
          </button>
        </template>
        <OSelect
          v-model="claimParserFunction"
          :options="functionOptions"
          :aria-label="t('settings.domainManagement.claimParserLabel')"
          :placeholder="t('settings.domainManagement.claimParserPlaceholder')"
          searchable
          clearable
          :loading="loadingFunctions"
          data-test="domain-management-claim-parser-select"
        >
          <template #empty>
            <span>{{ t("settings.domainManagement.noFunctions") }}</span>
          </template>
        </OSelect>
      </OSettingRow>
    </OFormSection>

    <OFormSection
      variant="plain"
      :title="t('settings.domainManagement.restrictionsTitle')"
      :description="t('settings.domainManagement.restrictionsDesc')"
      data-test="domain-management-domain-restrictions-title"
    >
      <div class="flex flex-col gap-3">
        <div>
          <label
            :for="NEW_DOMAIN_INPUT_ID"
            class="o-input-label text-compact text-input-label-text mb-1 block leading-tight font-medium"
          >
            {{ t("settings.domainManagement.domainLabel") }}
          </label>
          <OForm
            ref="addDomainForm"
            :schema="addDomainSchema"
            :default-values="addDomainDefaults()"
            validate-on="leave"
            @submit="addDomain"
            v-slot="{ isSubmitting }"
            class="flex items-start gap-x-2"
          >
            <div class="w-field-width-md max-w-full min-w-0">
              <OFormInput
                :id="NEW_DOMAIN_INPUT_ID"
                data-test="domain-management-new-domain-input"
                name="newDomain"
                class="domain-input"
                :placeholder="t('settings.domainPlaceholder', { example: raw('example.com') })"
                :help-text="t('settings.domainHint', { at_sign: '@' })"
              />
            </div>
            <OButton
              data-test="domain-management-add-domain-btn"
              variant="outline"
              size="sm-action"
              type="submit"
              :loading="isSubmitting"
              >{{ t("settings.domainManagement.addDomain") }}
            </OButton>
          </OForm>
        </div>

        <p
          v-if="loaded && domains.length === 0"
          data-test="domain-management-no-domain-message"
          class="text-text-secondary text-xs"
        >
          {{ t("settings.domainManagement.noDomains") }}
        </p>
        <p v-else-if="domains.length > 0" class="text-text-secondary text-xs">
          {{ t("settings.domainConfiguredCount", { count: domains.length }) }}
        </p>

        <template v-for="(domain, index) in domains" :key="domain?.name || `domain-${index}`">
          <div
            v-if="domain && domain.name"
            class="border-border-default rounded-default flex flex-col gap-3 border p-3"
            :data-test="`domain-management-domain-card-${domain.name}`"
          >
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div
                :data-test="`domain-management-domain-name-${domain.name}`"
                class="text-text-heading min-w-40 flex-1 text-sm font-medium break-all"
              >
                {{ domain.name }}
              </div>
              <div class="w-field-width-md max-w-full">
                <OSelect
                  v-model="domain.policy"
                  :options="policyOptions"
                  :searchable="false"
                  :aria-label="
                    t('settings.domainManagement.accessFor', { domain: raw(domain.name) })
                  "
                  :data-test="`domain-management-policy-select-${domain.name}`"
                />
              </div>
              <OButton
                icon-left="close"
                variant="ghost-muted"
                size="icon-xs-sq"
                :aria-label="
                  t('settings.domainManagement.removeDomain', { domain: raw(domain.name) })
                "
                :data-test="`domain-management-remove-domain-btn-${domain.name}`"
                @click="removeDomain(index)"
              >
                <OTooltip
                  :content="
                    t('settings.domainManagement.removeDomain', { domain: raw(domain.name) })
                  "
                  side="top"
                />
              </OButton>
            </div>

            <p
              class="rounded-default px-2 py-1 text-xs"
              :class="
                isBlockPolicy(domain.policy)
                  ? 'bg-banner-error-soft-bg text-banner-error-soft-text'
                  : 'bg-banner-info-bg text-banner-info-text'
              "
              :data-test="`domain-management-policy-effect-${domain.name}`"
            >
              {{ t(POLICY_EFFECT_KEYS[domain.policy], { domain: raw("@" + domain.name) }) }}
            </p>

            <!-- Keyed by policy: allow and block keep separate drafts and separate form state. -->
            <div v-if="isListPolicy(domain.policy)" :key="domain.policy">
              <label
                :for="emailInputId(domain)"
                class="o-input-label text-compact text-input-label-text mb-1 block leading-tight font-medium"
              >
                {{ t("settings.domainManagement.emailLabel") }}
              </label>
              <OForm
                :ref="(el) => setListFormRef(domain, el)"
                :schema="getEmailSchema(domain.name)"
                :default-values="addEmailDefaults()"
                validate-on="leave"
                @submit="(v) => addListedEmail(domain, v.newEmail)"
                v-slot="{ isSubmitting }"
                class="flex items-start gap-x-2"
              >
                <div class="w-field-width-md max-w-full min-w-0">
                  <OFormInput
                    :id="emailInputId(domain)"
                    :data-test="`domain-management-${listKind(domain)}-email-input-${domain.name}`"
                    name="newEmail"
                    class="email-input"
                    :placeholder="
                      t('settings.emailPlaceholder', { domain: raw('@' + domain.name) })
                    "
                  />
                </div>
                <OButton
                  :data-test="
                    domain.policy === 'block_specific'
                      ? 'domain-management-block-email-btn'
                      : 'domain-management-add-email-btn'
                  "
                  variant="outline"
                  size="sm-action"
                  type="submit"
                  :loading="isSubmitting"
                  >{{ t("common.add") }}</OButton
                >
              </OForm>

              <ul v-if="listedEmails(domain).length > 0" class="mt-2 flex flex-wrap gap-2">
                <li
                  v-for="(email, emailIndex) in listedEmails(domain)"
                  :key="email"
                  class="border-border-default bg-surface-subtle rounded-default text-text-body inline-flex items-center gap-1 border py-0.5 ps-2 pe-0.5 text-xs"
                >
                  <span class="break-all">{{ email }}</span>
                  <OButton
                    icon-left="close"
                    variant="ghost-muted"
                    size="icon-xs-sq"
                    :aria-label="t('settings.domainManagement.removeEmail', { email: raw(email) })"
                    @click="
                      domain.policy === 'block_specific'
                        ? removeBlockedEmail(domain, emailIndex)
                        : removeEmail(domain, emailIndex)
                    "
                  />
                </li>
              </ul>
              <p v-else class="text-text-secondary mt-2 text-xs">
                {{ t("settings.domainManagement.noEmails") }}
              </p>
            </div>
          </div>
        </template>

        <p v-if="hasBlockPolicy" class="text-text-secondary text-xs">
          {{ t("settings.blockedUsersHint") }}
        </p>
      </div>
    </OFormSection>

    <Teleport defer :to="SAVE_BAR_SLOT">
      <OSaveBar
        class="px-page-edge"
        :loaded="loaded"
        :change-count="changeCount"
        :saving="saving || savingClaimParser"
        data-test="domain-management-save-bar"
        save-data-test="domain-management-save-changes-btn"
        discard-data-test="domain-management-discard-btn"
        @save="savePage"
        @discard="resetForm"
      />
    </Teleport>

    <ODrawer
      v-model:open="showVrlInfo"
      :title="t('settings.claimParserFunctionInfoTitle')"
      side="right"
      :width="40"
    >
      <div class="text-sm">
        <div class="rounded-default bg-surface-subtle mb-4 p-4">
          <div class="mb-2 font-medium">{{ t("settings.claimParserFunctionInputTitle") }}</div>
          <div>{{ t("settings.claimParserFunctionInputDescription") }}</div>
        </div>

        <div class="rounded-default bg-surface-subtle mb-4 p-4">
          <div class="mb-2 font-medium">{{ t("settings.claimParserFunctionOutputTitle") }}</div>
          <div class="mb-2">{{ t("settings.claimParserFunctionOutputDescription") }}</div>
          <div class="ms-4">
            <div class="mb-1">{{ t("settings.claimParserFunctionOutputExample1") }}</div>
            <div>{{ t("settings.claimParserFunctionOutputExample2") }}</div>
          </div>
        </div>

        <!-- Recent Errors Section -->
        <div
          v-if="claimParserFunction"
          class="rounded-default bg-surface-subtle border-s-status-negative border-s-3 p-4"
        >
          <div class="mb-2 flex items-center">
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

          <div v-if="loadingErrors" class="py-4 text-center">
            <OSpinner size="xs" />
          </div>

          <div v-else-if="recentErrors.length === 0" class="text-text-muted py-2 text-center">
            {{ t("settings.noRecentErrors") }}
          </div>

          <div v-else class="error-list max-h-100 overflow-y-auto">
            <div
              v-for="(error, index) in recentErrors.slice(0, 3)"
              :key="index"
              class="rounded-default bg-status-error-bg border-s-status-negative mb-1 border-s-2 p-2"
            >
              <div class="mb-1 flex items-start">
                <OIcon name="error" size="xs" class="me-1 mt-1" />
                <div class="flex-1">
                  <div class="text-xs font-medium">{{ error.error_type }}</div>
                  <div class="text-text-muted text-xs">
                    {{ formatTimestamp(error._timestamp) }}
                  </div>
                </div>
              </div>
              <div class="text-text-secondary text-xs wrap-break-word">{{ error.error }}</div>
            </div>

            <!-- Show More Button -->
            <div class="mt-2 text-center">
              <OTooltip :content="logsLock.lockedReason.value" :disabled="!logsLock.locked.value">
                <span class="inline-flex">
                  <OButton
                    :icon-left="logsLock.locked.value ? 'lock' : undefined"
                    :icon-right="logsLock.locked.value ? undefined : 'open-in-new'"
                    variant="ghost-primary"
                    size="sm"
                    :disabled="logsLock.locked.value"
                    data-test="domain-management-view-all-errors"
                    @click="viewAllErrors"
                  >
                    {{ t("common.showMore") }}
                  </OButton>
                </span>
              </OTooltip>
            </div>
          </div>
        </div>
      </div>
    </ODrawer>
  </div>

  <!-- Confirm remove domain dialog -->
  <ODialog
    v-model:open="confirmRemoveDomainOpen"
    size="sm"
    :title="t('common.confirm')"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('confirmDialog.ok')"
    primary-button-variant="destructive"
    @click:secondary="confirmRemoveDomainOpen = false"
    @click:primary="doRemoveDomain"
  >
    <i18n-t
      keypath="settings.confirmRemoveDomain"
      tag="p"
      data-test="domain-management-remove-domain-message"
    >
      <template #domain
        ><span class="text-text-heading font-semibold break-all">{{
          pendingRemoveDomainName
        }}</span></template
      >
    </i18n-t>
  </ODialog>

  <!-- Confirm remove email dialog -->
  <ODialog
    v-model:open="confirmRemoveEmailOpen"
    size="sm"
    :title="t('common.confirm')"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('confirmDialog.ok')"
    :primary-button-variant="shownRemoveEmail.blocked ? 'primary' : 'destructive'"
    @click:secondary="cancelRemoveEmail"
    @click:primary="doRemoveEmail"
  >
    <i18n-t
      :keypath="
        shownRemoveEmail.blocked
          ? 'settings.confirmRemoveBlockedEmail'
          : 'settings.confirmRemoveEmail'
      "
      tag="p"
      data-test="domain-management-remove-email-message"
    >
      <template #email
        ><span class="text-text-heading font-semibold break-all">{{
          shownRemoveEmail.email
        }}</span></template
      >
    </i18n-t>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onActivated, watch, computed } from "vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useLicenseLock } from "@/composables/useFeatureLock";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";

import domainManagement from "@/services/domainManagement";
import { useRouter } from "vue-router";
import { formatDistanceToNow } from "date-fns";
import jstransform from "@/services/jstransform";
import { updateOrgSettingsMutation } from "@/services/organizations.queries";
import { useMutation } from "@tanstack/vue-query";
import searchService from "@/services/search";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import OSaveBar from "@/lib/forms/SaveBar/OSaveBar.vue";
import { useLeaveGuard } from "@/lib/forms/SaveBar/useLeaveGuard";
import { SAVE_BAR_SLOT } from "./saveBarSlot";
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

const NEW_DOMAIN_INPUT_ID = "domain-management-new-domain";

const POLICY_EFFECT_KEYS: Record<DomainPolicy, I18nKey> = {
  allow_all: "settings.allUsersAllowedMessage",
  allow_specific: "settings.domainManagement.effectAllowSpecific",
  block_specific: "settings.domainManagement.effectBlockSpecific",
  block_all: "settings.allUsersBlockedMessage",
};

const { t } = useI18nTyped();

const policyOptions = [
  { label: t("settings.domainManagement.policyAllowAll"), value: "allow_all" },
  { label: t("settings.domainManagement.policyAllowSpecific"), value: "allow_specific" },
  { label: t("settings.domainManagement.policyBlockSpecific"), value: "block_specific" },
  { label: t("settings.domainManagement.policyBlockAll"), value: "block_all" },
];

const isBlockPolicy = (policy: DomainPolicy) =>
  policy === "block_specific" || policy === "block_all";
const isListPolicy = (policy: DomainPolicy) =>
  policy === "allow_specific" || policy === "block_specific";
const listKind = (domain: Domain) => (domain.policy === "block_specific" ? "block" : "allow");
const listedEmails = (domain: Domain) =>
  domain.policy === "block_specific" ? domain.blockedEmails : domain.allowedEmails;
const emailInputId = (domain: Domain) =>
  `domain-management-${listKind(domain)}-email-${domain.name}`;

// Dialog state for domain/email removal confirmations
const confirmRemoveDomainOpen = ref(false);
const pendingRemoveDomainIndex = ref<number | null>(null);
// Set on open and never cleared, so the closing fade keeps the name.
const pendingRemoveDomainName = ref("");
const confirmRemoveEmailOpen = ref(false);
const pendingRemoveEmail = ref<{
  domain: any;
  emailIndex: number;
  email: string;
  blocked: boolean;
} | null>(null);
// Display copy set on open and never cleared, so the fade keeps the text while pending is cleared.
const shownRemoveEmail = ref({ email: "", blocked: false });
const store = useStore();
const router = useRouter();
const logsLock = useLicenseLock("logs");

// Domain settings live on the meta org, not the selected one.
const updateMetaOrgSettings = useMutation(() =>
  updateOrgSettingsMutation(store.state.zoConfig.meta_org),
);

const domains = reactive<Domain[]>([]);
const saving = ref(false);
// False until the first load settles, so the bar cannot claim changes over placeholders.
const loaded = ref(false);
const hasBlockPolicy = computed(() => domains.some((d) => isBlockPolicy(d.policy)));

// Schema-driven validation (upstream): pure validators live in the schema file; the component only
// needs `isValidEmail` for the add guards, imported directly.
const addDomainForm = ref<any>(null);
const addDomainSchema = makeAddDomainSchema(t, (name) =>
  domains.some((d) => d.name.toLowerCase() === name.trim().toLowerCase()),
);

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
const setListFormRef = (domain: Domain, el: any) =>
  domain.policy === "block_specific"
    ? setBlockedEmailFormRef(domain.name, el)
    : setEmailFormRef(domain.name, el);
const addListedEmail = (domain: Domain, email?: string) =>
  domain.policy === "block_specific" ? addBlockedEmail(domain, email) : addEmail(domain, email);

// Baseline snapshot of the persisted domain-restriction state. `isDirty` compares the current
// (normalized) config to this — set on load and after a successful save.
const savedSnapshot = ref("[]");
const normalizedDomains = () =>
  domains
    .map((d) => ({
      name: (d.name || "").toLowerCase(),
      policy: d.policy,
      allowedEmails: [...(d.allowedEmails || [])].sort(),
      blockedEmails: [...(d.blockedEmails || [])].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
const domainSnapshot = (): string => JSON.stringify(normalizedDomains());
const isDirty = computed(() => domainSnapshot() !== savedSnapshot.value);

// One change per domain card that was added, removed or edited since the last load or save.
const changedDomainCount = computed(() => {
  if (!isDirty.value) return 0;
  const byName = (list: ReturnType<typeof normalizedDomains>) =>
    new Map(list.map((d) => [d.name, JSON.stringify(d)]));
  const saved = byName(JSON.parse(savedSnapshot.value));
  const current = byName(normalizedDomains());
  const names = new Set([...saved.keys(), ...current.keys()]);
  return [...names].filter((name) => saved.get(name) !== current.get(name)).length;
});

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

const changeCount = computed(
  () => (hasClaimParserChanged.value ? 1 : 0) + changedDomainCount.value,
);

onMounted(() => {
  if (store.state.zoConfig.meta_org == store.state.selectedOrganization.identifier) {
    loadDomainSettings();
    loadFunctions();
  } else {
    router.replace({
      name: "general",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
    });
  }
});

onActivated(() => {
  if (store.state.zoConfig.meta_org == store.state.selectedOrganization.identifier) {
    loadDomainSettings();
    loadFunctions();
  } else {
    router.replace({
      name: "general",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
      },
    });
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
    const storedFunction =
      store.state?.organizationData?.organizationSettings?.claim_parser_function || "";
    claimParserFunction.value = storedFunction;
    originalClaimParserFunction.value = storedFunction;
  } catch (error: any) {
    // If the API doesn't exist yet or returns an error, use example data
    console.warn("Domain restrictions API not available, using example data:", error);

    const existingDomains: Domain[] = [];

    domains.splice(0, domains.length, ...existingDomains);
  }

  // Capture the loaded state as the clean baseline → the form starts not-dirty.
  savedSnapshot.value = domainSnapshot();
  loaded.value = true;
};

// @submit handler — fires only once the schema passes (required + valid
// domain), so the old empty/invalid guards are gone. The submitted form value
// is the single source of truth; the cross-state duplicate check stays here.
const addDomain = (value?: AddDomainForm) => {
  const candidate = (value?.newDomain ?? "").trim();
  if (!candidate) return;

  // Check if domain already exists
  if (domains.some((d) => d.name.toLowerCase() === candidate.toLowerCase())) {
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
  pendingRemoveDomainName.value = domains[index]?.name ?? "";
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
  pendingRemoveEmail.value = {
    domain,
    emailIndex,
    email: domain.allowedEmails[emailIndex],
    blocked: false,
  };
  shownRemoveEmail.value = { email: domain.allowedEmails[emailIndex], blocked: false };
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
  pendingRemoveEmail.value = {
    domain,
    emailIndex,
    email: domain.blockedEmails[emailIndex],
    blocked: true,
  };
  shownRemoveEmail.value = { email: domain.blockedEmails[emailIndex], blocked: true };
  confirmRemoveEmailOpen.value = true;
};

const doRemoveEmail = () => {
  const pending = pendingRemoveEmail.value;
  if (!pending) return;
  const list = pending.blocked ? pending.domain.blockedEmails : pending.domain.allowedEmails;
  list.splice(pending.emailIndex, 1);
  // Cleared so a second OK click during the fade cannot splice the next email.
  pendingRemoveEmail.value = null;
  confirmRemoveEmailOpen.value = false;
};

const cancelRemoveEmail = () => {
  pendingRemoveEmail.value = null;
  confirmRemoveEmailOpen.value = false;
};

// Escape and the close button bypass cancelRemoveEmail, so they must drop the pending row too.
watch(confirmRemoveEmailOpen, (open) => {
  if (!open) pendingRemoveEmail.value = null;
});

// Load VRL functions from _meta org
const loadFunctions = async () => {
  try {
    loadingFunctions.value = true;
    const response = await jstransform.list(
      1,
      10000,
      "name",
      false,
      "",
      store.state.zoConfig.meta_org,
    );

    // Populate options. The model value (claimParserFunction) is set in loadDomainSettings;
    // here we only keep the change-detection baseline in sync.
    const storedFunction =
      store.state?.organizationData?.organizationSettings?.claim_parser_function || "";
    originalClaimParserFunction.value = storedFunction;

    allFunctions.value = response.data.list.map((fn: any) => fn.name);
    functionOptions.value = allFunctions.value;
  } catch (e: any) {
    console.error("Error loading functions:", e);
  } finally {
    loadingFunctions.value = false;
  }
};

// Returns whether the parser was saved; `quiet` leaves the success toast to the caller.
const saveClaimParserFunction = async ({ quiet = false } = {}): Promise<boolean> => {
  savingClaimParser.value = true;

  try {
    // Read once: a function picked while the request is pending was not sent and stays unsaved.
    const sentFunction = claimParserFunction.value || "";
    const orgSettingsPayload: any = {
      claim_parser_function: sentFunction,
    };

    await updateMetaOrgSettings.mutateAsync(orgSettingsPayload);

    // Update store with new settings
    const updatedSettings: any = {
      ...store.state?.organizationData?.organizationSettings,
      claim_parser_function: sentFunction,
    };
    store.dispatch("setOrganizationSettings", updatedSettings);

    // Update original value after successful save so Save disables again
    originalClaimParserFunction.value = sentFunction;

    if (!quiet) {
      toast({
        variant: "success",
        message: t("settings.claimParserFunctionSaved"),
      });
    }
    return true;
  } catch (error: any) {
    toast({
      variant: "error",
      message: error?.message || t("settings.errorSavingClaimParserFunction"),
    });
    return false;
  } finally {
    savingClaimParser.value = false;
  }
};

// Build SQL query for claim parser errors
const buildErrorsQuery = (functionName: string, limit?: number): string => {
  const limitClause = limit ? ` LIMIT ${limit}` : "";
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
      "ui",
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

// Returns whether the domains were saved; `quiet` leaves the success toast to the caller.
const saveChanges = async ({ quiet = false } = {}): Promise<boolean> => {
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
        return false;
      }
      if (domain.policy === "block_specific" && domain.blockedEmails.length === 0) {
        toast({
          variant: "error",
          message: t("settings.domainNeedsBlockedEmails", { domain: domain.name }),
        });
        saving.value = false;
        return false;
      }
    }

    // Compose the flat backend model from the per-domain cards.
    const domainData: any = {
      // Allow rules → domains[]
      domains: domains
        .filter((d) => d.policy === "allow_all" || d.policy === "allow_specific")
        .map((domain) => ({
          domain: domain.name,
          allow_all_users: domain.policy === "allow_all",
          allowed_emails: domain.policy === "allow_specific" ? domain.allowedEmails : [],
        })),
      // Whole-domain blocks → blocked_domains[]
      blocked_domains: domains.filter((d) => d.policy === "block_all").map((domain) => domain.name),
      // Specific blocked users → flat blocked_emails[]
      blocked_emails: domains
        .filter((d) => d.policy === "block_specific")
        .flatMap((domain) => domain.blockedEmails),
    };

    // Taken with the payload: cards edited while the request is pending stay unsaved.
    const sentSnapshot = domainSnapshot();

    // Save to backend API
    await domainManagement.updateDomainRestrictions(store.state.zoConfig.meta_org, domainData);

    if (!quiet) {
      toast({
        variant: "success",
        message: t("settings.domainSettingsSaved"),
      });
    }

    // Persisted → this is now the clean baseline, so isDirty resets to false.
    savedSnapshot.value = sentSnapshot;

    emit("saved", domains);
    return true;
  } catch (error: any) {
    toast({
      variant: "error",
      message: error?.message || t("settings.errorSavingDomainSettings"),
    });
    return false;
  } finally {
    saving.value = false;
  }
};

// Sends only the parts that changed. A failed part reports itself and stays counted in the bar.
const savePage = async () => {
  const parserChanged = hasClaimParserChanged.value;
  const domainsChanged = isDirty.value;
  const both = parserChanged && domainsChanged;
  // Started together so each request carries what Save was clicked on.
  const [parserSaved, domainsSaved] = await Promise.all([
    parserChanged && saveClaimParserFunction({ quiet: both }),
    domainsChanged && saveChanges({ quiet: both }),
  ]);
  if (!both) return;
  if (parserSaved && domainsSaved) {
    toast({ variant: "success", message: t("settings.domainManagement.saved") });
  } else if (parserSaved) {
    toast({ variant: "success", message: t("settings.claimParserFunctionSaved") });
  } else if (domainsSaved) {
    toast({ variant: "success", message: t("settings.domainSettingsSaved") });
  }
};

const resetForm = () => {
  // Reset the add-domain row through the form (clears the field + submit state),
  // keeping TanStack the single owner of that field — no parallel ref.
  addDomainForm.value?.form?.reset();
  for (const refs of [emailFormRefs.value, blockedEmailFormRefs.value]) {
    for (const form of Object.values(refs)) form?.form?.reset();
  }
  loadDomainSettings();
};

useLeaveGuard(() => changeCount.value > 0, {
  count: () => changeCount.value,
  onDiscard: resetForm,
});
</script>
