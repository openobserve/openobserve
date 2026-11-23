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
      <DomainInstallationLine v-if="open" :org-identifier="orgIdentifier" />

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
              :variant="domainStateBadge(shownServingState(d)).variant"
              size="sm"
              :data-test="`status-page-domain-state-${d.id}`"
            >
              {{ stateLabel(d) }}
            </OBadge>
          </div>
          <div class="flex items-center gap-1">
            <OButton
              v-if="d.serving_state === 'pending' && domainRecordKind(d)"
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

        <DomainStateBody
          :domain="d"
          :cloud="isCloud"
          :org-identifier="orgIdentifier"
          :checking="checkingIds.has(d.id)"
          @check-again="checkAgain(d)"
        />
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import config from "@/aws-exports";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import statusPagesService, { type StatusPageDomain } from "@/services/status_pages";
import DomainInstallationLine from "./DomainInstallationLine.vue";
import DomainStateBody from "./DomainStateBody.vue";
import { domainRecordKind } from "./domainMessages";
import { nextDomainsReadSeq } from "./domainsReadSeq";
import { domainStateBadge, shownServingState } from "./statusPageBadges";

const props = defineProps<{
  // Rows already fetched for this page; used the first time the dialog opens, then it loads.
  initialDomains?: StatusPageDomain[] | null;
  // The sequence number taken when the read behind `initialDomains` started; see `lastAddSeq`.
  initialDomainsReadSeq?: number | null;
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
const checkingIds = reactive(new Set<string>());
const newDomain = ref("");

const isCloud = config.isCloud === "true";

// Block only a Cloud org positively on the free plan; the client cannot know the server's
// rule, so every other case, an empty plan included, is left to the server.
const addBlockedByPlan = computed(
  () => isCloud && store.state.selectedOrganization?.subscription_type === config.freePlan,
);

function stateLabel(d: StatusPageDomain) {
  const { labelKey } = domainStateBadge(shownServingState(d));
  return labelKey ? t(labelKey) : raw(d.serving_state);
}

const plansRoute = computed(() => ({
  name: "plans",
  query: { org_identifier: props.orgIdentifier },
}));

// Each read, and each seed from a mailed link, supersedes the ones before it, so an older answer
// that arrives late never overwrites the newer rows.
let loadSeq = 0;
// The sequence number taken when the last add succeeded. A link read that started before it,
// whatever the clock says, cannot hold the new claim, so it never replaces the reload after it.
let lastAddSeq = 0;

async function load() {
  if (!props.pageId) return;
  const seq = ++loadSeq;
  loading.value = true;
  try {
    const res = await statusPagesService.listDomains(props.orgIdentifier, props.pageId);
    if (seq === loadSeq) domains.value = (res.data as StatusPageDomain[]) ?? [];
  } catch (err) {
    if (seq !== loadSeq) return;
    toast({ variant: "error", message: t("statusPages.domains.loadFailed") });
    console.error("[status-pages] failed to load domains", err);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function applySeed(rows: StatusPageDomain[]) {
  if (props.initialDomainsReadSeq != null && props.initialDomainsReadSeq <= lastAddSeq) return;
  loadSeq++;
  loading.value = false;
  domains.value = rows;
}

let seeded = false;
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    if (!seeded && props.initialDomains) applySeed(props.initialDomains);
    else load();
    seeded = true;
  },
  { immediate: true },
);

// Another mailed link to this page while it is open brings fresher rows than the ones shown.
watch(
  () => props.initialDomains,
  (rows) => {
    if (rows && props.open && seeded) applySeed(rows);
  },
);

// The API's own message, as every refused write shows it, else the fallback for the action.
function refusal(err: any, fallback: string) {
  return err?.response?.data?.message || err?.response?.data?.error || fallback;
}

async function addDomain() {
  const domain = newDomain.value.trim();
  if (!domain || adding.value || addBlockedByPlan.value) return;
  adding.value = true;
  try {
    await statusPagesService.createDomain(props.orgIdentifier, props.pageId, domain);
    lastAddSeq = nextDomainsReadSeq();
    newDomain.value = "";
    await load();
  } catch (err: any) {
    toast({ variant: "error", message: refusal(err, t("statusPages.domains.addFailed")) });
    console.error("[status-pages] add domain failed", err);
  } finally {
    adding.value = false;
  }
}

// The row is replaced by the view the server returns, and nothing is derived from it here.
function replaceRow(updated: StatusPageDomain) {
  const idx = domains.value.findIndex((x) => x.id === updated.id);
  if (idx !== -1) domains.value[idx] = updated;
}

async function verifyDomain(d: StatusPageDomain) {
  verifyingId.value = d.id;
  try {
    const res = await statusPagesService.verifyDomain(props.orgIdentifier, d.id);
    replaceRow(res.data as StatusPageDomain);
  } catch (err: any) {
    toast({ variant: "error", message: refusal(err, t("statusPages.domains.verifyFailed")) });
    console.error("[status-pages] verify domain failed", err);
  } finally {
    verifyingId.value = null;
  }
}

async function checkAgain(d: StatusPageDomain) {
  if (checkingIds.has(d.id)) return;
  checkingIds.add(d.id);
  try {
    const res = await statusPagesService.checkDomain(props.orgIdentifier, d.id);
    replaceRow(res.data as StatusPageDomain);
  } catch (err: any) {
    toast({ variant: "error", message: refusal(err, t("statusPages.domains.checkFailed")) });
    console.error("[status-pages] check domain failed", err);
  } finally {
    checkingIds.delete(d.id);
  }
}

async function confirmDelete(d: StatusPageDomain) {
  const ok = await confirm({
    title: t("statusPages.domains.deleteTitle"),
    // With no record to add, a released domain cannot be added again until custom domains are on.
    messageKeypath: domainRecordKind(d)
      ? "statusPages.domains.releaseBody"
      : "statusPages.domains.releaseBodyOff",
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
    toast({ variant: "error", message: refusal(err, t("statusPages.domains.deleteFailed")) });
    console.error("[status-pages] delete domain failed", err);
  }
}
</script>
