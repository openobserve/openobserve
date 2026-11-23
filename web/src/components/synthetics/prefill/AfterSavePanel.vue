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
import type { RouteLocationRaw } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import type { SyntheticPrefillView } from "./useSyntheticPrefill";

defineProps<{
  view: SyntheticPrefillView;
  serviceRoute: RouteLocationRaw;
}>();

const { t } = useI18nTyped();
</script>

<template>
  <section
    class="rounded-default border-border-default bg-surface-base flex flex-col gap-3 border p-3"
    data-test="synthetics-prefill-after-save"
  >
    <h3 class="text-text-heading text-base font-semibold">
      {{ t("synthetics.prefill.after.title") }}
    </h3>
    <p class="text-text-body text-sm" data-test="synthetics-prefill-after-save-runs">
      {{ view.afterRuns }}
    </p>
    <ul class="text-text-body flex flex-col gap-2 text-sm">
      <li class="flex items-start gap-2">
        <span
          class="border-status-warning-text mt-1.5 size-2 shrink-0 rounded-full border"
          aria-hidden="true"
        />
        <i18n-t keypath="synthetics.prefill.after.waiting" tag="span" scope="global">
          <template #service>{{ view.service }}</template>
          <template #state>
            <strong>{{ t("synthetics.prefill.after.waitingState") }}</strong>
          </template>
        </i18n-t>
      </li>
      <li class="flex items-start gap-2">
        <span
          class="bg-status-success-text mt-1.5 size-2 shrink-0 rounded-full"
          aria-hidden="true"
        />
        <i18n-t keypath="synthetics.prefill.after.covered" tag="span" scope="global">
          <template #state>
            <strong>{{ t("synthetics.prefill.after.coveredState") }}</strong>
          </template>
        </i18n-t>
      </li>
    </ul>
    <p class="text-text-secondary text-xs" data-test="synthetics-prefill-after-save-notify">
      {{ view.afterNotify }}
    </p>
    <i18n-t
      keypath="synthetics.prefill.after.back"
      tag="p"
      scope="global"
      class="border-border-default text-text-secondary border-t pt-2 text-xs"
    >
      <template #link>
        <router-link
          :to="serviceRoute"
          class="text-text-link hover:underline"
          data-test="synthetics-prefill-after-save-back"
          >{{ t("synthetics.prefill.after.backLink", { service: view.service }) }}</router-link
        >
      </template>
    </i18n-t>
  </section>
</template>
