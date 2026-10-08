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
  Stands in for OnCallEscalation while `/escalation` is still in flight.

  The card sits between two siblings that render their shell immediately
  (OnCallWhoIsOn, OnCallAboutPage) — without this, the rail was two cards
  apart while escalation loaded, then a third shoved its way in between them
  the moment the request resolved. Mirroring the real card's header + a few
  timeline rows reserves that space up front instead.
-->
<template>
  <OCard
    variant="glass"
    role="status"
    :aria-label="t('oncall.escalationLoading')"
    aria-live="polite"
    data-test="oncall-escalation-skeleton"
  >
    <OCardSection role="header" dense>
      <OText variant="card-title">{{ t("oncall.escalation") }}</OText>
    </OCardSection>

    <OCardSection role="body" dense>
      <div class="flex flex-col gap-4">
        <div v-for="row in 3" :key="row" class="flex items-start gap-3">
          <OSkeleton type="circle" class="mt-0.5 h-4 w-4 shrink-0" />
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <OSkeleton type="text" class="h-3 w-16" />
            <OSkeleton type="text" class="h-4 w-3/4" />
          </div>
        </div>
      </div>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
</script>
