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
  <div class="flex flex-col gap-3" :data-test="`ai-memory-editor-${testKey}`">
    <div class="flex flex-wrap items-center gap-2">
      <span v-if="!embedded" class="text-sm font-medium">{{ title }}</span>
      <span v-if="memory" class="text-text-secondary text-xs" data-test="ai-memory-rev">
        {{ t("aiMemory.rev", { rev: memory.rev }) }}
      </span>
      <span
        v-if="memory?.pending_count"
        class="text-status-warning-text text-xs"
        data-test="ai-memory-pending"
      >
        {{ t("aiMemory.pendingCount", { count: memory.pending_count }) }}
      </span>
    </div>

    <div v-if="loading" class="flex flex-col gap-2" data-test="ai-memory-loading">
      <OSkeleton class="rounded-default h-6 w-1/2" />
      <OSkeleton class="rounded-default h-24 w-full" />
    </div>
    <OInlineNotice
      v-else-if="loadFailed"
      variant="error"
      :text="t('aiMemory.loadFailed')"
      :action-label="t('common.retry')"
      data-test="ai-memory-load-error"
      action-data-test="ai-memory-retry"
      @action="load"
    />
    <div
      v-else-if="readonly && memory"
      class="text-sm whitespace-pre-wrap"
      data-test="ai-memory-view"
    >
      {{ memory.content || t("aiMemory.empty") }}
    </div>
    <OForm
      v-else-if="memory"
      :id="formId"
      :form="form"
      :default-values="aiMemoryDefaults(memory)"
      data-test="ai-memory-form"
    >
      <div class="flex flex-col gap-4">
        <OBanner
          v-if="conflict"
          variant="warning"
          preserve-whitespace
          data-test="ai-memory-conflict"
        >
          {{ t("aiMemory.conflict", { rev: conflict.rev }) }}
          <template #footer>
            <pre class="max-h-40 overflow-auto whitespace-pre-wrap">{{ conflict.content }}</pre>
          </template>
          <template #actions>
            <OButton
              size="xs"
              variant="outline"
              type="button"
              data-test="ai-memory-reapply"
              @click="reapply"
            >
              {{ t("aiMemory.reapply") }}
            </OButton>
            <OButton
              size="xs"
              variant="ghost"
              type="button"
              data-test="ai-memory-take-current"
              @click="takeCurrent"
            >
              {{ t("aiMemory.takeCurrent") }}
            </OButton>
          </template>
        </OBanner>

        <OFormTextarea
          name="content"
          :label="t('aiMemory.notes')"
          :placeholder="t('aiMemory.placeholder')"
          :rows="8"
          :help-text="sizeHint"
          data-test="ai-memory-text"
        />

        <OFormSwitch
          v-if="target.scope === 'user'"
          name="user_writes"
          :label="t('aiMemory.userWrites')"
          data-test="ai-memory-user-switch"
        />
        <template v-else>
          <OFormSelect
            name="agent_memory_writes"
            :label="t('aiMemory.writeMode')"
            :options="modeOptions"
            :disabled="!isAdmin"
            :help-text="modeHint"
            data-test="ai-memory-agent-writes"
          />
          <div v-if="isAdmin" class="flex flex-wrap gap-4">
            <OFormInput
              name="max_kib"
              type="number"
              :label="t('aiMemory.sizeLimit')"
              data-test="ai-memory-cap"
            />
            <OFormInput
              v-if="target.scope === 'org'"
              name="user_max_kib"
              type="number"
              :label="t('aiMemory.sizeLimitUser')"
              data-test="ai-memory-user-cap"
            />
          </div>
        </template>

        <div v-if="!embedded" class="flex items-center gap-2">
          <OButton size="sm" variant="primary" type="submit" data-test="ai-memory-save">
            {{ saveLabel }}
          </OButton>
        </div>
      </div>
    </OForm>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped } from "@/types/i18n";
import aiMemory, {
  type AgentMemoryWrites,
  type Memory,
  type MemoryTarget,
  type MemoryUpdate,
} from "@/services/ai_memory";
import { aiMemoryDefaults, makeAiMemorySchema, type AiMemoryForm } from "./AiMemoryEditor.schema";
import { formatBytes } from "./memory";

const props = defineProps<{
  target: MemoryTarget;
  title: string;
  /** Shows the text only, as the chat panel does for org memory. */
  readonly?: boolean;
  /** Renders no Save of its own: the host's footer button submits the form by `formId`. */
  embedded?: boolean;
  /** The `<form>` id a host Save button points at; defaults to one per memory. */
  formId?: string;
}>();

const emit = defineEmits<{ (_e: "saved"): void }>();

const { t } = useI18nTyped();
const store = useStore();
const org = () => store.state.selectedOrganization.identifier;

const memory = ref<Memory | null>(null);
const baseRev = ref(0);
const conflict = ref<{ rev: number; content: string } | null>(null);
const loading = ref(true);
const loadFailed = ref(false);

const testKey = computed(() =>
  props.target.scope === "toolset" ? `toolset-${props.target.toolsetId}` : props.target.scope,
);
const formId = computed(() => props.formId ?? `ai-memory-form-${testKey.value}`);
// Shared memory settings are a memory admin's; a user's own notes are always theirs.
const isAdmin = computed(() => props.target.scope === "user" || !!memory.value?.can_apply);
const saveLabel = computed(() =>
  memory.value?.can_apply === false ? t("aiMemory.submitForApproval") : t("common.save"),
);

const modeOptions = computed(() => [
  {
    label: props.target.scope === "toolset" ? t("aiMemory.inherit") : t("aiMemory.default"),
    // An empty value reads as "nothing selected" in the select, so the option could not be picked.
    value: "inherit",
  },
  { label: t("aiMemory.review"), value: "review" },
  { label: t("aiMemory.auto"), value: "auto" },
  { label: t("aiMemory.off"), value: "off" },
]);

const schema = makeAiMemorySchema(t);
const form = useOForm<AiMemoryForm>({
  defaultValues: aiMemoryDefaults(),
  schema,
  onSubmit: (values) => save(values),
});
const draft = form.useStore((s: any) => s.values.content as string);
const mode = form.useStore((s: any) => s.values.agent_memory_writes as string);

const maxKib = form.useStore((s: any) => s.values.max_kib as string);
// Follows the limit typed below, so the hint matches what Save will apply.
const shownMax = computed(() => {
  const kib = Number(maxKib.value);
  return maxKib.value !== "" && kib > 0 ? kib * 1024 : (memory.value?.max_bytes ?? 0);
});
const sizeHint = computed(() =>
  t("aiMemory.sizeHint", {
    size: formatBytes(new TextEncoder().encode(draft.value ?? "").length),
    max: formatBytes(shownMax.value),
  }),
);
const modeHint = computed(() => {
  const unset = !mode.value || mode.value === "inherit";
  const key = unset ? (props.target.scope === "toolset" ? "inherit" : "default") : mode.value;
  return t(`aiMemory.modeHint.${key}`);
});

const load = async () => {
  loading.value = true;
  loadFailed.value = false;
  try {
    const res = await aiMemory.get(org(), props.target);
    memory.value = res.data;
    baseRev.value = res.data.rev;
    conflict.value = null;
    form.reset(aiMemoryDefaults(res.data));
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
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

// Only what changed is sent, so a plain text edit never rewrites the settings.
const changes = (v: AiMemoryForm, m: Memory): MemoryUpdate => {
  const body: MemoryUpdate = {};
  if (v.content !== m.content) {
    body.content = v.content;
    body.base_rev = baseRev.value;
  }
  if (!isAdmin.value) return body;
  if (props.target.scope === "user") {
    if (v.user_writes !== (m.agent_memory_writes_effective !== "off")) {
      body.agent_memory_writes = v.user_writes ? "on" : "off";
    }
    return body;
  }
  if (v.agent_memory_writes !== (m.agent_memory_writes || "inherit")) {
    body.agent_memory_writes = v.agent_memory_writes as AgentMemoryWrites | "inherit";
  }
  const maxKib = Number(v.max_kib);
  if (v.max_kib !== "" && maxKib * 1024 !== m.max_bytes) body.max_bytes = Math.round(maxKib * 1024);
  const userKib = Number(v.user_max_kib);
  if (
    props.target.scope === "org" &&
    v.user_max_kib !== "" &&
    userKib * 1024 !== (m.user_max_bytes ?? 0)
  ) {
    body.user_max_bytes = Math.round(userKib * 1024);
  }
  return body;
};

const save = async (values: AiMemoryForm) => {
  if (!memory.value) return;
  const body = changes(values, memory.value);
  if (!Object.keys(body).length) return;
  try {
    const res = await aiMemory.update(org(), props.target, body);
    if (res.status === 202 || res.data?.state === "pending") {
      toast({ variant: "success", message: t("aiMemory.sentForApproval") });
    } else {
      await load();
      toast({ variant: "success", message: t("aiMemory.saved", { rev: memory.value?.rev }) });
    }
    emit("saved");
  } catch (err: any) {
    const data = err?.response?.data ?? {};
    if (err?.response?.status === 409 && data.code === "rev_conflict") {
      conflict.value = { rev: data.rev, content: data.content ?? "" };
    } else {
      toast({ variant: "error", message: failure(err) });
    }
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
  form.setFieldValue("content", conflict.value.content);
  baseRev.value = conflict.value.rev;
  conflict.value = null;
};

defineExpose({ load, formId, saveLabel });
</script>
