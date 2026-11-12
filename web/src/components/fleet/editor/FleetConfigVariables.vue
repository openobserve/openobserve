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
  <div class="flex flex-col gap-3" data-test="fleet-config-variables">
    <OBanner variant="info" dense :content="t('fleet.configs.variablesHint')" />
    <div
      v-for="name in names"
      :key="name"
      class="border-border-default flex flex-col gap-1 border-b pb-2.5 last:border-b-0"
      :data-test="`fleet-config-variables-${name}`"
    >
      <div class="flex items-center justify-between gap-2">
        <OText variant="mono" truncate>{{ name }}</OText>
        <OTag
          size="xs"
          :variant="SOURCE[sourceOf(name)].variant"
          :label="t(SOURCE[sourceOf(name)].label)"
          :data-test="`fleet-config-variables-source-${name}`"
        />
      </div>
      <OText variant="meta">{{ t(SOURCE[sourceOf(name)].hint) }}</OText>
    </div>
  </div>
</template>

<script setup lang="ts">
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import { HELM_ENV, INSTALL_ENV } from "../fleetInstall";

defineProps<{ names: string[] }>();

const { t } = useI18nTyped();

type Source = "install" | "helm" | "missing";

const SOURCE: Record<Source, { variant: BadgeVariant; label: I18nKey; hint: I18nKey }> = {
  install: {
    variant: "default-soft",
    label: "fleet.configs.sourceInstall",
    hint: "fleet.configs.sourceInstallHint",
  },
  helm: {
    variant: "default-soft",
    label: "fleet.configs.sourceHelm",
    hint: "fleet.configs.sourceHelmHint",
  },
  missing: {
    variant: "warning-soft",
    label: "fleet.configs.sourceMissing",
    hint: "fleet.configs.sourceMissingHint",
  },
};

function sourceOf(name: string): Source {
  if (INSTALL_ENV.includes(name)) return "install";
  return HELM_ENV.includes(name) ? "helm" : "missing";
}
</script>
