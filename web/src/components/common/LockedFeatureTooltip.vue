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
  The ONE tooltip every locked enterprise-feature surface uses (nav tiles,
  flyout children, Settings/IAM section rails, hub cards) — an icon + title
  header, a feature pitch, a "lock" line naming the edition it unlocks in,
  and a filled "Upgrade to Enterprise" button that opens the SAME
  EnterpriseUpgradeDialog the header's own upgrade button opens (shared via
  useEnterpriseUpgradeDialog — a single dialog instance lives in Header.vue).

  `icon`/`title` are optional so an existing caller that hasn't been updated
  yet still renders (just without the header row) instead of breaking.

  `hoverable` keeps the bubble open while the pointer travels onto it, which
  is what makes the button clickable at all (a plain tooltip closes the
  moment the pointer leaves its trigger). No default slot: like a bare
  `OTooltip`, this attaches to the DOM element immediately before it — place
  it right after the locked trigger, not wrapped around it.
-->
<template>
  <OTooltip hoverable :side="side" :align="align" max-width="17rem" content-class="p-3!">
    <template #content>
      <div class="flex w-full flex-col items-start gap-2.5">
        <div v-if="icon || title" class="flex items-center gap-2">
          <OIcon v-if="icon" :name="icon" size="sm" class="text-text-secondary shrink-0" />
          <span class="text-text-heading text-sm leading-tight font-semibold">{{ title }}</span>
        </div>
        <p class="text-text-secondary text-xs leading-relaxed">{{ message }}</p>
        <!-- Both the "Available in Enterprise" line and the CTA below it are
             hidden together: `showUpgradeCta` is false only when the edition
             already includes the feature and an admin toggle (RBAC) is off,
             where "available in Enterprise" would be factually wrong. -->
        <div
          v-if="showUpgradeCta"
          class="border-border-default text-text-secondary flex w-full items-center gap-1.5 border-t pt-2.5 text-xs"
        >
          <OIcon name="lock" size="xs" class="shrink-0" />
          <span>{{ t("enterpriseFeature.availableIn") }}</span>
        </div>
        <OButton
          v-if="showUpgradeCta"
          variant="primary"
          size="xs"
          block
          data-test="locked-feature-upgrade-cta"
          @click.stop="open"
        >
          {{ t("about.header_button.get_enterprise_free") }}
          <template #icon-right>
            <OIcon name="arrow-right" size="xs" />
          </template>
        </OButton>
      </div>
    </template>
  </OTooltip>
</template>

<script setup lang="ts">
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { useEnterpriseUpgradeDialog } from "@/composables/useEnterpriseUpgradeDialog";

withDefaults(
  defineProps<{
    message: I18nText;
    /** The locked item's own icon/title — rendered as the card's header row. */
    icon?: string;
    title?: I18nText;
    align?: "start" | "center" | "end";
    /** Which side of the trigger the bubble opens on — "right" suits a nav rail; a top-of-page icon button wants "bottom". */
    side?: "top" | "right" | "bottom" | "left";
    showUpgradeCta?: boolean;
  }>(),
  { showUpgradeCta: true, side: "right" },
);

const { t } = useI18nTyped();
const { open } = useEnterpriseUpgradeDialog();
</script>
