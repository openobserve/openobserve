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

<!--
  ExportResourceDialog — shows a definition in both formats it can leave the
  product in: the JSON the import screens read back, and a Terraform resource for
  the OpenObserve provider. The user reads it before it leaves, then copies or
  downloads whichever form they came for.

  The caller owns the conversion (each resource type has its own exporter) and
  passes the result in, so this component stays presentational.
-->
<script setup lang="ts">
import type { I18nText } from "@/types/i18n";
import type { TerraformExport } from "@/utils/terraform/hcl";
import { computed, defineAsyncComponent, ref, watch } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import terraformLogo from "@/assets/images/common/terraform.svg";
import { raw, useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { downloadFile } from "@/utils/dom";

// The app's Monaco wrapper, async like every other consumer so the editor is not
// in the bundle for users who never open an export. It brings what a read-only
// viewer of a whole file needs and a static block cannot: soft wrapping instead
// of clipped lines, a real gutter, folding, find, and a layout that follows the
// dialog rather than a fixed line count.
const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** Payloads as the API returned them — the JSON tab's content. */
    items: Record<string, unknown>[];
    /** The same payloads already converted by the resource's own exporter. */
    terraform: TerraformExport;
    title: I18nText;
    subTitle: I18nText;
    /** Filename stem for a multi-item export, e.g. "alerts". */
    filePrefix?: string;
    dataTest?: string;
  }>(),
  { filePrefix: "export", dataTest: "export-resource-dialog" },
);

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  /** Fired after a file has been written, so the caller owns the toast. */
  (e: "download", payload: { format: ExportFormat; count: number }): void;
}>();

const { t } = useI18nTyped();

const terraformIcon = `img:${terraformLogo}`;

type ExportFormat = "json" | "terraform";
const format = ref<ExportFormat>("json");

// The format is a per-export choice, not a remembered preference, so every open
// starts on JSON — the format that round-trips through the import screen.
watch(
  () => props.open,
  (open) => {
    if (open) format.value = "json";
  },
);

const isTerraform = computed(() => format.value === "terraform");

const json = computed(() =>
  JSON.stringify(props.items.length === 1 ? props.items[0] : props.items, null, 2),
);

const code = computed(() => (isTerraform.value ? props.terraform.hcl : json.value));
const hasCode = computed(() => code.value.length > 0);

const baseName = computed(() => {
  if (props.items.length !== 1) {
    return `${props.filePrefix}-${new Date().toISOString().slice(0, 10)}`;
  }
  const name = String(props.items[0]?.name ?? "").replace(/[^A-Za-z0-9._-]+/g, "-");
  return name || props.filePrefix;
});
const fileName = computed(() => `${baseName.value}.${isTerraform.value ? "tf" : "json"}`);

const skippedNames = computed(() =>
  props.terraform.unsupported
    .map((entry) => entry.name)
    .filter(Boolean)
    .join(", "),
);

// Monaco owns no copy affordance of its own, and selecting a long file by hand is
// exactly what a reader should not have to do.
function copy() {
  copyToClipboard(code.value, t, {
    successMessage: t("common.copySuccess"),
    errorMessage: t("common.copyContentError"),
  });
}

function download() {
  if (!hasCode.value) return;
  const written = downloadFile(
    fileName.value,
    code.value,
    isTerraform.value ? "text/plain;charset=utf-8" : "application/json",
  );
  if (!written) return;
  emit("download", { format: format.value, count: props.items.length });
  emit("update:open", false);
}
</script>

<template>
  <ODialog
    :open="open"
    size="xl"
    :title="title"
    :sub-title="subTitle"
    :primary-button-label="t('common.download')"
    :primary-button-disabled="!hasCode"
    :neutral-button-label="t('common.close')"
    :data-test="dataTest"
    @update:open="emit('update:open', $event)"
    @click:primary="download"
    @click:neutral="emit('update:open', false)"
  >
    <div class="flex flex-col gap-3">
      <OTabs v-model="format" dense bordered :data-test="`${dataTest}-tabs`">
        <OTab
          name="json"
          :label="raw('JSON')"
          icon="data-object"
          :data-test="`${dataTest}-json-tab`"
        />
        <!-- The real Terraform mark, not a generic glyph: the tab is the brand's
             format, and the tooltip says it works with OpenTofu just as well. -->
        <OTab
          name="terraform"
          :label="raw('Terraform')"
          :icon="terraformIcon"
          :tooltip="t('common.exportTerraformTabTooltip')"
          :data-test="`${dataTest}-terraform-tab`"
        />
      </OTabs>

      <template v-if="isTerraform">
        <OBanner
          v-if="!hasCode"
          variant="warning"
          icon="warning-amber"
          dense
          :content="t('common.exportTerraformEmpty')"
          :data-test="`${dataTest}-terraform-empty`"
        />
        <template v-else>
          <OBanner
            v-if="skippedNames"
            variant="warning"
            icon="warning-amber"
            dense
            :content="t('common.exportTerraformSkipped', { names: skippedNames })"
            :data-test="`${dataTest}-terraform-skipped`"
          />
          <OBanner
            v-if="terraform.droppedFields.length"
            variant="info"
            icon="info-outline"
            dense
            :content="
              t('common.exportTerraformDropped', { fields: terraform.droppedFields.join(', ') })
            "
            :data-test="`${dataTest}-terraform-dropped`"
          />
        </template>
      </template>

      <!-- The height lives here, not on the editor: CodeQueryEditor's root already
           carries `h-full`, and Tailwind emits `.h-full` after an arbitrary
           `h-[…]`, so a height passed down would lose the cascade and collapse to
           zero. The container owns a definite height and the editor fills it. -->
      <div
        v-if="hasCode"
        class="rounded-default border-border-default flex h-[50vh] min-h-0 min-w-0 flex-col overflow-hidden border"
      >
        <!-- The filename is the one piece of chrome worth keeping from the static
             block: it says what the download will be called. -->
        <div
          class="border-border-default bg-surface-panel flex shrink-0 items-center gap-2 border-b py-1 pr-1 pl-3"
        >
          <OIcon :name="isTerraform ? terraformIcon : 'data-object'" size="xs" />
          <span class="font-mono text-xs font-semibold opacity-75">{{ fileName }}</span>
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

        <!-- One editor for both tabs. The wrapper retokenizes in place when
             `language` changes, so switching tabs costs a model update rather
             than tearing down and recreating Monaco. -->
        <QueryEditor
          :editor-id="`${dataTest}-editor`"
          class="min-h-0 min-w-0 flex-1"
          :query="code"
          :language="isTerraform ? 'hcl' : 'json'"
          read-only
          :show-auto-complete="false"
          :data-test="`${dataTest}-${format}`"
        />
      </div>
    </div>
  </ODialog>
</template>
