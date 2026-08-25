<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  One Remote Task head.

  Addressed by `entityId`, not by a version row id, so the page survives every
  publish. The head is shown at its newest published version — or at its draft
  when it has never published one, which is the same fallback the GET route
  makes, so the page and the API agree on what "the task" means.
-->
<template>
  <OPageLayout
    data-test="ai-remote-task-detail-page"
    :back="{
      label: t('aiObservability.remoteTasks.detail.backTo'),
      onClick: goBack,
      dataTest: 'ai-remote-task-detail-back-btn',
    }"
    :subtitle="task?.description ? raw(task.description) : undefined"
    bleed
    :scroll="false"
  >
    <template #title>
      <span data-test="ai-remote-task-detail-title">{{ title }}</span>
    </template>

    <template #actions>
      <OTag
        v-if="task"
        type="remoteTaskStatus"
        :value="state"
        data-test="ai-remote-task-detail-state"
      />
      <OButton
        variant="outline"
        size="sm"
        icon-left="edit"
        :disabled="!canEdit"
        data-test="ai-remote-task-detail-edit-btn"
        @click="openEdit"
      >
        {{ t("aiObservability.remoteTasks.edit") }}
        <OTooltip
          v-if="!canEdit"
          side="bottom"
          :content="t('aiObservability.remoteTasks.editSecretLocked')"
        />
      </OButton>
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="refresh"
        :loading="loading"
        data-test="ai-remote-task-detail-refresh-btn"
        @click="refresh"
      >
        <OTooltip side="bottom" :content="t('common.refresh')" />
      </OButton>
      <OButton
        variant="ghost-destructive"
        size="icon-sm"
        icon-left="delete"
        data-test="ai-remote-task-detail-delete-btn"
        @click="removeTask"
      >
        <OTooltip side="bottom" :content="t('common.delete')" />
      </OButton>
    </template>

    <template #header-tabs>
      <OTabs v-model="currentTab" dense align="left" data-test="ai-remote-task-detail-tabs">
        <OTab
          name="overview"
          :label="t('aiObservability.remoteTasks.detail.tabs.overview')"
          data-test="ai-remote-task-detail-tab-overview"
        />
        <OTab
          name="versions"
          :label="t('aiObservability.remoteTasks.detail.tabs.versions')"
          data-test="ai-remote-task-detail-tab-versions"
        />
        <OTab
          name="signing"
          :label="t('aiObservability.remoteTasks.detail.tabs.signing')"
          data-test="ai-remote-task-detail-tab-signing"
        />
      </OTabs>
    </template>

    <div v-if="task" class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
      <template v-if="currentTab === 'overview'">
        <!-- The pinnable reference leads, because it is the one string another
             page needs from here. -->
        <section
          class="card-container rounded-default border-border-default bg-surface-base flex flex-col gap-2 border px-4 py-3.5"
          data-test="ai-remote-task-detail-reference"
        >
          <span class="text-text-label text-compact leading-tight font-medium">
            {{ t("aiObservability.remoteTasks.detail.taskRefLabel") }}
          </span>
          <div v-if="task.taskRef" class="flex flex-wrap items-center gap-2">
            <code class="text-text-body rounded-default bg-card-bg px-2 py-1 font-mono text-xs">
              {{ task.taskRef }}
            </code>
            <OButton
              variant="ghost"
              size="icon-sm"
              :icon-left="refCopied ? 'check' : 'content-copy'"
              :aria-label="t('aiObservability.remoteTasks.detail.copyRef')"
              data-test="ai-remote-task-detail-copy-ref"
              @click="copyRef"
            />
            <span class="text-text-secondary text-2xs">
              {{ t("aiObservability.remoteTasks.detail.taskRefHint") }}
            </span>
          </div>
          <span v-else class="text-text-secondary text-xs">
            {{ t("aiObservability.remoteTasks.detail.taskRefNone") }}
          </span>
        </section>

        <p
          v-if="task.verificationError"
          class="border-status-error-text rounded-default bg-surface-base text-status-error-text m-0 border px-4 py-3 text-xs leading-relaxed"
          data-test="ai-remote-task-detail-verification-error"
        >
          {{ t("aiObservability.remoteTasks.detail.verificationError") }}:
          {{ task.verificationError }}
        </p>

        <section
          class="card-container rounded-default border-border-default bg-surface-base flex flex-col gap-3 border px-4 py-3.5"
          data-test="ai-remote-task-detail-config"
        >
          <span class="text-text-heading text-compact font-semibold">
            {{ t("aiObservability.remoteTasks.detail.configTitle") }}
          </span>
          <dl
            class="text-text-secondary m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs"
          >
            <dt class="font-medium">
              {{ t("aiObservability.remoteTasks.detail.fields.endpoint") }}
            </dt>
            <dd class="text-text-body m-0 font-mono break-all">{{ task.endpoint }}</dd>
            <dt class="font-medium">
              {{ t("aiObservability.remoteTasks.detail.fields.method") }}
            </dt>
            <dd class="m-0"><OTag type="httpMethod" :value="task.httpMethod" /></dd>
            <dt class="font-medium">{{ t("aiObservability.remoteTasks.detail.fields.auth") }}</dt>
            <dd class="m-0"><OTag type="remoteTaskAuth" :value="task.auth.type" /></dd>
            <dt class="font-medium">
              {{ t("aiObservability.remoteTasks.detail.fields.responsePath") }}
            </dt>
            <dd class="text-text-body m-0 font-mono">{{ task.responseSchema }}</dd>
            <dt class="font-medium">
              {{ t("aiObservability.remoteTasks.detail.fields.timeout") }}
            </dt>
            <dd class="text-text-body m-0 tabular-nums">{{ timeoutLabel }}</dd>
            <dt class="font-medium">
              {{ t("aiObservability.remoteTasks.detail.fields.attempts") }}
            </dt>
            <dd class="text-text-body m-0 tabular-nums">{{ task.maxAttempts }}</dd>
            <dt class="font-medium">
              {{ t("aiObservability.remoteTasks.detail.fields.concurrency") }}
            </dt>
            <dd class="text-text-body m-0 tabular-nums">{{ task.maxConcurrency }}</dd>
            <dt class="font-medium">
              {{ t("aiObservability.remoteTasks.detail.fields.signing") }}
            </dt>
            <dd class="m-0">
              <OTag v-if="task.signing.enabled" variant="success-soft" icon="lock">
                {{ t("aiObservability.remoteTasks.signingOn") }}
              </OTag>
              <span v-else class="text-text-secondary">{{ DASH }}</span>
            </dd>
            <dt class="font-medium">
              {{ t("aiObservability.remoteTasks.detail.fields.verifiedAt") }}
            </dt>
            <dd class="text-text-body m-0">
              <OTimeCell
                :value="task.verifiedAt ?? null"
                unit="ms"
                mode="relative"
                :empty-label="DASH"
              />
            </dd>
          </dl>
        </section>

        <section
          class="card-container rounded-default border-border-default bg-surface-base flex flex-col gap-2 border px-4 py-3.5"
          data-test="ai-remote-task-detail-headers"
        >
          <span class="text-text-heading text-compact font-semibold">
            {{ t("aiObservability.remoteTasks.detail.headersTitle") }}
          </span>
          <div v-if="task.customHeaders.length" class="flex flex-col gap-1.5">
            <div
              v-for="header in task.customHeaders"
              :key="header.key"
              class="flex flex-wrap items-center gap-2 text-xs"
            >
              <code class="text-text-body rounded-default bg-card-bg px-2 py-0.5 font-mono">
                {{ header.key }}
              </code>
              <!-- A Secret-backed header reports that it is, never what. -->
              <OTag v-if="header.usesSecret" variant="purple-soft" icon="lock">
                {{ t("aiObservability.remoteTasks.detail.headerSecret") }}
              </OTag>
              <span v-else class="text-text-secondary font-mono">{{ header.value }}</span>
            </div>
          </div>
          <span v-else class="text-text-secondary text-xs">
            {{ t("aiObservability.remoteTasks.detail.headersNone") }}
          </span>
        </section>

        <section
          class="card-container rounded-default border-border-default bg-surface-base flex flex-col gap-2 border px-4 py-3.5"
          data-test="ai-remote-task-detail-template"
        >
          <span class="text-text-heading text-compact font-semibold">
            {{ t("aiObservability.remoteTasks.detail.templateTitle") }}
          </span>
          <span v-if="!task.requestTemplate" class="text-text-secondary text-xs">
            {{ t("aiObservability.remoteTasks.detail.templateDefault") }}
          </span>
          <pre
            class="rounded-default bg-card-bg border-border-default text-text-body m-0 max-h-56 overflow-auto border p-2 font-mono text-xs whitespace-pre-wrap"
            >{{ task.requestTemplate || DEFAULT_REQUEST_TEMPLATE }}</pre>
        </section>

        <section
          class="card-container rounded-default border-border-default bg-surface-base border px-4 py-3.5"
        >
          <RemoteTaskTestRunPanel
            :org-id="orgId"
            :entity-id="entityId"
            :can-run="!task.isDraft && task.isReferenceable"
            :max-attempts="task.maxAttempts"
          />
        </section>
      </template>

      <template v-else-if="currentTab === 'versions'">
        <div class="flex items-center justify-end">
          <OButton
            v-if="hasDraft"
            variant="outline"
            size="sm-action"
            icon-left="delete"
            data-test="ai-remote-task-detail-discard-draft"
            @click="discardDraft"
          >
            {{ t("aiObservability.remoteTasks.detail.discardDraft") }}
          </OButton>
        </div>
        <div class="card-container flex min-h-0 flex-1 flex-col overflow-hidden">
          <OTable
            :data="versions"
            :columns="versionColumns"
            row-key="id"
            :loading="loading"
            :frame="false"
            :show-global-filter="false"
            :page-size="20"
            width="100%"
            class="h-full w-full"
            data-test="ai-remote-task-detail-versions-table"
          >
            <template #cell-version="{ row }">
              <span v-if="!row.isDraft" class="tabular-nums">{{ versionLabel(row) }}</span>
              <span v-else class="text-text-secondary">{{ DASH }}</span>
            </template>
            <template #cell-state="{ row }">
              <OTag type="remoteTaskStatus" :value="rowState(row)" />
            </template>
            <template #cell-taskRef="{ row }">
              <code v-if="row.taskRef" class="text-text-body font-mono text-xs">
                {{ row.taskRef }}
              </code>
              <span v-else class="text-text-secondary">{{ DASH }}</span>
            </template>
            <template #cell-endpoint="{ row }">
              <span class="text-text-secondary line-clamp-1 font-mono text-xs">
                {{ row.endpoint }}
              </span>
            </template>
            <template #cell-verifiedAt="{ row }">
              <OTimeCell
                :value="row.verifiedAt ?? null"
                unit="ms"
                mode="relative"
                :empty-label="DASH"
              />
            </template>
          </OTable>
        </div>
      </template>

      <section
        v-else
        class="card-container rounded-default border-border-default bg-surface-base border px-4 py-3.5"
      >
        <RemoteTaskSigningPanel
          :org-id="orgId"
          :entity-id="entityId"
          :enabled="task.signing.enabled"
        />
      </section>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import remoteTasksService, { type RemoteTask } from "@/services/remote-tasks.service";
import RemoteTaskSigningPanel from "@/enterprise/components/AIObservability/RemoteTaskSigningPanel.vue";
import RemoteTaskTestRunPanel from "@/enterprise/components/AIObservability/RemoteTaskTestRunPanel.vue";
import {
  DEFAULT_REQUEST_TEMPLATE,
  canEditRemoteTask,
  remoteTaskState,
  remoteTaskVersionLabel,
} from "@/enterprise/components/AIObservability/remoteTaskContent";
import { aiRemoteTaskEditRoute, aiRemoteTasksRoute } from "./remoteTaskRoutes";

defineOptions({ name: "AIRemoteTaskDetailPage" });

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();
const { confirm } = useConfirmDialog();

const DASH = raw("—");

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const entityId = computed<string>(() => String(route.params.id ?? ""));

const task = ref<RemoteTask | null>(null);
const versions = ref<RemoteTask[]>([]);
const loading = ref(false);
const refCopied = ref(false);
const currentTab = ref<"overview" | "versions" | "signing">("overview");

const title = computed<I18nText>(() =>
  task.value ? raw(task.value.name) : t("aiObservability.nav.remoteTasks"),
);
const state = computed(() => (task.value ? remoteTaskState(task.value) : "draft"));
const canEdit = computed(() => Boolean(task.value && canEditRemoteTask(task.value)));
const hasDraft = computed(() => versions.value.some((version) => version.isDraft));
const timeoutLabel = computed<I18nText>(() =>
  task.value ? raw(`${Math.round(task.value.timeoutMs / 1000)} s`) : DASH,
);

const versionLabel = (row: RemoteTask) => remoteTaskVersionLabel(row);
const rowState = (row: RemoteTask) => remoteTaskState(row);

const versionColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "version",
    header: t("aiObservability.remoteTasks.detail.versionsColumns.version"),
    accessorKey: "version",
    sortable: false,
    size: 110,
    meta: { align: "left" },
  },
  {
    id: "state",
    header: t("aiObservability.remoteTasks.detail.versionsColumns.status"),
    accessorFn: (row: RemoteTask) => remoteTaskState(row),
    sortable: false,
    size: 140,
    meta: { align: "left" },
  },
  {
    id: "taskRef",
    header: t("aiObservability.remoteTasks.detail.versionsColumns.reference"),
    accessorKey: "taskRef",
    sortable: false,
    size: 220,
    meta: { align: "left" },
  },
  {
    id: "endpoint",
    header: t("aiObservability.remoteTasks.detail.versionsColumns.endpoint"),
    accessorKey: "endpoint",
    sortable: false,
    size: 300,
    meta: { align: "left", flex: true },
  },
  {
    id: "verifiedAt",
    header: t("aiObservability.remoteTasks.detail.versionsColumns.verifiedAt"),
    accessorKey: "verifiedAt",
    sortable: false,
    size: 160,
    meta: { align: "left" },
  },
]);

function goBack() {
  void router.push(aiRemoteTasksRoute(orgId.value));
}

function openEdit() {
  if (!canEdit.value) return;
  void router.push(aiRemoteTaskEditRoute(orgId.value, entityId.value));
}

async function copyRef() {
  if (!task.value?.taskRef) return;
  try {
    await navigator.clipboard.writeText(task.value.taskRef);
    refCopied.value = true;
  } catch {
    refCopied.value = false;
  }
}

async function refresh() {
  if (!orgId.value || !entityId.value) return;
  loading.value = true;
  try {
    const [head, allVersions] = await Promise.all([
      remoteTasksService.get(orgId.value, entityId.value),
      remoteTasksService.versions(orgId.value, entityId.value),
    ]);
    task.value = head;
    versions.value = allVersions;
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) || t("aiObservability.remoteTasks.detail.loadError"),
    });
  } finally {
    loading.value = false;
  }
}

async function discardDraft() {
  const ok = await confirm({
    title: t("aiObservability.remoteTasks.detail.discardDraftTitle"),
    message: t("aiObservability.remoteTasks.detail.discardDraftMessage"),
    confirmLabel: t("aiObservability.remoteTasks.detail.discardDraft"),
    cancelLabel: t("common.cancel"),
  });
  if (!ok) return;
  try {
    await remoteTasksService.discardDraft(orgId.value, entityId.value);
    toast({
      variant: "success",
      message: t("aiObservability.remoteTasks.detail.discardDraftSuccess"),
    });
    await refresh();
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) ||
        t("aiObservability.remoteTasks.detail.discardDraftError"),
    });
  }
}

async function removeTask() {
  if (!task.value) return;
  const ok = await confirm({
    title: t("aiObservability.remoteTasks.delete.title"),
    message: t("aiObservability.remoteTasks.delete.message", { name: task.value.name }),
    confirmLabel: t("common.delete"),
    cancelLabel: t("common.cancel"),
  });
  if (!ok) return;
  try {
    await remoteTasksService.delete(orgId.value, entityId.value);
    toast({ variant: "success", message: t("aiObservability.remoteTasks.delete.success") });
    goBack();
  } catch (error: any) {
    toast({
      variant: "error",
      message: raw(error?.response?.data?.message) || t("aiObservability.remoteTasks.delete.error"),
    });
  }
}

onMounted(refresh);
</script>
