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
  The rule that actually tripped, in the same words the alert's own config
  summary uses. "Why me" is answered on the Routing Details card; this answers
  the question a responder asks before that one — "what fired" — and it used
  to have no home on this page at all.
-->
<template>
  <OCard variant="glass" data-test="oncall-what-fired">
    <OCardSection role="header" dense>
      <OText variant="card-title">{{ t("oncall.whatFired") }}</OText>
    </OCardSection>

    <OCardSection role="body" dense>
      <ODescriptionList dense>
        <ODescriptionItem :label="t('alerts.groups.criticalCondition')">
          <span class="font-mono text-sm break-all" data-test="oncall-what-fired-condition">
            {{ raw(conditionText) }}
          </span>
        </ODescriptionItem>

        <ODescriptionItem v-if="hasWarning" :label="t('alerts.groups.warningCondition')">
          <span class="font-mono text-sm break-all" data-test="oncall-what-fired-warning">
            {{ raw(warningText) }}
          </span>
        </ODescriptionItem>
      </ODescriptionList>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import { alertConditionText, alertWarningConditionText } from "@/utils/alerts/alertCondition";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  /** The alert record fetched for this page's subject — same shape the alert's own config summary reads. */
  alert: any;
}>();

const { t } = useI18nTyped();

const conditionText = computed(() => alertConditionText(props.alert));
const warningText = computed(() => alertWarningConditionText(props.alert));
const hasWarning = computed(() => warningText.value !== "—");
</script>
