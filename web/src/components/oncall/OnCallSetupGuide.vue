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
  Shown when the org has no on-call teams. "Nothing is paging" is the right
  message once a team exists, but on a fresh install it is indistinguishable
  from "nothing is set up" — and the page offered no way forward.
-->
<template>
  <div
    class="mx-auto flex max-w-2xl flex-col gap-6 py-10"
    data-test="oncall-setup-guide"
  >
    <div class="flex flex-col gap-2 text-center">
      <h2 class="text-text-heading text-2xl">{{ t("oncall.setupTitle") }}</h2>
      <p class="text-text-secondary text-sm">{{ t("oncall.setupSubtitle") }}</p>
    </div>

    <ol class="flex flex-col gap-3">
      <li
        v-for="(step, index) in steps"
        :key="step.key"
        class="border-border-default flex items-start gap-3 rounded-surface border p-4"
        :data-test="`oncall-setup-step-${step.key}`"
      >
        <span
          class="bg-surface-subtle text-text-body flex size-6 shrink-0 items-center justify-center rounded-full text-xs"
          aria-hidden="true"
        >
          {{ raw(String(index + 1)) }}
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-text-heading text-sm">{{ step.title }}</span>
          <span class="text-text-secondary text-sm">{{ step.body }}</span>
        </div>
      </li>
    </ol>

    <div class="flex justify-center">
      <OButton
        variant="primary"
        size="sm-action"
        icon-left="add"
        data-test="oncall-setup-create-team"
        @click="goToTeams"
      >
        {{ t("oncall.setupCta") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import { raw, useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

// The three things that must exist before an alert can page anyone, in the
// order a user has to do them.
const steps = computed(() => [
  {
    key: "team",
    title: t("oncall.setupStep1Title"),
    body: t("oncall.setupStep1Body"),
  },
  {
    key: "rotation",
    title: t("oncall.setupStep2Title"),
    body: t("oncall.setupStep2Body"),
  },
  {
    key: "routing",
    title: t("oncall.setupStep3Title"),
    body: t("oncall.setupStep3Body"),
  },
]);

function goToTeams() {
  router.push({
    name: "onCallTeams",
    query: { org_identifier: store.state.selectedOrganization.identifier },
  });
}
</script>
