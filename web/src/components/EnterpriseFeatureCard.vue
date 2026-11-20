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

<!-- One enterprise feature as a uniform grid card, shared by the upgrade dialog and the features page. -->
<template>
  <div
    data-test="enterprise-upgrade-feature-item"
    class="rounded-surface border-border-default bg-surface-base flex min-w-0 flex-col gap-1 border p-3 transition-colors"
    :class="
      feature.link
        ? 'hover:border-accent focus-visible:outline-accent cursor-pointer focus-visible:outline-2'
        : ''
    "
    :role="feature.link ? 'link' : undefined"
    :tabindex="feature.link ? 0 : undefined"
    @click="open"
    @keydown.enter="open"
  >
    <div class="flex min-w-0 items-center gap-2">
      <OIcon :name="feature.icon" size="sm" class="text-text-secondary shrink-0" />
      <OTruncatedText
        data-test="enterprise-upgrade-feature-name"
        class="text-text-heading text-compact font-semibold"
        >{{ feature.name }}</OTruncatedText
      >
      <OIcon
        v-if="feature.link"
        name="open-in-new"
        size="xs"
        data-test="enterprise-upgrade-feature-external-link"
        class="text-text-muted ms-auto shrink-0"
      />
    </div>
    <!-- Two description lines and the chip line are reserved, so every card is the same height. -->
    <OTruncatedText :lines="2" class="text-text-secondary min-h-8 text-xs leading-4">{{
      feature.note
    }}</OTruncatedText>
    <div class="flex h-6 items-center gap-1" data-test="enterprise-upgrade-feature-chips">
      <OTag
        v-if="feature.beta"
        type="featureFlag"
        value="beta"
        data-test="enterprise-upgrade-feature-beta-badge"
      />
      <span v-if="feature.requiresHA" class="inline-flex">
        <OTag type="featureFlag" value="ha" data-test="enterprise-upgrade-feature-ha-badge" />
        <OTooltip
          side="top"
          :content="t('about.enterprise_offer.tooltip.high_availability_mode_only')"
        />
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

export interface EnterpriseFeatureCardItem {
  name: I18nText;
  note: I18nText;
  icon: string;
  link?: string;
  requiresHA?: boolean;
  beta?: boolean;
}

const props = defineProps<{ feature: EnterpriseFeatureCardItem }>();

const { t } = useI18nTyped();

const open = () => {
  if (props.feature.link) window.open(props.feature.link, "_blank");
};
</script>
