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
  <OPageLayout
    :title="t('aiMemory.header')"
    icon="psychology"
    :subtitle="t('aiMemory.subtitle')"
    data-test="ai-memory-page"
    tabs-below
    bleed
  >
    <template #header-tabs>
      <OTabs v-model="tab" dense align="left" data-test="ai-memory-tabs">
        <OTab name="notes" :label="t('aiMemory.notes')" data-test="ai-memory-notes-tab" />
        <OTab
          name="pending"
          :label="t('aiMemory.pending', { count: pending.length })"
          data-test="ai-memory-pending-tab"
        />
        <OTab name="history" :label="t('aiMemory.history')" data-test="ai-memory-history-tab" />
      </OTabs>
    </template>

    <div class="min-h-0 flex-1 overflow-auto p-4">
      <div v-if="tab === 'notes'" data-test="ai-memory-notes">
        <AiMemoryEditor
          :target="{ scope: 'org' }"
          :title="t('aiMemory.orgMemory')"
          @saved="refresh"
        />
        <div class="mt-6 mb-2 text-sm font-medium">{{ t("aiMemory.toolsetMemory") }}</div>
        <div v-if="!mcpToolsets.length" class="text-text-secondary text-xs">
          {{ t("aiMemory.noToolsets") }}
        </div>
        <AiMemoryEditor
          v-for="ts in mcpToolsets"
          :key="ts.id"
          :target="{ scope: 'toolset', toolsetId: ts.id }"
          :title="ts.name"
          @saved="refresh"
        />
      </div>

      <div v-else-if="tab === 'pending'" data-test="ai-memory-pending">
        <div v-if="isAdmin && groups.length" class="mb-3 flex items-center gap-2">
          <OButton
            size="sm"
            variant="primary"
            :disabled="!selected.size"
            data-test="ai-memory-accept-selected"
            @click="decide('accept', selectedIds)"
          >
            {{ t("aiMemory.acceptSelected") }}
          </OButton>
          <OButton
            size="sm"
            variant="outline"
            :disabled="!selected.size"
            data-test="ai-memory-discard-selected"
            @click="decide('discard', selectedIds)"
          >
            {{ t("aiMemory.discardSelected") }}
          </OButton>
          <OButton
            size="sm"
            variant="outline"
            data-test="ai-memory-accept-all"
            @click="decide('accept', allIds)"
          >
            {{ t("aiMemory.acceptAll") }}
          </OButton>
          <OButton
            size="sm"
            variant="ghost"
            data-test="ai-memory-discard-all"
            @click="decide('discard', allIds)"
          >
            {{ t("aiMemory.discardAll") }}
          </OButton>
        </div>
        <div v-if="!groups.length" class="text-text-secondary text-sm">
          {{ t("aiMemory.noPending") }}
        </div>
        <div
          v-for="group in groups"
          :key="group.key"
          class="border-border-default rounded-default mb-3 border p-3"
          data-test="ai-memory-pending-group"
        >
          <div class="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <input
              v-if="isAdmin"
              type="checkbox"
              :checked="selected.has(group.key)"
              :aria-label="t('aiMemory.select')"
              data-test="ai-memory-pending-select"
              @change="toggle(group.key)"
            />
            <span class="text-sm font-medium">{{ scopeLabel(group.scope, group.scope_key) }}</span>
            <span v-if="group.items.length > 1">
              {{ t("aiMemory.proposedTimes", { count: group.items.length }) }}
            </span>
            <OBadge
              v-for="flag in group.flags"
              :key="flag"
              variant="warning-outline"
              size="sm"
              :data-test="`ai-memory-flag-${flag}`"
            >
              {{ t(`aiMemory.flag.${flag}`) }}
            </OBadge>
            <div class="flex-1" />
            <template v-if="isAdmin">
              <OButton
                size="xs"
                variant="primary"
                data-test="ai-memory-accept"
                @click="decide('accept', ids(group))"
              >
                {{ t("aiMemory.accept") }}
              </OButton>
              <OButton
                size="xs"
                variant="ghost"
                data-test="ai-memory-discard"
                @click="decide('discard', ids(group))"
              >
                {{ t("aiMemory.discard") }}
              </OButton>
            </template>
          </div>
          <pre
            v-if="group.content !== undefined"
            class="max-h-60 overflow-auto font-mono text-xs whitespace-pre-wrap"
            data-test="ai-memory-proposed-text"
            >{{ group.content }}</pre>
          <EditsDiff v-else :edits="group.edits" />
          <div v-for="item in group.items" :key="item.id" class="text-text-secondary mt-1 text-xs">
            {{ authorLabel(item.updated_by) }} · {{ when(item.created_at) }}
            <span v-if="item.reason"> · {{ item.reason }}</span>
            <span
              v-if="failures[item.id]"
              class="text-status-negative"
              data-test="ai-memory-pending-failure"
            >
              · {{ failures[item.id] }}</span
            >
          </div>
        </div>
      </div>

      <div v-else data-test="ai-memory-history">
        <label class="mb-3 flex items-center gap-2 text-sm">
          {{ t("aiMemory.memory") }}
          <select
            v-model="historyKey"
            class="border-border-default rounded-default border px-1 py-0.5"
            data-test="ai-memory-history-target"
          >
            <option value="org">{{ t("aiMemory.orgMemory") }}</option>
            <option v-for="ts in mcpToolsets" :key="ts.id" :value="ts.id">{{ ts.name }}</option>
          </select>
        </label>
        <div
          v-for="r in revisions"
          :key="r.id"
          class="hover:bg-surface-hover flex cursor-pointer gap-3 py-1 text-sm"
          data-test="ai-memory-revision"
          @click="openRevision(r.id)"
        >
          <span class="w-16">{{
            r.rev != null ? t("aiMemory.rev", { rev: r.rev }) : r.state
          }}</span>
          <span class="w-40">{{ when(r.created_at) }}</span>
          <span class="w-40">{{ authorLabel(r.updated_by) }}</span>
          <span class="text-text-secondary truncate">{{ r.reason }}</span>
        </div>
      </div>
    </div>

    <ODialog
      :open="!!opened"
      :title="revision ? t('aiMemory.revisionTitle', { rev: revision.rev ?? revision.state }) : ''"
      :primary-button-label="canRevert ? t('aiMemory.revert') : undefined"
      primary-button-data-test="ai-memory-revert"
      @update:open="(open: boolean) => !open && (opened = null)"
      @click:primary="revert"
    >
      <div v-if="revision" class="text-sm" data-test="ai-memory-revision-dialog">
        <div class="mb-2 text-xs">
          {{ authorLabel(revision.updated_by) }} · {{ when(revision.created_at) }}
        </div>
        <div v-if="revision.reason" class="mb-2">{{ revision.reason }}</div>
        <EditsDiff v-if="revision.edits?.length" :edits="revision.edits" />
        <div v-else class="max-h-80 overflow-auto font-mono text-xs" data-test="ai-memory-diff">
          <div
            v-for="(line, i) in diffLines(opened?.before ?? '', revision.content ?? '')"
            :key="i"
            :class="{
              'text-status-error': line.kind === 'removed',
              'text-status-success': line.kind === 'added',
            }"
            class="whitespace-pre-wrap"
          >
            {{ line.kind === "removed" ? "- " : line.kind === "added" ? "+ " : "  "
            }}{{ line.text }}
          </div>
        </div>
        <div v-if="revision.evidence?.length" class="mt-2 text-xs" data-test="ai-memory-evidence">
          {{ t("aiMemory.evidence") }}:
          <span v-for="e in revision.evidence" :key="e.call_ref" class="me-2 font-mono">
            {{ e.tool ? `${e.tool} ` : "" }}{{ e.call_ref }}
          </span>
        </div>
      </div>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, watch, type PropType } from "vue";
import { useStore } from "vuex";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped } from "@/types/i18n";
import aiMemory, {
  type MemoryEdit,
  type MemoryScope,
  type MemoryTarget,
  type PendingEdit,
  type Revision,
} from "@/services/ai_memory";
import aiToolsets from "@/services/ai_toolsets";
import AiMemoryEditor from "@/components/ai_memory/AiMemoryEditor.vue";
import {
  authorLabel,
  diffLines,
  groupPending,
  type PendingGroup,
} from "@/components/ai_memory/memory";

// One proposed change as removed and added lines.
const EditsDiff = defineComponent({
  props: { edits: { type: Array as PropType<MemoryEdit[]>, required: true } },
  setup: (props) => () =>
    h(
      "div",
      { class: "font-mono text-xs", "data-test": "ai-memory-diff" },
      props.edits.flatMap((e) => [
        ...("old" in e ? [h("div", { class: "text-status-error" }, `- ${e.old}`)] : []),
        ...("new" in e ? [h("div", { class: "text-status-success" }, `+ ${e.new}`)] : []),
        ...("text" in e
          ? [h("div", { class: "text-status-success" }, `+ [${e.section}] ${e.text}`)]
          : []),
      ]),
    ),
});

const { t } = useI18nTyped();
const store = useStore();
const org = () => store.state.selectedOrganization.identifier;

const tab = ref<"notes" | "pending" | "history">("notes");
const toolsets = ref<{ id: string; name: string; kind: string }[]>([]);
const pending = ref<PendingEdit[]>([]);
const selected = ref(new Set<string>());
const isAdmin = ref(false);
const historyKey = ref("org");
const revisions = ref<Revision[]>([]);
const failures = ref<Record<string, string>>({});
// The dialog keeps the memory it was opened for, so Revert never targets a later selection.
const opened = ref<{ revision: Revision; target: MemoryTarget; before: string } | null>(null);
const revision = computed(() => opened.value?.revision ?? null);

const mcpToolsets = computed(() => toolsets.value.filter((ts) => ts.kind === "mcp"));
const groups = computed(() => groupPending(pending.value));
const historyTarget = computed<MemoryTarget>(() =>
  historyKey.value === "org" ? { scope: "org" } : { scope: "toolset", toolsetId: historyKey.value },
);
const canRevert = computed(
  () => isAdmin.value && revision.value?.state === "applied" && revision.value.rev != null,
);
const selectedIds = computed(() =>
  groups.value.filter((g) => selected.value.has(g.key)).flatMap(ids),
);
const allIds = computed(() => groups.value.flatMap(ids));

function ids(group: PendingGroup) {
  return group.items.map((i) => i.id);
}

const when = (micros: number) => new Date(micros / 1000).toLocaleString();

const scopeLabel = (scope: MemoryScope, key: string) =>
  scope === "org"
    ? t("aiMemory.orgMemory")
    : (toolsets.value.find((ts) => ts.id === key)?.name ?? key);

const toggle = (key: string) => {
  const next = new Set(selected.value);
  if (!next.delete(key)) next.add(key);
  selected.value = next;
};

const loadPending = async () => {
  try {
    pending.value = (await aiMemory.pending(org())).data.pending ?? [];
  } catch {
    pending.value = [];
  }
  selected.value = new Set();
};

// A response for a selection the user has since left is dropped.
const loadRevisions = async () => {
  const key = historyKey.value;
  const list = (await aiMemory.revisions(org(), historyTarget.value)).data.revisions ?? [];
  if (key === historyKey.value) revisions.value = list;
};

// `can_apply` on org memory is the caller's `ai_memory` write grant, which every admin control needs.
const refresh = async () => {
  const [memory] = await Promise.all([aiMemory.get(org(), { scope: "org" }), loadPending()]);
  isAdmin.value = !!memory.data.can_apply;
  if (tab.value === "history") await loadRevisions();
};

// Each id gets its own result; a failed one stays in the inbox with its reason.
const decide = async (action: "accept" | "discard", list: string[]) => {
  if (!list.length) return;
  const next: Record<string, string> = {};
  try {
    const results = (await aiMemory[action](org(), list)).data?.results ?? [];
    for (const r of results.filter((r) => r.status >= 300)) {
      next[r.id] = r.message || r.code || String(r.status);
    }
    const done = list.length - Object.keys(next).length;
    toast({
      variant: Object.keys(next).length ? "warning" : "success",
      message: t(`aiMemory.${action}ed`, { count: done, failed: Object.keys(next).length }),
    });
  } catch (err: any) {
    toast({ variant: "error", message: err?.response?.data?.message || t("aiMemory.saveFailed") });
  }
  await loadPending();
  failures.value = next;
};

// A snapshot is diffed against the applied text it replaced (`base_rev` for a proposal).
const textBefore = async (target: MemoryTarget, r: Revision) => {
  if (r.edits) return "";
  const limit = r.state === "applied" && r.rev != null ? r.rev - 1 : r.base_rev;
  const prev = revisions.value
    .filter((p) => p.state === "applied" && p.rev != null && p.rev <= limit)
    .sort((a, b) => b.rev! - a.rev!)[0];
  if (!prev) return "";
  return (await aiMemory.revision(org(), target, prev.id)).data.content ?? "";
};

const openRevision = async (id: string) => {
  const [key, target] = [historyKey.value, historyTarget.value];
  const r = (await aiMemory.revision(org(), target, id)).data;
  const before = await textBefore(target, r);
  if (key === historyKey.value) opened.value = { revision: r, target, before };
};

const revert = async () => {
  const rev = opened.value?.revision.rev;
  if (!opened.value || !rev) return;
  try {
    await aiMemory.revert(org(), opened.value.target, rev);
    toast({ variant: "success", message: t("aiMemory.reverted", { rev }) });
    opened.value = null;
    await loadRevisions();
  } catch (err: any) {
    toast({ variant: "error", message: err?.response?.data?.message || t("aiMemory.saveFailed") });
  }
};

onMounted(async () => {
  const [list] = await Promise.allSettled([aiToolsets.list(org(), { kind: "mcp" }), refresh()]);
  if (list.status === "fulfilled") toolsets.value = list.value.data?.toolsets ?? [];
});

watch([tab, historyKey], () => tab.value === "history" && loadRevisions());
</script>
