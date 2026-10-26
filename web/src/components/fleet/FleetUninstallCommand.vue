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
  <div class="flex flex-col gap-3" data-test="fleet-uninstall-command">
    <OToggleGroup
      v-if="showPlatforms"
      :model-value="platform"
      data-test="fleet-uninstall-command-os"
      @update:model-value="(v) => emit('update:platform', v as InstallPlatform)"
    >
      <OToggleGroupItem
        v-for="opt in platformOptions"
        :key="opt.value"
        :value="opt.value"
        size="sm"
        :data-test="`fleet-uninstall-command-os-${opt.value}`"
      >
        {{ opt.label }}
      </OToggleGroupItem>
    </OToggleGroup>
    <OCodeBlock
      :code="command"
      :lang="platform === 'windows' ? 'powershell' : 'bash'"
      chrome="terminal"
      data-test="fleet-uninstall-command-code"
    />
    <OText variant="meta" data-test="fleet-uninstall-command-note">{{ note }}</OText>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  INSTALL_PLATFORMS,
  PLATFORM_LABEL,
  uninstallCommand,
  type InstallPlatform,
} from "./fleetInstall";

const props = defineProps<{ platform: InstallPlatform; showPlatforms?: boolean }>();
const emit = defineEmits<{ "update:platform": [value: InstallPlatform] }>();

const { t } = useI18nTyped();

const platformOptions = INSTALL_PLATFORMS.map((value) => ({
  value,
  label: raw(PLATFORM_LABEL[value]),
}));

// The scripts keep the collector's state (its instance id) and logs, so a reinstall keeps its identity.
const KEPT: Record<"linux" | "macos", { state: string; logs: string }> = {
  linux: { state: "/var/lib/opampsupervisor", logs: "/var/log/opampsupervisor" },
  macos: {
    state: "/Library/Application Support/opampsupervisor",
    logs: "/Library/Logs/opampsupervisor",
  },
};

const command = computed(() => uninstallCommand(props.platform));

const note = computed(() => {
  const p = props.platform;
  if (p === "kubernetes") return t("fleet.uninstall.kubernetesNote");
  if (p === "docker") return t("fleet.uninstall.dockerNote");
  if (p === "windows") {
    return t("fleet.uninstall.windowsNote", {
      state: raw("C:\\ProgramData\\opampsupervisor\\state"),
    });
  }
  return t("fleet.uninstall.scriptNote", {
    state: raw(KEPT[p].state),
    logs: raw(KEPT[p].logs),
  });
});
</script>
