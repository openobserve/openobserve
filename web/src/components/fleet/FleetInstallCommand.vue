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
      :model-value="platform"
      data-test="fleet-install-command-os"
      @update:model-value="(v) => (platform = v as InstallPlatform)"
    >
      <OToggleGroupItem
        v-for="opt in platformOptions"
        :key="opt.value"
        :value="opt.value"
        size="sm"
        :data-test="`fleet-install-command-os-${opt.value}`"
      >
        {{ opt.label }}
      </OToggleGroupItem>
    </OToggleGroup>
    <OText variant="meta" data-test="fleet-install-command-version">{{
      version
        ? t("fleet.install.versionLine", { version: raw(version) })
        : t("fleet.install.versionLatest")
    }}</OText>
    <OCheckbox
      v-if="platform !== 'kubernetes'"
      v-model="http"
      :label="t('fleet.install.httpTransport')"
      data-test="fleet-install-command-http"
    />
    <FleetCodeEditor
      class="h-60"
      :code="command"
      :language="platform === 'windows' ? 'powershell' : 'shell'"
      data-test="fleet-install-command-code"
    />
    <OText variant="meta" data-test="fleet-install-command-note">{{
      platform === "kubernetes" ? t("fleet.install.kubernetesNote") : t("fleet.install.rerunNote")
    }}</OText>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import { getIngestionURL } from "@/utils/queryUtils";
import { raw, useI18nTyped } from "@/types/i18n";
import FleetCodeEditor from "./FleetCodeEditor.vue";
import { OS_LABEL } from "./fleetFormat";
import {
  INSTALL_PLATFORMS,
  installCommand,
  resolveBaseUrl,
  type InstallPlatform,
} from "./fleetInstall";
import { useFleetSettings } from "./useFleetApi";

const props = defineProps<{ token: string }>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const baseUrl = resolveBaseUrl(getIngestionURL(), window.location.origin);
const settings = useFleetSettings().settings;
const version = computed(() => settings.value?.target_collector_version || null);

const platform = ref<InstallPlatform>("linux");
const http = ref(false);

const platformOptions = INSTALL_PLATFORMS.map((value) => ({
  value,
  label: raw(OS_LABEL[value]),
}));

const command = computed(() =>
  installCommand(platform.value, {
    baseUrl,
    org: orgId.value,
    token: props.token,
    version: version.value,
    http: http.value && platform.value !== "kubernetes",
  }),
);
</script>
