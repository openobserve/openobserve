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
  <div class="tw:rounded-md q-pa-none" style="min-height: inherit">
    <!-- Header -->
    <div class="row items-center no-wrap q-mx-md q-pt-sm">
      <div class="flex items-center tw:py-2">
        <div
          class="el-border tw:w-6 tw:h-6 flex items-center justify-center cursor-pointer el-border-radius q-mr-sm"
          :title="t('common.goBack')"
          @click="$emit('cancel:hideform')"
        >
          <OIcon name="arrow-back-ios-new" size="xs" />
        </div>
        <div class="col">
          <div class="text-h6">
            {{ isEditing ? t("aiToolset.update") : t("aiToolset.add") }}
          </div>
        </div>
      </div>
    </div>
    <q-separator />

    <q-form
      ref="formRef"
      @submit="onSubmit"
      style="height: calc(100vh - 120px); overflow: auto"
    >
      <div class="tw:max-w-2xl tw:mx-4 tw:mt-4">
        <!-- Name -->
        <div class="o2-input tw:mb-4">
          <q-input
            data-test="ai-toolset-name-input"
            v-model="form.name"
            :label="t('aiToolset.name') + ' *'"
            class="showLabelOnTop full-width"
            stack-label
            borderless
            dense
            :readonly="isEditing"
            :disable="isEditing"
            :rules="[
              (val: string) => !!val || t('aiToolset.nameRequired'),
              (val: string) =>
                /^[a-zA-Z0-9_-]+$/.test(val) || t('aiToolset.nameInvalid'),
              (val: string) => val.length <= 256 || t('aiToolset.nameTooLong'),
            ]"
          />
        </div>

        <!-- Kind -->
        <div class="o2-input tw:mb-4">
          <q-select
            data-test="ai-toolset-kind-select"
            v-model="form.kind"
            :label="t('aiToolset.kind') + ' *'"
            :options="kindOptions"
            class="showLabelOnTop full-width"
            stack-label
            borderless
            dense
            emit-value
            map-options
            :readonly="isEditing"
            :disable="isEditing"
            :rules="[(val: string) => !!val || t('aiToolset.kindRequired')]"
          />
        </div>

        <!-- Description -->
        <div class="o2-input tw:mb-4">
          <q-input
            data-test="ai-toolset-description-input"
            v-model="form.description"
            :label="t('aiToolset.description')"
            class="showLabelOnTop full-width"
            stack-label
            borderless
            dense
            autogrow
          />
        </div>

        <!-- MCP fields -->
        <template v-if="form.kind === 'mcp'">
          <div class="text-subtitle1 tw:font-semibold tw:mb-3">
            {{ t("aiToolset.mcpConfig") }}
          </div>
          <div class="o2-input tw:mb-4">
            <q-input
              data-test="ai-toolset-mcp-url"
              v-model="mcpData.url"
              :label="t('aiToolset.mcpUrl') + ' *'"
              class="showLabelOnTop full-width"
              stack-label
              borderless
              dense
              placeholder="https://api.example.com/mcp/"
              :rules="[(val: string) => !!val || t('aiToolset.mcpUrlRequired')]"
            />
          </div>
          <div class="o2-input tw:mb-4">
            <q-input
              data-test="ai-toolset-mcp-timeout"
              v-model.number="mcpData.timeout_seconds"
              :label="t('aiToolset.timeoutSeconds')"
              class="showLabelOnTop full-width"
              stack-label
              borderless
              dense
              type="number"
              min="1"
            />
          </div>
          <!-- Headers -->
          <div class="tw:mb-2 text-subtitle2">{{ t("aiToolset.headers") }}</div>
          <div
            v-for="(header, idx) in mcpHeaders"
            :key="idx"
            class="tw:flex tw:gap-2 tw:mb-2"
          >
            <q-input
              v-model="header.key"
              :label="t('aiToolset.headerKey')"
              borderless
              dense
              class="o2-input tw:flex-1"
            />
            <q-input
              v-model="header.value"
              :label="t('aiToolset.headerValue')"
              borderless
              dense
              class="o2-input tw:flex-1"
              :type="header.visible ? 'text' : 'password'"
            >
              <template #append>
                <OIcon
                  :name="header.visible ? 'visibility-off' : 'visibility'" size="sm"
                  class="cursor-pointer"
                  @click="header.visible = !header.visible"
                />
              </template>
            </q-input>
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
            <div class="text-subtitle1 tw:font-semibold">
              {{ t("aiToolset.cliConfig") }}
            </div>
            <div class="tw:flex tw:items-center tw:gap-1">
              <span class="text-caption text-grey-6"
                >{{ t("aiToolset.presets") }}:</span
              >
              <q-chip
                v-for="preset in CLI_PRESETS"
                :key="preset.id"
                clickable
                dense
                color="blue-1"
                text-color="blue-9"
                class="tw:cursor-pointer"
                :data-test="`cli-preset-${preset.id}`"
                @click="applyPreset(preset)"
              >
                {{ preset.label }}
              </q-chip>
            </div>
          </div>
          <div class="o2-input tw:mb-4">
            <q-input
              data-test="ai-toolset-cli-command"
              v-model="cliData.command"
              :label="t('aiToolset.cliCommand') + ' *'"
              class="showLabelOnTop full-width"
              stack-label
              borderless
              dense
              placeholder="kubectl"
              :rules="[
                (val: string) => !!val || t('aiToolset.cliCommandRequired'),
              ]"
            />
          </div>
          <div class="o2-input tw:mb-4">
            <q-input
              v-model="cliData.allowed_subcommands_raw"
              :label="t('aiToolset.allowedSubcommands')"
              :hint="t('aiToolset.subcommandsHint')"
              class="showLabelOnTop full-width"
              stack-label
              borderless
              dense
              placeholder="get, describe, logs"
            />
          </div>
          <div class="tw:flex tw:gap-4 tw:mb-4">
            <div class="o2-input tw:flex-1">
              <q-input
                v-model.number="cliData.timeout_seconds"
                :label="t('aiToolset.timeoutSeconds')"
                class="showLabelOnTop full-width"
                stack-label
                borderless
                dense
                type="number"
                min="1"
              />
            </div>
            <div class="o2-input tw:flex-1">
              <q-input
                v-model.number="cliData.max_output_bytes"
                :label="t('aiToolset.maxOutputBytes')"
                class="showLabelOnTop full-width"
                stack-label
                borderless
                dense
                type="number"
                min="1"
              />
            </div>
          </div>
          <div class="tw:mb-4">
            <q-toggle
              v-model="cliData.requires_confirmation"
              :label="t('aiToolset.requiresConfirmation')"
              dense
            />
          </div>
          <!-- Env vars -->
          <div class="tw:mb-2 text-subtitle2">{{ t("aiToolset.envVars") }}</div>
          <div
            v-for="(env, idx) in cliEnvVars"
            :key="'env-' + idx"
            class="tw:flex tw:gap-2 tw:mb-2"
          >
            <q-input
              v-model="env.key"
              :label="t('aiToolset.envKey')"
              borderless
              dense
              class="o2-input tw:flex-1"
            />
            <q-input
              v-model="env.value"
              :label="t('aiToolset.envValue')"
              borderless
              dense
              class="o2-input tw:flex-1"
              :type="env.visible ? 'text' : 'password'"
            >
              <template #append>
                <OIcon
                  :name="env.visible ? 'visibility-off' : 'visibility'" size="sm"
                  class="cursor-pointer"
                  @click="env.visible = !env.visible"
                />
              </template>
            </q-input>
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
          <div class="tw:mb-2 text-subtitle2">
            {{ t("aiToolset.credentialFiles") }}
          </div>
          <div
            v-for="(cred, idx) in cliCredFiles"
            :key="'cred-' + idx"
            class="tw:mb-4"
          >
            <div class="tw:flex tw:items-center tw:gap-2 tw:mb-1">
              <q-input
                v-model="cred.key"
                :label="t('aiToolset.credEnvVar')"
                hint="e.g. KUBECONFIG"
                borderless
                dense
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
          <div class="text-subtitle1 tw:font-semibold tw:mb-2">
            {{ t("aiToolset.skillConfig") }}
          </div>
          <div class="tw:mb-1 text-caption text-grey-7">
            {{ t("aiToolset.skillContent") }} *
          </div>
          <query-editor
            data-test="ai-toolset-skill-content"
            editor-id="skill-content-editor"
            class="monaco-editor q-mb-md"
            language="markdown"
            v-model:query="skillData.content"
          />
          <div
            v-if="skillContentError"
            class="text-negative text-caption tw:mt-[-12px] tw:mb-4"
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
          type="submit"
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
    </q-form>
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
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import aiToolsetsService from "@/services/ai_toolsets";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { ToolsetKind } from "@/services/ai_toolsets";

const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
);

export default defineComponent({
  name: "AddAiToolset",
  components: { QueryEditor, OButton,
    OIcon,
},
  emits: ["cancel:hideform"],
  setup(_, { emit }) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const formRef = ref<any>(null);
    const saving = ref(false);

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
        $q.notify({ type: "negative", message: "Failed to load toolset" });
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
      const valid = await formRef.value?.validate();
      // Monaco editor is outside q-form validation — check skill content manually.
      if (form.value.kind === "skill") {
        skillContentError.value = !skillData.value.content.trim();
        if (skillContentError.value) return;
      }
      if (!valid) return;

      saving.value = true;
      const org = store.state.selectedOrganization.identifier;
      const data = buildData();

      try {
        if (isEditing.value && editingId.value) {
          await aiToolsetsService.update(org, editingId.value, {
            description: form.value.description || undefined,
            data,
          });
          $q.notify({
            type: "positive",
            message: t("aiToolset.updatedSuccessfully"),
            timeout: 2000,
          });
        } else {
          await aiToolsetsService.create(org, {
            name: form.value.name,
            kind: form.value.kind,
            description: form.value.description || undefined,
            data,
          });
          $q.notify({
            type: "positive",
            message: t("aiToolset.createdSuccessfully"),
            timeout: 2000,
          });
        }
        emit("cancel:hideform");
      } catch (err: any) {
        const msg =
          err?.response?.data?.message ||
          (isEditing.value
            ? t("aiToolset.updateFailed")
            : t("aiToolset.createFailed"));
        $q.notify({ type: "negative", message: msg, timeout: 4000 });
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
