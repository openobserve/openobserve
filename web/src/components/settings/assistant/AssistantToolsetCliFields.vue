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
  <div class="flex flex-col gap-4" data-test="ai-toolset-cli-fields">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-text-heading text-sm font-semibold">
        {{ t("assistant.toolsets.form.cliSection") }}
      </h3>
      <template v-if="!editing">
        <span class="text-text-secondary text-xs">{{ t("assistant.toolsets.form.presets") }}</span>
        <OButton
          v-for="preset in CLI_PRESETS"
          :key="preset.id"
          variant="outline"
          size="xs"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          :data-test="`cli-preset-${preset.id}`"
          @click="applyPreset(preset)"
          >{{ raw(preset.command) }}</OButton
        >
      </template>
    </div>
    <OFormInput
      name="cli.command"
      :label="t('aiToolset.cliCommand')"
      required
      data-test="ai-toolset-cli-command"
    />
    <OFormInput
      name="cli.allowed_subcommands_raw"
      :label="t('aiToolset.allowedSubcommands')"
      :help-text="t('assistant.toolsets.form.allowHelp')"
      required
      data-test="ai-toolset-cli-allowed"
    />
    <div class="flex flex-col gap-1">
      <OFormSwitch
        name="cli.requires_confirmation"
        :label="t('assistant.toolsets.form.requireApproval')"
        :aria-describedby="approvalId"
        data-test="ai-toolset-cli-approval"
      />
      <p
        :id="approvalId"
        :class="approval ? 'text-text-secondary' : 'text-status-warning-text'"
        class="text-xs"
        data-test="ai-toolset-cli-approval-line"
      >
        {{
          approval
            ? t("assistant.toolsets.form.approvalOn")
            : t("assistant.toolsets.form.approvalOff")
        }}
      </p>
    </div>
    <div class="flex flex-wrap gap-4 max-md:flex-col">
      <OFormInput
        name="cli.timeout_seconds"
        type="number"
        min="1"
        :label="t('aiToolset.timeoutSeconds')"
        class="min-w-0 flex-1"
      />
      <OFormInput
        name="cli.max_output_bytes"
        type="number"
        min="1"
        :label="t('aiToolset.maxOutputBytes')"
        class="min-w-0 flex-1"
      />
    </div>
    <div class="flex flex-wrap items-center gap-1" data-test="ai-toolset-cli-scope">
      <p class="text-text-body text-sm">{{ t("assistant.toolsets.form.scope") }}</p>
      <OPopover :aria-label="t('assistant.toolsets.form.aboutCliLabel')">
        <template #trigger>
          <OButton
            variant="ghost"
            size="icon-sm"
            :icon-left="assistantGlyph.info"
            class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            :aria-label="t('assistant.toolsets.form.aboutCliLabel')"
            data-test="ai-toolset-cli-about"
          />
        </template>
        <p
          class="text-text-body max-w-80 p-3 text-sm break-words"
          data-test="ai-toolset-cli-about-body"
        >
          {{ t("assistant.toolsets.form.aboutCli", { timeout: cliTimeout, bytes: cliBytes }) }}
        </p>
      </OPopover>
    </div>
    <AssistantToolsetSecretRows :form="form" field="cli.env" kind="env" :rows="envRows" />
    <AssistantToolsetSecretRows :form="form" field="cli.credFiles" kind="file" :rows="fileRows" />
  </div>
</template>

<script setup lang="ts">
import { useId } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OButton from "@/lib/core/Button/OButton.vue";
import type { FormContextValue } from "@/lib/forms/Form/OForm.types";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { raw, useI18nTyped } from "@/types/i18n";

import type { SecretRow, ToolsetFormValues } from "./AssistantToolsetForm.schema";
import AssistantToolsetSecretRows from "./AssistantToolsetSecretRows.vue";
import { CLI_PRESETS } from "./assistantToolsets";

type FormState = { values: ToolsetFormValues };

const props = defineProps<{ form: FormContextValue; editing: boolean }>();

const { t } = useI18nTyped();
const approvalId = useId();

const envRows = props.form.useStore((s: FormState): SecretRow[] => s.values.cli.env);
const fileRows = props.form.useStore((s: FormState): SecretRow[] => s.values.cli.credFiles);
const approval = props.form.useStore((s: FormState) => s.values.cli.requires_confirmation);
const cliTimeout = props.form.useStore(
  (s: FormState) => Number(s.values.cli.timeout_seconds) || 30,
);
const cliBytes = props.form.useStore(
  (s: FormState) => Number(s.values.cli.max_output_bytes) || 100000,
);

/** Presets fill a new toolset only; on a saved one they would replace stored credentials. */
function applyPreset(preset: (typeof CLI_PRESETS)[number]) {
  props.form.setFieldValue("cli.command", preset.command);
  props.form.setFieldValue("cli.allowed_subcommands_raw", preset.allow);
  props.form.setFieldValue(
    "cli.env",
    preset.env.map((key) => ({ key, value: "", state: "new" as const })),
  );
  props.form.setFieldValue(
    "cli.credFiles",
    preset.files.map((key) => ({ key, value: "", state: "new" as const })),
  );
}
</script>
