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

<!-- Claim, verify, and release custom domains for a status page. Each row follows the
     server's serving_state, reason and warning, never verification_state alone. -->
<template>
  <ODialog
    :open="open"
    size="md"
    :title="t('statusPages.domains.title', { name: pageName })"
    :secondary-button-label="t('common.close')"
    data-test="status-page-domains-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <div class="flex items-end gap-2">
          <OInput
            v-model="newDomain"
            class="flex-1"
            :label="t('statusPages.domains.addLabel')"
            :placeholder="t('statusPages.domains.addPlaceholder')"
            :disabled="addBlockedByPlan"
            data-test="status-page-domain-input"
            @keydown.enter="addDomain"
          />
          <OButton
            variant="primary"
            :disabled="addBlockedByPlan || !newDomain.trim() || adding"
            data-test="status-page-domain-add-btn"
            @click="addDomain"
          >
            {{ t("statusPages.domains.addButton") }}
          </OButton>
        </div>
        <div
          v-if="addBlockedByPlan"
          class="flex flex-wrap items-center gap-2"
          data-test="status-page-domain-add-upgrade"
        >
          <span class="text-text-secondary text-sm">
            {{ t("statusPages.domains.addPlanRequired") }}
          </span>
          <router-link
            :to="plansRoute"
            class="text-accent text-sm hover:underline"
            data-test="status-page-domain-add-upgrade-btn"
          >
            {{ t("billing.upgradeNow") }}
          </router-link>
        </div>
      </div>

      <div v-if="loading" class="flex justify-center py-8">
        <OSpinner />
      </div>
      <p v-else-if="domains.length === 0" class="text-text-secondary py-8 text-center text-sm">
        {{ t("statusPages.domains.empty") }}
      </p>
      <div
        v-for="d in domains"
        v-else
        :key="d.id"
        class="border-border-subtle rounded-default flex flex-col gap-2 border p-3"
        :data-test="`status-page-domain-row-${d.id}`"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium">{{ raw(d.domain) }}</span>
            <OBadge
              :variant="domainStateBadge(d.serving_state).variant"
              size="sm"
              :data-test="`status-page-domain-state-${d.id}`"
            >
              {{ stateLabel(d) }}
            </OBadge>
          </div>
          <div class="flex items-center gap-1">
            <OButton
              v-if="d.serving_state === 'pending'"
              variant="ghost"
              size="icon-xs"
              icon-left="refresh"
              :disabled="verifyingId === d.id"
              :data-test="`status-page-domain-verify-${d.id}`"
              @click="verifyDomain(d)"
            >
              <OTooltip side="bottom" :content="t('statusPages.domains.verifyNow')" />
            </OButton>
            <OButton
              v-if="d.serving_state !== 'expired'"
              variant="ghost"
              size="icon-xs"
              icon-left="delete"
              :data-test="`status-page-domain-delete-${d.id}`"
              @click="confirmDelete(d)"
            >
              <OTooltip side="bottom" :content="t('common.delete')" />
            </OButton>
          </div>
        </div>

        <p
          v-if="d.serving_state === 'expired'"
          class="text-text-secondary text-sm"
          :data-test="`status-page-domain-expired-${d.id}`"
        >
          {{ t("statusPages.domains.expiredNote") }}
        </p>

        <template v-else>
          <div
            v-if="reasonText(d)"
            class="flex flex-wrap items-center gap-2"
            :data-test="`status-page-domain-reason-${d.id}`"
          >
            <span class="text-text-secondary text-sm">{{ reasonText(d) }}</span>
            <router-link
              v-if="d.serving_state === 'not_serving' && d.reason === 'plan_required'"
              :to="plansRoute"
              class="text-accent text-sm hover:underline"
              :data-test="`status-page-domain-upgrade-btn-${d.id}`"
            >
              {{ t("billing.upgradeNow") }}
            </router-link>
          </div>

          <OBanner
            v-if="
              d.serving_state === 'verified' &&
              d.reason === 'proxy_mode' &&
              d.warning === 'txt_missing'
            "
            variant="warning"
            icon="warning"
            dense
            :data-test="`status-page-domain-warning-${d.id}`"
          >
            {{ t("statusPages.domains.txtMissingWarning") }}
          </OBanner>

          <div
            v-if="d.txt_name && d.verification_token"
            class="flex flex-col gap-2"
            :data-test="`status-page-domain-record-${d.id}`"
          >
            <span class="text-text-heading text-sm font-medium">
              {{ t("statusPages.domains.recordInstructions") }}
            </span>

            <div class="flex flex-col gap-1">
              <span class="text-text-label text-2xs font-medium">
                {{ t("statusPages.domains.txtNameLabel") }}
              </span>
              <div class="flex min-w-0 items-center gap-1">
                <OCode truncate class="min-w-0">{{ raw(d.txt_name) }}</OCode>
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  icon-left="content-copy"
                  :data-test="`status-page-domain-copy-txt-name-${d.id}`"
                  @click="copyTxtName(d)"
                >
                  <OTooltip side="bottom" :content="t('statusPages.domains.copyTxtName')" />
                </OButton>
              </div>
            </div>

            <div class="flex flex-col gap-1">
              <span class="text-text-label text-2xs font-medium">
                {{ t("statusPages.domains.txtValueLabel") }}
              </span>
              <div class="flex min-w-0 items-center gap-1">
                <OCode truncate class="min-w-0">{{ raw(d.verification_token) }}</OCode>
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  icon-left="content-copy"
                  :data-test="`status-page-domain-copy-txt-value-${d.id}`"
                  @click="copyTxtValue(d)"
                >
                  <OTooltip side="bottom" :content="t('statusPages.domains.copyTxtValue')" />
                </OButton>
              </div>
            </div>

            <span
              class="text-text-secondary text-sm"
              :data-test="`status-page-domain-keep-record-${d.id}`"
            >
              {{ t("statusPages.domains.keepRecord") }}
            </span>
          </div>

          <span
            v-if="d.cname_target"
            class="text-text-secondary text-sm"
            :data-test="`status-page-domain-cname-${d.id}`"
          >
            {{
              t("statusPages.domains.cnameInstruction", {
                domain: d.domain,
                target: d.cname_target,
              })
            }}
          </span>

          <template v-if="d.serving_state === 'pending'">
            <span
              v-if="d.expires_at"
              class="text-text-secondary text-sm"
              :data-test="`status-page-domain-expires-${d.id}`"
            >
              {{ t("statusPages.domains.expiresAt", { date: formatTime(d.expires_at) }) }}
            </span>
            <span class="text-text-secondary text-sm">
              {{ t("statusPages.domains.nextStepVerify", { seconds: verifyIntervalSeconds }) }}
            </span>
          </template>
        </template>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import config from "@/aws-exports";
import { copyToClipboard } from "@/utils/clipboard";
import { formatTimestampInTimezone } from "@/utils/date";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import statusPagesService, { type StatusPageDomain } from "@/services/status_pages";
import { domainStateBadge } from "./statusPageBadges";

const props = defineProps<{
  open: boolean;
  orgIdentifier: string;
  pageId: string;
  pageName: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();
const store = useStore();

const domains = ref<StatusPageDomain[]>([]);
const loading = ref(false);
const adding = ref(false);
const verifyingId = ref<string | null>(null);
const newDomain = ref("");

// Mirrors ZO_STATUS_PAGE_DOMAIN_VERIFY_INTERVAL's server-side default; the
// backend exposes no endpoint for it, so an operator override drifts from this.
const verifyIntervalSeconds = 30;

// The message for each state and reason; any other pair shows no line.
const REASON_KEYS = new Map<string, I18nKey>([
  ["pending:record_missing", "statusPages.domains.reason.recordMissing"],
  ["pending:value_mismatch", "statusPages.domains.reason.valueMismatch"],
  ["pending:dns_lookup_failed", "statusPages.domains.reason.dnsLookupFailed"],
  ["pending:held_by_another_org", "statusPages.domains.reason.heldByAnotherOrg"],
  ["pending:proof_lost", "statusPages.domains.reason.proofLost"],
  ["not_serving:org_blocked", "statusPages.domains.reason.orgBlocked"],
  ["not_serving:not_licensed", "statusPages.domains.reason.notLicensed"],
  ["not_serving:plan_required", "statusPages.domains.reason.planRequired"],
  ["verified:cloud_not_enabled", "statusPages.domains.reason.cloudNotEnabled"],
  ["verified:proxy_mode", "statusPages.domains.reason.proxyMode"],
]);

// Block only a Cloud org positively on the free plan; the client cannot know the server's
// rule, so every other case, an empty plan included, is left to the server.
const addBlockedByPlan = computed(
  () =>
    config.isCloud === "true" &&
    store.state.selectedOrganization?.subscription_type === config.freePlan,
);

function formatTime(us: number) {
  return formatTimestampInTimezone(us, "YYYY-MM-DD HH:mm", store.state.timezone || "UTC");
}

function stateLabel(d: StatusPageDomain) {
  const { labelKey } = domainStateBadge(d.serving_state);
  return labelKey ? t(labelKey) : raw(d.serving_state);
}

function reasonText(d: StatusPageDomain) {
  if (!d.reason) return null;
  const since = d.evidence?.proof_failed_since;
  if (d.serving_state === "pending" && d.reason === "proof_lost" && since) {
    return t("statusPages.domains.reason.proofLostSince", { time: formatTime(since) });
  }
  const key = REASON_KEYS.get(`${d.serving_state}:${d.reason}`);
  return key ? t(key) : null;
}

const plansRoute = computed(() => ({
  name: "plans",
  query: { org_identifier: props.orgIdentifier },
}));

async function load() {
  if (!props.pageId) return;
  loading.value = true;
  try {
    const res = await statusPagesService.listDomains(props.orgIdentifier, props.pageId);
    domains.value = (res.data as StatusPageDomain[]) ?? [];
  } catch (err) {
    toast({ variant: "error", message: t("statusPages.domains.loadFailed") });
    console.error("[status-pages] failed to load domains", err);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) load();
  },
  { immediate: true },
);

async function addDomain() {
  const domain = newDomain.value.trim();
  if (!domain || adding.value || addBlockedByPlan.value) return;
  adding.value = true;
  try {
    await statusPagesService.createDomain(props.orgIdentifier, props.pageId, domain);
    newDomain.value = "";
    await load();
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("statusPages.domains.addFailed"),
    });
    console.error("[status-pages] add domain failed", err);
  } finally {
    adding.value = false;
  }
}

function copyTxtName(d: StatusPageDomain) {
  if (!d.txt_name) return;
  copyToClipboard(d.txt_name, t, {
    successMessage: t("statusPages.domains.txtNameCopied"),
  });
}

function copyTxtValue(d: StatusPageDomain) {
  if (!d.verification_token) return;
  copyToClipboard(d.verification_token, t, {
    successMessage: t("statusPages.domains.txtValueCopied"),
  });
}

async function verifyDomain(d: StatusPageDomain) {
  verifyingId.value = d.id;
  try {
    const res = await statusPagesService.verifyDomain(props.orgIdentifier, d.id);
    const updated = res.data as StatusPageDomain;
    const idx = domains.value.findIndex((x) => x.id === d.id);
    if (idx !== -1) domains.value[idx] = updated;
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("statusPages.domains.verifyFailed"),
    });
    console.error("[status-pages] verify domain failed", err);
  } finally {
    verifyingId.value = null;
  }
}

async function confirmDelete(d: StatusPageDomain) {
  const ok = await confirm({
    title: t("statusPages.domains.deleteTitle"),
    messageKeypath: "statusPages.domains.releaseBody",
    messageName: d.domain,
    confirmVariant: "destructive",
  });
  if (!ok) return;
  const dismiss = toast({
    variant: "loading",
    message: t("statusPages.domains.deleting"),
    timeout: 0,
  });
  try {
    await statusPagesService.deleteDomain(props.orgIdentifier, d.id);
    domains.value = domains.value.filter((x) => x.id !== d.id);
    dismiss();
    toast({ variant: "success", message: t("statusPages.domains.deleted") });
  } catch (err: any) {
    dismiss();
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("statusPages.domains.deleteFailed"),
    });
    console.error("[status-pages] delete domain failed", err);
  }
}
</script>
