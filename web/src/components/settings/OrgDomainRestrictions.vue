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
  <div data-test="settings-org-domain-restrictions">
    <div class="mb-3">
      <div class="text-xl font-semibold">{{ t("settings.domainRestrictionsSubsection") }}</div>
      <div class="text-text-secondary text-sm">
        {{ t("settings.orgDomainMapping.restrictionsSubtitle") }}
      </div>
    </div>

    <OForm
      ref="addDomainForm"
      :schema="addDomainSchema"
      :default-values="addDomainDefaults()"
      class="flex items-start gap-x-2"
      @submit="addDomain"
    >
      <div class="w-75 shrink-0 max-md:w-auto max-md:min-w-0 max-md:flex-1">
        <OFormInput
          data-test="settings-org-domain-restrictions-domain-input"
          name="newDomain"
          :placeholder="t('settings.domainPlaceholder', { example: raw('example.com') })"
        />
      </div>
      <OButton
        data-test="settings-org-domain-restrictions-add-domain-btn"
        variant="outline"
        size="sm-action"
        type="submit"
        >{{ t("settings.addDomain") }}</OButton
      >
    </OForm>
    <div class="text-text-secondary mt-1 mb-3 text-xs">
      {{ t("settings.domainHint", { at_sign: "@" }) }}
    </div>

    <div v-if="cards.length > 0" class="flex flex-col gap-2">
      <div
        v-for="(card, index) in cards"
        :key="card.name"
        :data-test="`settings-org-domain-restrictions-card-${card.name}`"
        class="border-border-default rounded-surface bg-surface-base border"
      >
        <div
          class="border-b-border-default rounded-t-surface bg-surface-subtle flex items-center justify-between border-b px-3 py-2"
        >
          <div class="text-sm font-semibold">{{ card.name }}</div>
          <OButton
            icon-left="close"
            variant="ghost-destructive"
            size="icon-xs-sq"
            :title="t('common.delete')"
            :data-test="`settings-org-domain-restrictions-remove-${card.name}`"
            @click="removeDomain(index)"
          />
        </div>
        <div class="flex flex-col gap-3 p-3">
          <ORadioGroup v-model="card.policy" orientation="vertical">
            <ORadio
              v-for="option in POLICY_OPTIONS"
              :key="option.value"
              :val="option.value"
              :label="t(option.labelKey, { domain: '@' + card.name })"
              :data-test="`settings-org-domain-restrictions-${option.value}-${card.name}`"
            />
          </ORadioGroup>

          <div
            v-if="card.policy === 'allow_all'"
            class="rounded-default bg-status-info-bg text-status-info-text p-2 text-sm"
          >
            {{ t("settings.allUsersAllowedMessage", { domain: "@" + card.name }) }}
          </div>
          <div
            v-if="card.policy === 'block_all'"
            class="rounded-default bg-status-error-bg text-status-error-text p-2 text-sm"
          >
            {{ t("settings.allUsersBlockedMessage", { domain: "@" + card.name }) }}
          </div>

          <div
            v-for="kind in emailKinds(card.policy)"
            :key="kind"
            :data-test="`settings-org-domain-restrictions-${kind}-emails-${card.name}`"
            class="ms-6 max-md:ms-0"
          >
            <OForm
              :key="`${card.name}-${card.policy}-${kind}`"
              :ref="(el) => setEmailFormRef(`${card.name}-${kind}`, el)"
              :schema="getEmailSchema(card.name)"
              :default-values="addEmailDefaults()"
              @submit="(v) => addEmail(card, kind, v.newEmail)"
            >
              <div class="text-input-label-text mb-1 text-sm font-medium">
                {{
                  kind === "allowed"
                    ? t("settings.emailPlaceholder", { domain: "@" + card.name })
                    : t("settings.blockedEmailPlaceholder", { domain: "@" + card.name })
                }}
              </div>
              <div class="flex items-start gap-x-2">
                <OFormInput
                  :data-test="`settings-org-domain-restrictions-${kind}-email-input-${card.name}`"
                  name="newEmail"
                  class="min-w-62.5 max-md:min-w-0 max-md:flex-1"
                />
                <OButton
                  :data-test="`settings-org-domain-restrictions-add-${kind}-email-${card.name}`"
                  :variant="kind === 'allowed' ? 'primary' : 'destructive'"
                  size="sm-action"
                  type="submit"
                  >{{
                    kind === "allowed" ? t("settings.addEmail") : t("settings.addBlockedEmail")
                  }}</OButton
                >
              </div>
            </OForm>
            <div
              v-if="kind === 'allowed' && card.allowedEmails.length === 0"
              :data-test="`settings-org-domain-restrictions-no-allowed-${card.name}`"
              class="rounded-default bg-status-warning-bg text-status-warning-text mt-1 p-2 text-sm"
            >
              {{ t("settings.noAllowedEmailsDenyAll", { domain: "@" + card.name }) }}
            </div>
            <div
              v-for="(email, emailIndex) in emailList(card, kind)"
              :key="email"
              class="rounded-default border-border-default bg-surface-subtle mt-1 flex items-center justify-between border p-2"
            >
              <div class="text-sm">{{ email }}</div>
              <OButton
                icon-left="close"
                variant="ghost-destructive"
                size="icon-xs-sq"
                :title="t('common.delete')"
                @click="emailList(card, kind).splice(emailIndex, 1)"
              />
            </div>
          </div>

          <div
            v-if="!isAllowPolicy(card.policy) || card.blockedEmails.length > 0"
            class="text-text-secondary text-xs"
          >
            {{ t("settings.blockedUsersHint") }}
          </div>
        </div>
      </div>
    </div>
    <div
      v-else
      data-test="settings-org-domain-restrictions-empty"
      class="text-text-secondary border-border-default rounded-surface border py-6 text-center text-sm"
    >
      {{ t("settings.noDomainMessage") }}
    </div>

    <div class="mt-3 flex items-center justify-between gap-2">
      <div
        v-if="isDirty"
        data-test="settings-org-domain-restrictions-unsaved"
        class="text-text-secondary flex items-center gap-2 text-sm"
      >
        <span class="bg-accent inline-block h-2 w-2 shrink-0 rounded-full"></span>
        {{ t("common.unsavedChanges") }}
      </div>
      <div v-else></div>
      <div class="flex gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="!isDirty || saving"
          data-test="settings-org-domain-restrictions-cancel-btn"
          @click="reset"
          >{{ t("common.cancel") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm-action"
          :loading="saving"
          :disabled="!isDirty"
          data-test="settings-org-domain-restrictions-save-btn"
          @click="save"
          >{{ t("settings.saveChanges") }}</OButton
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { updateOrgSettingsMutation } from "@/services/organizations.queries";
import {
  addDomainDefaults,
  addEmailDefaults,
  makeAddDomainSchema,
  makeAddEmailSchema,
  type AddDomainForm,
} from "./DomainManagement.schema";
import {
  cardsSnapshot,
  cardsToConfig,
  configToCards,
  isAllowPolicy,
  type DomainManagementConfig,
  type RestrictionCard,
  type RestrictionPolicy,
} from "./orgDomainRestrictions";

const props = defineProps<{ orgId: string; config?: Partial<DomainManagementConfig> }>();

const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();

const POLICY_OPTIONS = [
  { value: "allow_all", labelKey: "settings.allowAllUsersFromDomain" },
  { value: "allow_specific", labelKey: "settings.allowOnlySpecificUsers" },
  { value: "block_specific", labelKey: "settings.blockSpecificUsers" },
  { value: "block_all", labelKey: "settings.blockAllUsersFromDomain" },
] as const;

const updateSettings = useMutation(() => updateOrgSettingsMutation(props.orgId));

const cards = reactive<RestrictionCard[]>(configToCards(props.config));
const savedSnapshot = ref(cardsSnapshot(cards));
const isDirty = computed(() => cardsSnapshot(cards) !== savedSnapshot.value);
const saving = ref(false);

const addDomainForm = ref<any>(null);
const addDomainSchema = makeAddDomainSchema(t);

const emailSchemaCache = new Map<string, ReturnType<typeof makeAddEmailSchema>>();
const getEmailSchema = (domain: string) => {
  if (!emailSchemaCache.has(domain)) emailSchemaCache.set(domain, makeAddEmailSchema(domain, t));
  return emailSchemaCache.get(domain);
};

const emailFormRefs: Record<string, any> = {};
const setEmailFormRef = (key: string, el: any) => {
  if (el) emailFormRefs[key] = el;
  else delete emailFormRefs[key];
};

type EmailKind = "allowed" | "blocked";

const emailKinds = (policy: RestrictionPolicy): EmailKind[] => {
  if (policy === "allow_specific") return ["allowed", "blocked"];
  if (policy === "block_all") return [];
  return ["blocked"];
};

const emailList = (card: RestrictionCard, kind: EmailKind) =>
  kind === "allowed" ? card.allowedEmails : card.blockedEmails;

function addDomain(value?: AddDomainForm) {
  const name = (value?.newDomain ?? "").trim().toLowerCase();
  if (!name) return;
  if (cards.some((c) => c.name === name)) {
    toast({ variant: "error", message: t("settings.domainAlreadyExists") });
    return;
  }
  cards.push({ name, policy: "allow_all", allowedEmails: [], blockedEmails: [] });
  addDomainForm.value?.form?.reset();
}

async function removeDomain(index: number) {
  const ok = await confirm({
    title: t("common.confirm"),
    message: t("settings.confirmRemoveDomain", { domain: cards[index].name }),
  });
  if (ok) cards.splice(index, 1);
}

function addEmail(card: RestrictionCard, kind: EmailKind, value?: string) {
  const email = (value ?? "").trim().toLowerCase();
  if (!email) return;
  const list = emailList(card, kind);
  if (list.includes(email)) {
    toast({ variant: "error", message: t("settings.emailAlreadyExists") });
    return;
  }
  list.push(email);
  emailFormRefs[`${card.name}-${kind}`]?.form?.reset();
}

function reset() {
  cards.splice(0, cards.length, ...configToCards(props.config));
}

async function save() {
  for (const card of cards) {
    if (card.policy === "block_specific" && card.blockedEmails.length === 0) {
      toast({
        variant: "error",
        message: t("settings.domainNeedsBlockedEmails", { domain: card.name }),
      });
      return;
    }
  }
  saving.value = true;
  try {
    await updateSettings.mutateAsync({ domain_management_config: cardsToConfig(cards) });
    savedSnapshot.value = cardsSnapshot(cards);
    toast({ variant: "success", message: t("settings.domainSettingsSaved") });
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        raw(err?.response?.data?.message || err?.message) ||
        t("settings.errorSavingDomainSettings"),
    });
  } finally {
    saving.value = false;
  }
}
</script>
