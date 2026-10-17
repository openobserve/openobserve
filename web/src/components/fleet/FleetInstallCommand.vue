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
  <div class="flex flex-col gap-3" data-test="fleet-install-command">
    <OToggleGroup
      :model-value="os"
      data-test="fleet-install-command-os"
      @update:model-value="(v) => (os = v as SupervisedOs)"
    >
      <OToggleGroupItem
        v-for="opt in osOptions"
        :key="opt.value"
        :value="opt.value"
        size="sm"
        :data-test="`fleet-install-command-os-${opt.value}`"
      >
        {{ opt.label }}
      </OToggleGroupItem>
    </OToggleGroup>
    <OText variant="meta" data-test="fleet-install-command-prereq">{{
      t("fleet.install.prerequisites", { version: collectorVersion })
    }}</OText>
    <FleetCodeEditor
      class="h-80"
      :code="command"
      language="shell"
      data-test="fleet-install-command-code"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import { getIngestionURL } from "@/utils/queryUtils";
import { raw, useI18nTyped } from "@/types/i18n";
import FleetCodeEditor from "./FleetCodeEditor.vue";
import { OS_LABEL, type FleetOs } from "./fleetFormat";
import { installScript, isSupervisedOs, resolveBaseUrl, type SupervisedOs } from "./fleetInstall";
import { useFleetSummary } from "./useFleetApi";

const props = defineProps<{ token: string }>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const baseUrl = resolveBaseUrl(getIngestionURL(), window.location.origin);
const summary = useFleetSummary().summary;
const collectorVersion = computed(() =>
  summary.value?.target_version
    ? raw(summary.value.target_version)
    : t("fleet.install.targetVersionFallback"),
);

const os = ref<SupervisedOs>("linux");

const osOptions = (Object.keys(OS_LABEL) as FleetOs[]).filter(isSupervisedOs).map((value) => ({
  value,
  label: raw(OS_LABEL[value]),
}));

const command = computed(() =>
  installScript(os.value, { baseUrl, org: orgId.value, token: props.token }),
);
</script>
