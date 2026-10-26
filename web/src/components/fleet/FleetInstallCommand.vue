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
    <OToggleGroup
      v-if="platform === 'kubernetes'"
      :model-value="role"
      data-test="fleet-install-command-role"
      @update:model-value="(v) => (role = v as KubernetesRole)"
    >
      <OToggleGroupItem
        v-for="opt in roleOptions"
        :key="opt.value"
        :value="opt.value"
        size="sm"
        :data-test="`fleet-install-command-role-${opt.value}`"
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
    <OCodeBlock
      :code="command"
      :code-masked="commandMasked"
      :lang="platform === 'windows' ? 'powershell' : 'bash'"
      chrome="terminal"
      :reveal-tooltip="t('fleet.install.revealToken')"
      :hide-tooltip="t('fleet.install.hideToken')"
      data-test="fleet-install-command-code"
    />
    <OText variant="meta" data-test="fleet-install-command-note">{{ note }}</OText>
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
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import { maskSecret } from "@/composables/useCredentialSnippet";
import {
  GATEWAY_RELEASE,
  INSTALL_PLATFORMS,
  KUBERNETES_ROLES,
  PLATFORM_LABEL,
  installCommand,
  resolveBaseUrl,
  type InstallPlatform,
  type KubernetesRole,
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
const role = ref<KubernetesRole>("agent");

const platformOptions = INSTALL_PLATFORMS.map((value) => ({
  value,
  label: raw(PLATFORM_LABEL[value]),
}));

const roleOptions = computed(() =>
  KUBERNETES_ROLES.map((value) => ({
    value,
    label:
      value === "agent" ? t("fleet.install.kubernetesAgent") : t("fleet.install.kubernetesGateway"),
  })),
);

const note = computed(() => {
  if (platform.value === "kubernetes" && role.value === "gateway")
    return t("fleet.install.kubernetesGatewayNote", {
      service: raw(`${GATEWAY_RELEASE}:4317`),
    });
  if (platform.value === "kubernetes") return t("fleet.install.kubernetesNote");
  if (platform.value === "docker") return t("fleet.install.dockerNote");
  return t("fleet.install.rerunNote");
});

const build = (token: string) =>
  installCommand(platform.value, {
    baseUrl,
    org: orgId.value,
    token,
    version: version.value,
    http: http.value && platform.value !== "kubernetes",
    role: role.value,
  });
const command = computed(() => build(props.token));
// A placeholder stays readable; a real token shows masked until revealed, while copy takes the full command.
const commandMasked = computed(() =>
  /^o2ft_/.test(props.token) ? build(maskSecret(props.token)) : undefined,
);
</script>
