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
  <div
    v-if="!loaded"
    class="border-border-default bg-surface-subtle rounded-surface flex w-full items-center gap-3 border p-3 text-start max-md:flex-col max-md:items-start"
    data-test="sample-data-callout"
  >
    <span
      class="bg-ingest-tint-purple text-ingest-accent-purple rounded-default flex size-8 shrink-0 items-center justify-center"
    >
      <OIcon name="science" size="sm" />
    </span>
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <strong class="text-text-heading text-sm">{{ t("sampleData.callout.title") }}</strong>
      <span class="text-text-secondary text-xs">{{
        t("sampleData.callout.body", { product: raw("OpenObserve") })
      }}</span>
    </div>
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <OButton variant="ghost" size="sm" data-test="sample-data-callout-details" @click="details">
        {{ t("sampleData.callout.details") }}
      </OButton>
      <OButton
        variant="outline"
        size="sm"
        icon-left="play-arrow"
        data-test="sample-data-callout-load"
        @click="load"
      >
        {{ loading ? t("sampleData.callout.loading") : t("sampleData.callout.cta") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const session = useSampleDataSession();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const loading = computed(
  () => session.status.value === "loading" && session.loadingOrg.value === org.value,
);

// the empty state lingers until the home page refetches, so hide the offer as soon as the load lands
const loaded = computed(
  () => session.status.value === "loaded" && session.loadingOrg.value === org.value,
);

const load = () => {
  session.openWelcome();
  session.start(org.value, store.state.zoConfig?.ingest_allowed_upto);
};

const details = () =>
  router.push({ name: "sampleData", query: { org_identifier: org.value } }).catch(() => {});
</script>
