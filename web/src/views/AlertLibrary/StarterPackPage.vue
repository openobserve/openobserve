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
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import StarterPackDetail from "@/components/starterPacks/StarterPackDetail.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { STARTER_PACKS } from "@/composables/starterPacks/kubernetesPack";
import { raw, useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const org = String(route.query.org_identifier ?? store.state.selectedOrganization?.identifier);
const packId = String(route.params.pack ?? "");
const pack = STARTER_PACKS.find(({ id }) => id === packId) ?? null;

const packsRoute = computed(() => ({ name: "starterPacks", query: { org_identifier: org } }));
const backToPacks = () => router.push(packsRoute.value).catch(() => {});
</script>

<template>
  <StarterPackDetail v-if="pack" :org="org" :pack="pack" />
  <OPageLayout
    v-else
    :title="t('starterPacks.page.notFoundTitle')"
    :back="{
      label: t('starterPacks.page.back'),
      to: packsRoute,
      dataTest: 'starter-pack-page-back',
    }"
    title-data-test="starter-pack-page-title"
  >
    <OEmptyState
      size="hero"
      variant="no-results"
      :title="t('starterPacks.page.notFound', { pack: raw(packId) })"
      :action-label="t('starterPacks.page.backToPacks')"
      action-icon="chevron-left"
      data-test="starter-pack-page-not-found"
      @action="backToPacks"
    >
      <template #illustration>
        <span
          class="rounded-default border-border-default bg-surface-base text-text-secondary grid size-20 place-items-center border shadow-md"
          data-test="starter-pack-page-not-found-icon"
        >
          <OIcon name="search-off" size="lg" />
        </span>
      </template>
    </OEmptyState>
  </OPageLayout>
</template>
