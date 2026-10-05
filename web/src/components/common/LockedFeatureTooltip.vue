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
  flyout children, Settings/IAM section rails, hub cards) — a feature pitch
  plus an "Upgrade to Enterprise" action on its own line that opens the SAME
  EnterpriseUpgradeDialog the header's own upgrade button opens (shared via
  useEnterpriseUpgradeDialog — a single dialog instance lives in Header.vue).

  `hoverable` keeps the bubble open while the pointer travels onto it, which
  is what makes the button clickable at all (a plain tooltip closes the
  moment the pointer leaves its trigger). No default slot: like a bare
  `OTooltip`, this attaches to the DOM element immediately before it — place
  it right after the locked trigger, not wrapped around it.
-->
<template>
  <OTooltip hoverable side="right" :align="align">
    <template #content>
      <div class="flex flex-col items-start gap-1">
        <span>{{ message }}</span>
        <!-- Same label as the header's own upgrade button (Header.vue
             `enterpriseButtonText`'s OSS branch) — this tooltip only ever
             renders in a build where that branch is the one showing, so the
             two always agree without replicating the edition check here. -->
        <button
          type="button"
          class="text-accent cursor-pointer appearance-none border-0 bg-transparent p-0 font-semibold underline"
          data-test="locked-feature-upgrade-cta"
          @click.stop="open"
        >
          {{ t("about.header_button.get_enterprise_free") }}
        </button>
      </div>
    </template>
  </OTooltip>
</template>

<script setup lang="ts">
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { useEnterpriseUpgradeDialog } from "@/composables/useEnterpriseUpgradeDialog";

defineProps<{
  message: I18nText;
  align?: "start" | "center" | "end";
}>();

const { t } = useI18nTyped();
const { open } = useEnterpriseUpgradeDialog();
</script>
