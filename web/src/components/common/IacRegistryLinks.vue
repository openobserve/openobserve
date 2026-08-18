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
  IacRegistryLinks — the Terraform and OpenTofu marks, each a link to the
  OpenObserve provider on that registry. Two separate logos rather than one
  combined badge: they are two distinct destinations, and the pair is also what
  tells a reader the exported configuration applies to either tool.
-->
<script setup lang="ts">
import { computed } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import opentofuLogo from "@/assets/images/common/opentofu.svg";
import opentofuLogoDark from "@/assets/images/common/opentofu_dark.svg";
import terraformLogo from "@/assets/images/common/terraform.svg";
import { useTheme } from "@/composables/useTheme";
import { OPENTOFU_REGISTRY_URL, TERRAFORM_REGISTRY_URL } from "@/utils/terraform/provider";
import { raw, useI18nTyped } from "@/types/i18n";

withDefaults(defineProps<{ dataTest?: string }>(), { dataTest: "iac-registry-links" });

const { t } = useI18nTyped();
const { isDark } = useTheme();

// Brand artwork, so the variant is chosen here rather than with `dark:` classes:
// a second element toggled by `hidden` / `dark:inline-flex` loses to the display
// utility OIcon's own root carries — Tailwind emits `.inline-flex` after
// `.hidden`, so both marks rendered at once.
//
// OpenTofu ships two: the amber-only silhouette is the on-dark mark and washes
// out on a light surface, so light mode gets the outlined variant that carries
// its own definition. Terraform's purple works on either canvas.
const REGISTRIES = computed(() => [
  {
    key: "terraform",
    name: raw("Terraform Registry"),
    icon: `img:${terraformLogo}`,
    url: TERRAFORM_REGISTRY_URL,
  },
  {
    key: "opentofu",
    name: raw("OpenTofu Registry"),
    icon: `img:${isDark.value ? opentofuLogoDark : opentofuLogo}`,
    url: OPENTOFU_REGISTRY_URL,
  },
]);
</script>

<template>
  <div class="flex items-center gap-2" :data-test="dataTest">
    <a
      v-for="registry in REGISTRIES"
      :key="registry.key"
      :href="registry.url"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="t('common.openProviderOnRegistry', { registry: registry.name })"
      class="rounded-default hover:bg-surface-subtle-hover flex items-center p-1 opacity-80 transition-opacity hover:opacity-100"
      :data-test="`${dataTest}-${registry.key}`"
    >
      <OIcon :name="registry.icon" size="md" />
      <OTooltip
        :content="t('common.openProviderOnRegistry', { registry: registry.name })"
        side="bottom"
        align="end"
      />
    </a>
  </div>
</template>
