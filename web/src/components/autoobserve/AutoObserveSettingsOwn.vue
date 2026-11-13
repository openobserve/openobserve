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
  <div class="flex flex-col gap-2" data-test="autoobserve-settings-own">
    <p class="text-text-body text-sm leading-relaxed">
      {{ t("autoobserve.settingsLive.own.asks") }}
    </p>
    <p
      v-if="fromSlack !== null"
      class="text-text-secondary flex items-start gap-1.5 text-sm"
      :data-on="fromSlack"
      data-test="autoobserve-settings-own-slack"
    >
      <OIcon name="forum" size="sm" class="mt-0.5 shrink-0" />
      <span>{{
        fromSlack
          ? t("autoobserve.settingsLive.own.slackOn")
          : t("autoobserve.settingsLive.own.slackOff")
      }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { slackInsightsSettingsQuery } from "@/services/slack.queries";

const { t } = useI18nTyped();
const org = useOrgId();
// The reach section reads the same settings, so this line costs no request of its own.
const settings = useQuery(() => ({ ...slackInsightsSettingsQuery(org.value), retry: false }));

const fromSlack = computed<boolean | null>(() =>
  settings.data.value?.channel ? settings.data.value.allow_changes_from_slack === true : null,
);
</script>
