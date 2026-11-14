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

  ONE caption labels the pair rather than one label per mark: two logos beside a
  primary CTA have to stay quieter than it, and naming each one doubles the width
  of a secondary affordance while saying the same thing twice. It names the
  ARTIFACT ("Terraform provider" — what OpenTofu consumes too), never a registry,
  since a registry name would mislabel whichever of the two marks it omits.
-->
<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import opentofuLogo from "@/assets/images/common/opentofu.svg";
import opentofuLogoDark from "@/assets/images/common/opentofu_dark.svg";
import terraformLogo from "@/assets/images/common/terraform.svg";
import { useTheme } from "@/composables/useTheme";
import { OPENTOFU_REGISTRY_URL, TERRAFORM_REGISTRY_URL } from "@/utils/terraform/provider";
import { raw, useI18nTyped } from "@/types/i18n";

// `compact` drops the button text where the caller has no width for it; only the
// call site knows, since the same pair sits inline on one page and inside the
// header's "More" dropdown on another.
// `menu` renders the pair as items for the caller's header More menu (H3: external links live there).
const props = withDefaults(
  defineProps<{ dataTest?: string; compact?: boolean; menu?: boolean }>(),
  { dataTest: "iac-registry-links", compact: false, menu: false },
);

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
    name: raw("Terraform"),
    registry: raw("Terraform Registry"),
    icon: `img:${terraformLogo}`,
    url: TERRAFORM_REGISTRY_URL,
  },
  {
    key: "opentofu",
    name: raw("OpenTofu"),
    registry: raw("OpenTofu Registry"),
    icon: `img:${isDark.value ? opentofuLogoDark : opentofuLogo}`,
    url: OPENTOFU_REGISTRY_URL,
  },
]);

const openRegistry = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
</script>

<template>
  <template v-if="props.menu">
    <ODropdownItem
      v-for="registry in REGISTRIES"
      :key="registry.key"
      :aria-label="t('common.openProviderOnRegistry', { registry: registry.registry })"
      :data-test="`${dataTest}-${registry.key}`"
      @select="openRegistry(registry.url)"
    >
      <template #icon><OIcon :name="registry.icon" size="sm" /></template>
      {{ registry.name }}
      <template #end><OIcon name="open-in-new" size="sm" /></template>
    </ODropdownItem>
  </template>
  <div v-else class="flex items-center gap-2" :data-test="dataTest">
    <OButton
      v-for="registry in REGISTRIES"
      :key="registry.key"
      :class="props.compact ? 'min-w-0! px-2! py-0!' : ''"
      variant="secondary"
      :href="registry.url"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="t('common.openProviderOnRegistry', { registry: registry.registry })"
      :data-test="`${dataTest}-${registry.key}`"
    >
      <!-- Slot, not `icon-left`: that prop is typed to the icon enum and these are brand art. -->
      <template #icon><OIcon :name="registry.icon" size="sm" /></template>
      <template v-if="!props.compact">{{ registry.name }}</template>
      <OTooltip
        v-if="props.compact"
        :content="t('common.openProviderOnRegistry', { registry: registry.registry })"
        side="bottom"
      />
    </OButton>
  </div>
</template>
