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

<!-- Claim, verify, and remove custom (vanity) domains for a status page.
     TLS termination is the operator's own reverse proxy/CDN — this dialog
     only covers DNS ownership proof and the resulting Host→page routing. -->
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
      <div class="flex items-end gap-2">
        <OInput
          v-model="newDomain"
          class="flex-1"
          :label="t('statusPages.domains.addLabel')"
          :placeholder="t('statusPages.domains.addPlaceholder')"
          data-test="status-page-domain-input"
          @keydown.enter="addDomain"
        />
        <OButton
          variant="primary"
          :disabled="!newDomain.trim() || adding"
          data-test="status-page-domain-add-btn"
          @click="addDomain"
        >
          {{ t("statusPages.domains.addButton") }}
        </OButton>
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
            <OBadge :variant="domainStateBadge(d.verification_state).variant" size="sm">
              {{ t(domainStateBadge(d.verification_state).labelKey) }}
            </OBadge>
          </div>
          <div class="flex items-center gap-1">
            <OButton
              v-if="d.verification_state !== 1"
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

        <div v-if="d.verification_state !== 1" class="flex flex-col gap-1">
          <p class="text-text-secondary text-xs">
            {{ t("statusPages.domains.recordInstructions") }}
          </p>
          <code
            v-if="pendingRecords[d.id]"
            class="bg-bg-subtle rounded-default border-border-subtle border p-2 text-xs break-all"
          >
            {{
              t("statusPages.domains.recordValue", {
                domain: d.domain,
                value: pendingRecords[d.id],
              })
            }}
          </code>
          <p
            v-if="d.verification_state === 2 && d.verification_failure_reason !== null"
            class="text-text-error text-xs"
          >
            {{ t(`statusPages.domains.failureReason.${d.verification_failure_reason}` as any) }}
          </p>
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import statusPagesService, {
  type StatusPageDomain,
  type CreateDomainResponse,
} from "@/services/status_pages";
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

const domains = ref<StatusPageDomain[]>([]);
const loading = ref(false);
const adding = ref(false);
const verifyingId = ref<string | null>(null);
const newDomain = ref("");
// TXT value shown right after claiming a domain — the create response is the
// only place the token is ever returned; a later list refresh cannot show it
// again (it's write-once by design), so it's kept client-side per session.
const pendingRecords = ref<Record<string, string>>({});

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
  if (!domain || adding.value) return;
  adding.value = true;
  try {
    const res = await statusPagesService.createDomain(props.orgIdentifier, props.pageId, domain);
    const created = res.data as CreateDomainResponse;
    newDomain.value = "";
    pendingRecords.value[created.id] = created.txt_value;
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
    message: t("statusPages.domains.deleteBody", { domain: d.domain }),
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
    delete pendingRecords.value[d.id];
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
