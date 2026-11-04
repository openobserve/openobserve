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

<!-- The pinned bar once the first record lands. The page's inline status keeps the
     first-record preview and the test-or-real outcome; this links to it instead of repeating it.
     The `rail` variant stacks its actions for a side rail, whose page shows no inline status. -->
<template>
  <div
    :class="[
      'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 flex flex-col motion-safe:duration-300',
      rail ? 'gap-3' : 'gap-4 p-5 max-md:p-4',
    ]"
    data-test="onboarding-first-data"
  >
    <div class="flex items-center gap-3.5">
      <span
        v-if="!rail"
        class="bg-icon-chip-success-bg text-icon-chip-success-text inline-flex size-11 shrink-0 items-center justify-center rounded-full"
      >
        <OIcon name="check-circle" size="md" />
      </span>
      <div class="min-w-0">
        <h2 :class="['text-text-heading leading-snug font-semibold', rail ? 'text-sm' : 'text-lg']">
          {{ title }}
        </h2>
        <i18n-t
          keypath="onboarding.firstData.count"
          tag="p"
          :plural="result.count"
          :class="['text-text-secondary text-compact min-w-0', rail ? 'break-words' : 'truncate']"
          data-test="onboarding-first-data-count"
        >
          <template #count>{{ countText }}</template>
          <template #stream
            ><span class="text-text-heading font-medium">{{ streamText }}</span></template
          >
        </i18n-t>
        <p
          v-if="note"
          class="text-text-body text-compact mt-1"
          data-test="onboarding-first-data-note"
        >
          {{ note }}
        </p>
      </div>
    </div>
    <div :class="rail ? 'flex flex-col gap-2' : 'flex flex-wrap items-center gap-2'">
      <OButton
        variant="primary"
        size="sm"
        icon-right="arrow-forward"
        class="max-md:w-full"
        data-test="onboarding-first-data-open"
        @click="openData"
      >
        {{ openLabel }}
      </OButton>
      <slot name="actions" />
      <OButton
        variant="outline"
        size="sm"
        class="max-md:flex-1"
        data-test="onboarding-first-data-another"
        @click="go('recommended')"
      >
        {{ t("onboarding.firstData.addAnother") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { rangeRoute } from "@/composables/firstEvent/confirmQuery";
import type { FirstEventResult } from "@/composables/firstEvent/useFirstEventWatch";
import { refreshUserStreamLists } from "@/composables/useOrgHasUserData";
import analytics from "@/services/product_analytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const props = defineProps<{
  title: I18nText;
  /** One line under the count, for what to do next. */
  note?: I18nText;
  /** What the page's first-event watch found: stream, count and time range. */
  result: FirstEventResult;
  /** The app route the page sets up, for analytics. */
  route: string;
  /** `rail`: stacked for a side rail, with no link to an inline status. */
  variant?: "bar" | "rail";
}>();

const { t } = useI18nTyped();
const rail = computed(() => props.variant === "rail");
const router = useRouter();
const store = useStore();

const countText = computed(() => raw(props.result.count.toLocaleString()));
const streamText = computed(() => raw(props.result.streamName));

const openLabel = computed(() => {
  const type = props.result.streamType;
  if (type === "metrics") return t("onboarding.firstData.exploreMetrics");
  if (type === "traces") return t("onboarding.firstData.exploreTraces");
  if (type === "profiles") return t("onboarding.firstData.exploreProfiles");
  return t("onboarding.firstData.exploreLogs");
});

const org = () => store.state.selectedOrganization?.identifier ?? "";

// The org has data now, and onboarding sends such an org Home, so every exit leaves onboarding.
const go = (name: string) =>
  router.push({ name, query: { org_identifier: org() } }).catch(() => {});

// The same stream and time range as the inline status's own "Open in" button.
const openData = () => {
  const r = props.result;
  router
    .push(
      rangeRoute(org(), r.streamType, r.streamName, { startUs: r.rangeStart, endUs: r.rangeEnd }),
    )
    .catch(() => {});
};

onMounted(() => {
  analytics.track("onboarding_first_data", { route: props.route, count: props.result.count });
  // Every data page opened from here reads the streams that exist now.
  void refreshUserStreamLists(org());
});
</script>
