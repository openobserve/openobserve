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

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { SlackInstallConfirmation } from "@/types/slack";

const props = defineProps<{ confirmation: SlackInstallConfirmation }>();

const emit = defineEmits<{ continue: [] }>();

const { t } = useI18nTyped();

const linkingLine = computed<I18nText | null>(() => {
  const linking = props.confirmation.linking;
  if (!linking) return null;
  if (!linking.enabled) return t("slackApp.linking.offSummary");
  const domains = linking.domains.join(", ");
  return linking.source === "mapping"
    ? t("slackApp.linking.mappedSummary", { domains })
    : t("slackApp.linking.manualSummary", { domains });
});

const linkAllLine = computed<I18nText | null>(() => {
  const result = props.confirmation.linkAll;
  if (!result) return null;
  return result.complete
    ? t("slackApp.linking.linkAllDone", { count: result.linked }, result.linked)
    : t("slackApp.linking.linkAllRunning", { count: result.linked });
});

// Slack names the webhook channel with its "#", which the copy already adds.
const channel = computed(() => props.confirmation.destination?.channel.replace(/^#/, "") ?? "");
</script>

<template>
  <OCard variant="outlined" class="gap-3 p-5" data-test="slack-install-confirmation">
    <OBanner variant="success" icon="check-circle" data-test="slack-install-connected">
      {{ t("slackApp.connect.connectedTitle", { team: confirmation.team }) }}
    </OBanner>
    <p v-if="linkingLine" class="text-text-body m-0 text-sm">{{ linkingLine }}</p>
    <p v-if="linkAllLine" class="text-text-body m-0 text-sm">{{ linkAllLine }}</p>
    <p
      v-if="confirmation.destination"
      class="text-text-secondary m-0 text-sm"
      data-test="slack-install-destination"
    >
      {{ t("slackApp.connect.connectedDestination", { channel }) }}
    </p>
    <div class="flex justify-end">
      <OButton
        variant="primary"
        size="sm-action"
        data-test="slack-install-continue"
        @click="emit('continue')"
      >
        {{ t("slackApp.connect.continue") }}
      </OButton>
    </div>
  </OCard>
</template>
