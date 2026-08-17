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
import { computed, ref, watch } from "vue";

import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import terraformLogo from "@/assets/images/common/terraform.svg";
import { raw, useI18nTyped } from "@/types/i18n";
import { downloadFile } from "@/utils/dom";

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

      <OTabPanels v-model="format">
        <OTabPanel name="json">
          <OCodeBlock
            :code="json"
            lang="json"
            chrome="editor"
            :filename="`${baseName}.json`"
            :max-lines="22"
            :data-test="`${dataTest}-json`"
          />
        </OTabPanel>

        <OTabPanel name="terraform">
          <div class="flex flex-col gap-2">
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
              <OCodeBlock
                :code="terraform.hcl"
                lang="hcl"
                chrome="editor"
                :filename="`${baseName}.tf`"
                :max-lines="22"
                :data-test="`${dataTest}-terraform`"
              />
            </template>
          </div>
        </OTabPanel>
      </OTabPanels>
    </div>
  </ODialog>
</template>
