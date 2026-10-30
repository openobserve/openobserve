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
  <div
    class="rounded-default border-border-default flex min-h-0 min-w-0 flex-col overflow-hidden border"
    :data-test="dataTest"
  >
    <div
      class="border-border-default bg-surface-panel flex shrink-0 items-center gap-2 border-b py-1 ps-3 pe-1"
    >
      <span v-if="filename" class="font-mono text-xs font-semibold opacity-75">{{ filename }}</span>
      <div class="flex-1" />
      <OButton
        variant="ghost"
        size="icon-xs-sq"
        icon-left="content-copy"
        :aria-label="t('common.copy')"
        :data-test="`${dataTest}-copy-btn`"
        @click="copy"
      >
        <OTooltip :content="t('common.copy')" side="top" />
      </OButton>
    </div>
    <CodeQueryEditor
      :editor-id="editorId"
      class="min-h-0 min-w-0 flex-1"
      :query="code"
      :language="language"
      :read-only="!editable"
      :show-auto-complete="false"
      @update:query="(value: string) => emit('update:code', value)"
    />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, useId } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";

const CodeQueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

const props = defineProps<{
  code: string;
  language: string;
  filename?: I18nText;
  dataTest: string;
  editable?: boolean;
}>();
const emit = defineEmits<{ "update:code": [code: string] }>();

const { t } = useI18nTyped();

const editorId = `fleet-code-editor-${useId()}`;

function copy() {
  copyToClipboard(props.code, t, {
    successMessage: t("common.copySuccess"),
    errorMessage: t("common.copyContentError"),
  });
}
</script>
