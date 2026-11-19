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
  <div class="mb-4" :data-test="`ai-memory-editor-${testKey}`">
    <div v-if="memory" class="mb-2 flex flex-wrap items-center gap-3 text-xs">
      <span class="text-sm font-medium">{{ title }}</span>
      <span data-test="ai-memory-rev">{{ t("aiMemory.rev", { rev: memory.rev }) }}</span>
      <span data-test="ai-memory-size">
        {{ formatBytes(memory.size_bytes) }} / {{ formatBytes(memory.max_bytes) }}
      </span>
      <span v-if="memory.pending_count" class="text-status-warning">
        {{ t("aiMemory.pendingCount", { count: memory.pending_count }) }}
      </span>
      <div class="flex-1" />
      <OSwitch
        v-if="!readonly && target.scope === 'user'"
        :model-value="memory.agent_memory_writes_effective !== 'off'"
        :label="t('aiMemory.agentMayWrite')"
        data-test="ai-memory-user-switch"
        @update:model-value="(on: any) => saveSettings({ agent_memory_writes: on ? 'on' : 'off' })"
      />
      <template v-else-if="!readonly">
        <label class="flex items-center gap-1">
          {{ t("aiMemory.agentWrites") }}
          <select
            class="border-border-default rounded-default border px-1 py-0.5"
            :value="memory.agent_memory_writes ?? ''"
            :disabled="!isAdmin"
            data-test="ai-memory-agent-writes"
            @change="onAgentWrites(($event.target as HTMLSelectElement).value)"
          >
            <option v-if="target.scope === 'toolset'" value="">{{ t("aiMemory.inherit") }}</option>
            <option v-else value="">{{ t("aiMemory.default") }}</option>
            <option value="review">{{ t("aiMemory.review") }}</option>
            <option value="auto">{{ t("aiMemory.auto") }}</option>
            <option value="off">{{ t("aiMemory.off") }}</option>
          </select>
        </label>
        <label v-if="isAdmin" class="flex items-center gap-1">
          {{ t("aiMemory.cap") }}
          <input
            class="border-border-default rounded-default w-24 border px-1 py-0.5"
            type="number"
            :value="Math.round(memory.max_bytes / 1024)"
            data-test="ai-memory-cap"
            @change="onCap('max_bytes', ($event.target as HTMLInputElement).value)"
          />
          {{ t("aiMemory.kib") }}
        </label>
        <label v-if="isAdmin && target.scope === 'org'" class="flex items-center gap-1">
          {{ t("aiMemory.userCap") }}
          <input
            class="border-border-default rounded-default w-24 border px-1 py-0.5"
            type="number"
            :value="Math.round((memory.user_max_bytes ?? 0) / 1024)"
            data-test="ai-memory-user-cap"
            @change="onCap('user_max_bytes', ($event.target as HTMLInputElement).value)"
          />
          {{ t("aiMemory.kib") }}
        </label>
      </template>
    </div>

    <div v-if="readonly && memory" class="text-sm whitespace-pre-wrap" data-test="ai-memory-view">
      {{ memory.content || t("aiMemory.empty") }}
    </div>
    <template v-else-if="memory">
      <textarea
        v-model="draft"
        class="border-border-default rounded-default min-h-40 w-full border p-2 font-mono text-sm"
        data-test="ai-memory-text"
      />
      <div
        v-if="conflict"
        role="alert"
        class="border-status-warning rounded-default mb-2 border p-2 text-xs"
        data-test="ai-memory-conflict"
      >
        <div class="mb-1">{{ t("aiMemory.conflict", { rev: conflict.rev }) }}</div>
        <pre class="mb-2 max-h-40 overflow-auto whitespace-pre-wrap">{{ conflict.content }}</pre>
        <OButton size="xs" variant="outline" data-test="ai-memory-reapply" @click="reapply">
          {{ t("aiMemory.reapply") }}
        </OButton>
        <OButton size="xs" variant="ghost" data-test="ai-memory-take-current" @click="takeCurrent">
          {{ t("aiMemory.takeCurrent") }}
        </OButton>
      </div>
      <div class="flex items-center gap-2">
        <OButton
          size="sm"
          variant="primary"
          :disabled="draft === memory.content"
          :loading="saving"
          data-test="ai-memory-save"
          @click="save"
        >
          {{ memory.can_apply ? t("common.save") : t("aiMemory.submitForApproval") }}
        </OButton>
        <span v-if="notice" class="text-text-secondary text-xs" data-test="ai-memory-notice">
          {{ notice }}
        </span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped } from "@/types/i18n";
import aiMemory, {
  type AgentMemoryWrites,
  type Memory,
  type MemoryTarget,
  type MemoryUpdate,
} from "@/services/ai_memory";
import { formatBytes } from "./memory";

const props = defineProps<{
  target: MemoryTarget;
  title: string;
  /** Shows the text only, as the chat panel does for org memory. */
  readonly?: boolean;
}>();

const emit = defineEmits<{ (_e: "saved"): void }>();

const { t } = useI18nTyped();
const store = useStore();
const org = () => store.state.selectedOrganization.identifier;

const memory = ref<Memory | null>(null);
const draft = ref("");
const baseRev = ref(0);
const conflict = ref<{ rev: number; content: string } | null>(null);
const saving = ref(false);
const notice = ref("");

const testKey = computed(() =>
  props.target.scope === "toolset" ? `toolset-${props.target.toolsetId}` : props.target.scope,
);
// Shared memory settings are a memory admin's; a user's own notes are always theirs.
const isAdmin = computed(() => props.target.scope === "user" || !!memory.value?.can_apply);

const load = async () => {
  const res = await aiMemory.get(org(), props.target);
  memory.value = res.data;
  draft.value = res.data.content;
  baseRev.value = res.data.rev;
  conflict.value = null;
};

onMounted(load);
watch(() => JSON.stringify(props.target), load);

const failure = (err: any) => {
  const body = err?.response?.data ?? {};
  if (body.code === "memory_too_large") {
    return t("aiMemory.tooLarge", {
      size: formatBytes(body.size_bytes),
      max: formatBytes(body.max_bytes),
    });
  }
  return body.message || t("aiMemory.saveFailed");
};

const save = async () => {
  if (!memory.value) return;
  saving.value = true;
  notice.value = "";
  try {
    const res = await aiMemory.update(org(), props.target, {
      content: draft.value,
      base_rev: baseRev.value,
    });
    if (res.status === 202 || res.data?.state === "pending") {
      notice.value = t("aiMemory.sentForApproval");
    } else {
      notice.value = t("aiMemory.saved", { rev: res.data?.rev });
      await load();
    }
    emit("saved");
  } catch (err: any) {
    const body = err?.response?.data ?? {};
    if (err?.response?.status === 409 && body.code === "rev_conflict") {
      conflict.value = { rev: body.rev, content: body.content ?? "" };
    } else {
      toast({ variant: "error", message: failure(err) });
    }
  } finally {
    saving.value = false;
  }
};

// Keeps the user's text and saves it over the newer revision on the next Save.
const reapply = () => {
  if (!conflict.value) return;
  baseRev.value = conflict.value.rev;
  conflict.value = null;
};

const takeCurrent = () => {
  if (!conflict.value) return;
  draft.value = conflict.value.content;
  baseRev.value = conflict.value.rev;
  conflict.value = null;
};

// Only the settings are refreshed, so an unsaved draft and its base rev stay as they are.
const saveSettings = async (body: MemoryUpdate) => {
  try {
    await aiMemory.update(org(), props.target, body);
    const {
      content: _content,
      rev: _rev,
      ...settings
    } = (await aiMemory.get(org(), props.target)).data;
    if (memory.value) Object.assign(memory.value, settings);
    emit("saved");
  } catch (err) {
    toast({ variant: "error", message: failure(err) });
  }
};

const onAgentWrites = (value: string) =>
  saveSettings({ agent_memory_writes: (value || "inherit") as AgentMemoryWrites | "inherit" });

const onCap = (key: "max_bytes" | "user_max_bytes", kib: string) => {
  const n = Number(kib);
  if (Number.isFinite(n) && n > 0) saveSettings({ [key]: Math.round(n * 1024) });
};

defineExpose({ load });
</script>
