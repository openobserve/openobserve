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
  <div class="tw:rounded-md tw:p-0" style="min-height: inherit">
    <!-- Header -->
    <div class="tw:flex tw:items-center tw:flex-nowrap tw:mx-3 tw:pt-2">
      <div class="tw:flex tw:items-center tw:py-2">
        <div
          class="el-border tw:w-6 tw:h-6 tw:flex tw:items-center tw:justify-center tw:cursor-pointer el-border-radius tw:mr-2"
          :title="t('common.goBack')"
          @click="$emit('cancel:hideform')"
        >
          <OIcon name="arrow-back-ios-new" size="xs" />
        </div>
        <div class="tw:flex tw:flex-col">
          <div class="tw:text-xl tw:font-semibold">
            {{ isEditing ? t("aiToolset.update") : t("aiToolset.add") }}
          </div>
        </div>
      </div>
    </div>
    <OSeparator />

    <div
      style="height: calc(100vh - 120px); overflow: auto"
    >
      <div class="tw:max-w-2xl tw:mx-4 tw:mt-4">
        <!-- Name -->
        <div class="o2-input tw:mb-4">
          <OInput
            data-test="ai-toolset-name-input"
            v-model="form.name"
            :label="t('aiToolset.name') + ' *'"
            class="showLabelOnTop tw:w-full"
            :readonly="isEditing"
            :disabled="isEditing"
            :error="!!nameError"
            :error-message="nameError"
            @update:model-value="nameError = ''"
          />
        </div>

        <!-- Kind -->
        <div class="o2-input tw:mb-4">
          <OSelect
            data-test="ai-toolset-kind-select"
            v-model="form.kind"
            :label="t('aiToolset.kind') + ' *'"
            :options="kindOptions"
            labelKey="label"
            valueKey="value"
            class="showLabelOnTop tw:w-full"
            :disabled="isEditing"
            :error="!!kindError"
            :error-message="kindError"
            @update:model-value="kindError = ''"
          />
        </div>

        <!-- Description -->
        <div class="o2-input tw:mb-4">
          <OTextarea
            data-test="ai-toolset-description-input"
            v-model="form.description"
            :label="t('aiToolset.description')"
            class="showLabelOnTop tw:w-full"
          />
        </div>

        <!-- MCP fields -->
        <template v-if="form.kind === 'mcp'">
          <div class="tw:text-base tw:font-medium tw:font-semibold tw:mb-3">
            {{ t("aiToolset.mcpConfig") }}
          </div>
          <div class="o2-input tw:mb-4">
            <OInput
              data-test="ai-toolset-mcp-url"
              v-model="mcpData.url"
              :label="t('aiToolset.mcpUrl') + ' *'"
              class="showLabelOnTop tw:w-full"
              placeholder="https://api.example.com/mcp/"
              :error="!!mcpUrlError"
              :error-message="mcpUrlError"
              @update:model-value="mcpUrlError = ''"
            />
          </div>
          <div class="o2-input tw:mb-4">
            <OInput
              data-test="ai-toolset-mcp-timeout"
              v-model.number="mcpData.timeout_seconds"
              :label="t('aiToolset.timeoutSeconds')"
              class="showLabelOnTop tw:w-full"
              type="number"
              min="1"
            />
          </div>
          <!-- Headers -->
          <div class="tw:mb-2 tw:text-sm tw:font-medium">{{ t("aiToolset.headers") }}</div>
          <div
            v-for="(header, idx) in mcpHeaders"
            :key="idx"
            class="tw:flex tw:gap-2 tw:mb-2"
          >
            <OInput
              v-model="header.key"
              :label="t('aiToolset.headerKey')"
              class="o2-input tw:flex-1"
            />
            <OInput
              v-model="header.value"
              :label="t('aiToolset.headerValue')"
              class="o2-input tw:flex-1"
              :type="header.visible ? 'text' : 'password'"
            >
              <template #icon-right>
                <OIcon
                  :name="header.visible ? 'visibility-off' : 'visibility'" size="sm"
                  class="tw:cursor-pointer"
                  @click="header.visible = !header.visible"
                />
              </template>
            </OInput>
            <OButton
              variant="ghost-destructive"
              size="icon-xs-sq"
              @click="removeHeader(idx)"
            >
              <OIcon name="delete" size="xs" />
            </OButton>
          </div>
          <OButton variant="ghost" size="sm" class="tw:mb-4" @click="addHeader" icon-left="add">
            {{ t("aiToolset.addHeader") }}
          </OButton>
        </template>

        <!-- CLI fields -->
        <template v-if="form.kind === 'cli'">
          <div class="tw:flex tw:items-center tw:gap-3 tw:mb-4">
            <div class="tw:text-base tw:font-medium tw:font-semibold">
              {{ t("aiToolset.cliConfig") }}
            </div>
            <div class="tw:flex tw:items-center tw:gap-1">
              <span class="tw:text-xs tw:text-gray-400"
                >{{ t("aiToolset.presets") }}:</span
              >
              <OBadge
                v-for="preset in CLI_PRESETS"
                :key="preset.id"
                clickable
                variant="primary-soft"
                class="tw:cursor-pointer"
                :data-test="`cli-preset-${preset.id}`"
                @click="applyPreset(preset)"
              >
                {{ preset.label }}
              </OBadge>
            </div>
          </div>
          <div class="o2-input tw:mb-4">
            <OInput
              data-test="ai-toolset-cli-command"
              v-model="cliData.command"
              :label="t('aiToolset.cliCommand') + ' *'"
              class="showLabelOnTop tw:w-full"
              placeholder="kubectl"
              :error="!!cliCommandError"
              :error-message="cliCommandError"
              @update:model-value="cliCommandError = ''"
            />
          </div>
          <div class="o2-input tw:mb-4">
            <OInput
              v-model="cliData.allowed_subcommands_raw"
              :label="t('aiToolset.allowedSubcommands')"
              :helpText="t('aiToolset.subcommandsHint')"
              class="showLabelOnTop tw:w-full"
              placeholder="get, describe, logs"
            />
          </div>
          <div class="tw:flex tw:gap-4 tw:mb-4">
            <div class="o2-input tw:flex-1">
              <OInput
                v-model.number="cliData.timeout_seconds"
                :label="t('aiToolset.timeoutSeconds')"
                class="showLabelOnTop tw:w-full"
                type="number"
                min="1"
              />
            </div>
            <div class="o2-input tw:flex-1">
              <OInput
                v-model.number="cliData.max_output_bytes"
                :label="t('aiToolset.maxOutputBytes')"
                class="showLabelOnTop tw:w-full"
                type="number"
                min="1"
              />
            </div>
          </div>
          <div class="tw:mb-4">
            <OSwitch
              v-model="cliData.requires_confirmation"
              :label="t('aiToolset.requiresConfirmation')"
            />
          </div>
          <!-- Env vars -->
          <div class="tw:mb-2 tw:text-sm tw:font-medium">{{ t("aiToolset.envVars") }}</div>
          <div
            v-for="(env, idx) in cliEnvVars"
            :key="'env-' + idx"
            class="tw:flex tw:gap-2 tw:mb-2"
          >
            <OInput
              v-model="env.key"
              :label="t('aiToolset.envKey')"
              class="o2-input tw:flex-1"
            />
            <OInput
              v-model="env.value"
              :label="t('aiToolset.envValue')"
              class="o2-input tw:flex-1"
              :type="env.visible ? 'text' : 'password'"
            >
              <template #icon-right>
                <OIcon
                  :name="env.visible ? 'visibility-off' : 'visibility'" size="sm"
                  class="tw:cursor-pointer"
                  @click="env.visible = !env.visible"
                />
              </template>
            </OInput>
            <OButton
              variant="ghost-destructive"
              size="icon-xs-sq"
              @click="removeEnvVar(idx)"
            >
              <OIcon name="delete" size="xs" />
            </OButton>
          </div>
          <OButton variant="ghost" size="sm" class="tw:mb-4" @click="addEnvVar" icon-left="add">
            {{ t("aiToolset.addEnvVar") }}
          </OButton>

          <!-- Credential files -->
          <div class="tw:mb-2 tw:text-sm tw:font-medium">
            {{ t("aiToolset.credentialFiles") }}
          </div>
          <div
            v-for="(cred, idx) in cliCredFiles"
            :key="'cred-' + idx"
            class="tw:mb-4"
          >
            <div class="tw:flex tw:items-center tw:gap-2 tw:mb-1">
              <OInput
                v-model="cred.key"
                :label="t('aiToolset.credEnvVar')"
                helpText="e.g. KUBECONFIG"
                class="o2-input tw:w-48"
              />
              <OButton
                variant="ghost-destructive"
                size="icon-xs-sq"
                :title="t('common.delete')"
                @click="removeCredFile(idx)"
              >
                <OIcon name="delete" size="xs" />
              </OButton>
            </div>
            <div class="tw:text-xs tw:text-gray-500 tw:mb-1">
              {{ t("aiToolset.credContentHint") }}
            </div>
            <query-editor
              :editor-id="`cred-file-editor-${idx}`"
              class="monaco-editor-cred"
              language="yaml"
              v-model:query="cred.value"
            />
          </div>
          <OButton
            variant="ghost"
            size="sm"
            class="tw:mb-4"
            @click="addCredFile"
            icon-left="add"
          >
            {{ t("aiToolset.addCredFile") }}
          </OButton>
        </template>

        <!-- Skill fields -->
        <template v-if="form.kind === 'skill'">
          <div class="tw:text-base tw:font-medium tw:font-semibold tw:mb-2">
            {{ t("aiToolset.skillConfig") }}
          </div>
          <div class="tw:mb-1 tw:text-xs tw:text-gray-400">
            {{ t("aiToolset.skillContent") }} *
          </div>
          <query-editor
            data-test="ai-toolset-skill-content"
            editor-id="skill-content-editor"
            class="monaco-editor tw:mb-3"
            language="markdown"
            v-model:query="skillData.content"
          />
          <div
            v-if="skillContentError"
            class="tw:text-red-500 tw:text-xs tw:mt-[-12px] tw:mb-4"
          >
            {{ t("aiToolset.skillContentRequired") }}
          </div>
        </template>
      </div>

      <!-- Footer -->
      <div
        class="tw:flex tw:items-center tw:gap-2 tw:px-4 tw:py-3 tw:border-t-[1px] tw:sticky tw:bottom-0 tw:bg-white dark:tw:bg-[#1a1a1a]"
      >
        <OButton
          data-test="ai-toolset-save-btn"
          variant="primary"
          size="sm-action"
          @click="onSubmit"
          :loading="saving"
        >
          {{ isEditing ? t("common.update") : t("common.save") }}
        </OButton>
        <OButton
          data-test="ai-toolset-cancel-btn"
          variant="outline"
          size="sm-action"
          @click="$emit('cancel:hideform')"
        >
          {{ t("common.cancel") }}
        </OButton>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineAsyncComponent,
  defineComponent,
  ref,
  watch,
  onMounted,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import aiToolsetsService from "@/services/ai_toolsets";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import type { ToolsetKind } from "@/services/ai_toolsets";
import { toast } from "@/lib/feedback/Toast/useToast";

const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
);

export default defineComponent({
  name: "AddAiToolset",
  components: { OSeparator, OBadge, OButton, OIcon, OInput, OSelect, OSwitch, OTextarea, QueryEditor },
  emits: ["cancel:hideform"],
  setup(_, { emit }) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const formRef = ref<any>(null);
    const saving = ref(false);
    const nameError = ref('');
    const kindError = ref('');
    const mcpUrlError = ref('');
    const cliCommandError = ref('');

    const editingId = ref<string | null>(null);
    const isEditing = ref(false);

    // -----------------------------------------------------------------------
    // Form model
    // -----------------------------------------------------------------------
    const form = ref({
      name: "",
      kind: "mcp" as ToolsetKind,
      description: "",
    });

    const kindOptions = [
      { label: "MCP Server", value: "mcp" },
      { label: "CLI Tool", value: "cli" },
      { label: "Skill", value: "skill" },
    ];

    // -----------------------------------------------------------------------
    // Built-in CLI presets
    // -----------------------------------------------------------------------
    const CLI_PRESETS = [
      {
        id: "kubectl",
        label: "kubectl",
        command: "kubectl",
        allowed_subcommands: "get, describe, logs, top",
        env: [] as Array<{ key: string; value: string; visible: boolean }>,
        credential_files: [{ key: "KUBECONFIG", value: "" }],
      },
      {
        id: "gh",
        label: "gh",
        command: "gh",
        allowed_subcommands: "*",
        env: [{ key: "GH_TOKEN", value: "", visible: false }],
        credential_files: [] as Array<{ key: string; value: string }>,
      },
    ];

    const applyPreset = (preset: (typeof CLI_PRESETS)[number]) => {
      cliData.value.command = preset.command;
      cliData.value.allowed_subcommands_raw = preset.allowed_subcommands;
      // Replace env and cred arrays — keep empty placeholders so the user
      // can see exactly which fields to fill in.
      cliEnvVars.value = preset.env.map((e) => ({ ...e }));
      cliCredFiles.value = preset.credential_files.map((c) => ({ ...c }));
    };

    // MCP
    const mcpData = ref({ url: "", timeout_seconds: 30 });
    const mcpHeaders = ref<
      Array<{ key: string; value: string; visible: boolean }>
    >([]);
    const addHeader = () =>
      mcpHeaders.value.push({ key: "", value: "", visible: false });
    const removeHeader = (i: number) => mcpHeaders.value.splice(i, 1);

    // CLI
    const cliData = ref({
      command: "",
      allowed_subcommands_raw: "",
      timeout_seconds: 30,
      max_output_bytes: 100000,
      requires_confirmation: false,
    });
    const cliEnvVars = ref<
      Array<{ key: string; value: string; visible: boolean }>
    >([]);
    const cliCredFiles = ref<Array<{ key: string; value: string }>>([]);
    const addEnvVar = () =>
      cliEnvVars.value.push({ key: "", value: "", visible: false });
    const removeEnvVar = (i: number) => cliEnvVars.value.splice(i, 1);
    const addCredFile = () => cliCredFiles.value.push({ key: "", value: "" });
    const removeCredFile = (i: number) => cliCredFiles.value.splice(i, 1);

    // Skill
    const skillData = ref({ content: "" });
    const skillContentError = ref(false);

    // -----------------------------------------------------------------------
    // Load existing toolset when editing
    // -----------------------------------------------------------------------
    const loadForEdit = async (id: string) => {
      const org = store.state.selectedOrganization.identifier;
      try {
        const res = await aiToolsetsService.get(org, id);
        const t = res.data;
        form.value.name = t.name;
        form.value.kind = t.kind;
        form.value.description = t.description || "";
        editingId.value = t.id;
        isEditing.value = true;

        const data = t.data || {};
        if (t.kind === "mcp") {
          mcpData.value.url = data.url || "";
          mcpData.value.timeout_seconds = data.timeout_seconds ?? 30;
          mcpHeaders.value = Object.entries(data.headers || {}).map(
            ([k, v]) => ({ key: k, value: v as string, visible: false }),
          );
        } else if (t.kind === "cli") {
          cliData.value.command = data.command || "";
          cliData.value.allowed_subcommands_raw = (
            data.allowed_subcommands || []
          ).join(", ");
          cliData.value.timeout_seconds = data.timeout_seconds ?? 30;
          cliData.value.max_output_bytes = data.max_output_bytes ?? 100000;
          cliData.value.requires_confirmation =
            data.requires_confirmation ?? false;
          cliEnvVars.value = Object.entries(data.env || {}).map(([k, v]) => ({
            key: k,
            value: v as string,
            visible: false,
          }));
          cliCredFiles.value = Object.entries(data.credential_files || {}).map(
            ([k, v]) => ({ key: k, value: v as string }),
          );
        } else if (t.kind === "skill") {
          skillData.value.content = data.content || "";
        }
      } catch {
        toast({ variant: "error", message: "Failed to load toolset" });
      }
    };

    onMounted(() => {
      const query = router.currentRoute.value.query;
      if (query.action === "edit" && query.id) {
        loadForEdit(query.id as string);
      }
    });

    // -----------------------------------------------------------------------
    // Build data payload
    // -----------------------------------------------------------------------
    const buildData = () => {
      const kind = form.value.kind;
      if (kind === "mcp") {
        const headers: Record<string, string> = {};
        mcpHeaders.value
          .filter((h) => h.key.trim())
          .forEach((h) => {
            headers[h.key.trim()] = h.value;
          });
        return {
          url: mcpData.value.url,
          headers,
          timeout_seconds: mcpData.value.timeout_seconds,
        };
      }
      if (kind === "cli") {
        const allowed = cliData.value.allowed_subcommands_raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const env: Record<string, string> = {};
        cliEnvVars.value
          .filter((e) => e.key.trim())
          .forEach((e) => {
            env[e.key.trim()] = e.value;
          });
        const credential_files: Record<string, string> = {};
        cliCredFiles.value
          .filter((c) => c.key.trim())
          .forEach((c) => {
            credential_files[c.key.trim()] = c.value;
          });
        return {
          command: cliData.value.command,
          ...(allowed.length ? { allowed_subcommands: allowed } : {}),
          timeout_seconds: cliData.value.timeout_seconds,
          max_output_bytes: cliData.value.max_output_bytes,
          requires_confirmation: cliData.value.requires_confirmation,
          env,
          credential_files,
        };
      }
      if (kind === "skill") {
        return { content: skillData.value.content };
      }
      return {};
    };

    // -----------------------------------------------------------------------
    // Submit
    // -----------------------------------------------------------------------
    const onSubmit = async () => {
      // Validate manually
      nameError.value = !form.value.name
        ? t('aiToolset.nameRequired')
        : !/^[a-zA-Z0-9_-]+$/.test(form.value.name)
        ? t('aiToolset.nameInvalid')
        : form.value.name.length > 256
        ? t('aiToolset.nameTooLong')
        : '';
      kindError.value = !form.value.kind ? t('aiToolset.kindRequired') : '';
      mcpUrlError.value = form.value.kind === 'mcp' && !mcpData.value.url ? t('aiToolset.mcpUrlRequired') : '';
      cliCommandError.value = form.value.kind === 'cli' && !cliData.value.command ? t('aiToolset.cliCommandRequired') : '';
      // Monaco editor is outside form validation — check skill content manually.
      if (form.value.kind === "skill") {
        skillContentError.value = !skillData.value.content.trim();
      }
      if (nameError.value || kindError.value || mcpUrlError.value || cliCommandError.value || skillContentError.value) return;

      saving.value = true;
      const org = store.state.selectedOrganization.identifier;
      const data = buildData();

      try {
        if (isEditing.value && editingId.value) {
          await aiToolsetsService.update(org, editingId.value, {
            description: form.value.description || undefined,
            data,
          });
          toast({
            variant: "success",
            message: t("aiToolset.updatedSuccessfully"),
          });
        } else {
          await aiToolsetsService.create(org, {
            name: form.value.name,
            kind: form.value.kind,
            description: form.value.description || undefined,
            data,
          });
          toast({
            variant: "success",
            message: t("aiToolset.createdSuccessfully"),
          });
        }
        emit("cancel:hideform");
      } catch (err: any) {
        const msg =
          err?.response?.data?.message ||
          (isEditing.value
            ? t("aiToolset.updateFailed")
            : t("aiToolset.createFailed"));
        toast({ variant: "error", message: msg });
      } finally {
        saving.value = false;
      }
    };

    return {
      t,
      store,
      formRef,
      form,
      isEditing,
      saving,
      nameError,
      kindError,
      mcpUrlError,
      cliCommandError,
      kindOptions,
      // MCP
      mcpData,
      mcpHeaders,
      addHeader,
      removeHeader,
      // CLI
      cliData,
      cliEnvVars,
      cliCredFiles,
      addEnvVar,
      removeEnvVar,
      addCredFile,
      removeCredFile,
      CLI_PRESETS,
      applyPreset,
      // Skill
      skillData,
      skillContentError,
      onSubmit,
    };
  },
});
</script>

<style lang="scss" scoped>
/* Skill definition editor — full-height markdown area */
.monaco-editor {
  width: 100%;
  min-height: 400px !important;
  border-radius: 5px;
  border: 1px solid var(--o2-border-color);
  resize: vertical;
  overflow: auto;
}

/* Credential file editor — generous but shorter than skill */
.monaco-editor-cred {
  width: 100%;
  min-height: 200px !important;
  border-radius: 5px;
  border: 1px solid var(--o2-border-color);
  resize: vertical;
  overflow: auto;
}
</style>
