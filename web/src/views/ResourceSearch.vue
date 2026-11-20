<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import { RESOURCE_KINDS, type ResourceKind, type ResourceHit } from "@/ts/interfaces/resources";
import { useResourceSearch } from "@/components/commandPalette/useResourceSearch";
import { resourceRoute } from "@/components/commandPalette/resourceRoutes";
import { KIND_LABELS } from "@/components/commandPalette/presentation";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSelectItem from "@/lib/forms/Select/OSelectItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OText from "@/lib/core/Typography/OText.vue";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
function selectedType(value: unknown): ResourceKind {
  return RESOURCE_KINDS.find((kind) => kind === value) ?? "dashboard";
}
const type = ref<ResourceKind | "all">(selectedType(route.query.type));
const query = ref(typeof route.query.q === "string" ? route.query.q : "");
const PAGE_SIZE = 20;
const page = ref(0);
const offset = computed(() => page.value * PAGE_SIZE);
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const subject = computed<string>(() => store.state.userInfo?.email ?? "");
const open = ref(true);
const search = useResourceSearch({ open, org, subject, query, type, offset, limit: PAGE_SIZE });
const rows = computed(() => search.data.value?.hits ?? []);
const source = computed(() => search.data.value?.sources.find((s) => s.type === type.value));
const columns = computed<OTableColumnDef<ResourceHit>[]>(() => [
  { id: "name", header: t("common.name"), accessorKey: "name" },
  { id: "folder_name", header: t("dashboard.folder"), accessorKey: "folder_name", hideable: true },
  { id: "id", header: raw("ID"), accessorKey: "id", hideable: true },
]);
function changeType(value: unknown) {
  type.value = selectedType(value);
}
function next() {
  if (source.value?.has_more) page.value += 1;
}
function back() {
  if (page.value > 0) page.value -= 1;
}
function searchAgain() {
  void search.refetch();
}
watch([query, type, org], () => {
  page.value = 0;
  if (route.name === "resourceSearch")
    void router.replace({
      name: "resourceSearch",
      query: { org_identifier: org.value, type: type.value, q: query.value },
    });
});
watch(
  () => [route.query.q, route.query.type],
  () => {
    query.value = typeof route.query.q === "string" ? route.query.q : "";
    type.value = selectedType(route.query.type);
  },
);
</script>

<template>
  <OPageLayout
    :title="t('commandPalette.resourceSearch')"
    icon="search"
    :subtitle="raw(store.state.selectedOrganization?.label || org)"
    :back="{
      label: t('commandPalette.pages'),
      to: { name: 'home', query: { org_identifier: org } },
    }"
    bleed
  >
    <OTable
      :data="rows"
      :columns="columns"
      row-key="id"
      :loading="search.pending.value"
      :error="search.error.value ? t('commandPalette.failed') : undefined"
      :show-global-filter="false"
      pagination="none"
      sorting="none"
      :frame="false"
      table-id="resource-search"
      :persist-columns="true"
      data-test="resource-search-table"
    >
      <template #toolbar
        ><OSearchInput
          v-model="query"
          class="min-w-0 flex-1"
          :placeholder="t('commandPalette.placeholder')"
          data-test="resource-search-input"
        /><OSelect
          :model-value="type"
          :aria-label="t('common.type')"
          data-test="resource-search-type"
          @update:model-value="changeType"
          ><OSelectItem v-for="kind in RESOURCE_KINDS" :key="kind" :value="kind">{{
            t(KIND_LABELS[kind])
          }}</OSelectItem></OSelect
        ></template
      >
      <template #toolbar-trailing
        ><OButton
          variant="ghost"
          size="sm"
          icon-left="refresh"
          :aria-label="t('common.retry')"
          @click="searchAgain"
          >{{ t("common.retry") }}</OButton
        ></template
      >
      <template #cell-name="{ row }"
        ><RouterLink
          v-if="resourceRoute(row, org)"
          :to="resourceRoute(row, org)!"
          custom
          v-slot="{ href, navigate }"
          ><OButton as="a" :href="href" variant="link" size="sm" @click="navigate">{{
            row.name
          }}</OButton></RouterLink
        ></template
      >
      <template #empty
        ><OEmptyState
          size="block"
          :title="
            source?.status === 'complete'
              ? t('common.noMatches')
              : t('commandPalette.sourceUnavailable')
          "
      /></template>
      <template #error
        ><OEmptyState
          size="block"
          :title="t('commandPalette.failed')"
          :action-label="t('commandPalette.searchAgain')"
          @action="searchAgain"
      /></template>
      <template #pagination-bar
        ><div class="flex flex-wrap items-center justify-between gap-2">
          <OText v-if="source?.status !== 'complete'" role="status" variant="meta">{{
            source?.reason === "loading" ? t("commandPalette.loading") : t("commandPalette.partial")
          }}</OText>
          <div class="ms-auto flex items-center gap-2">
            <OButton
              variant="secondary"
              size="sm"
              :disabled="page === 0 || search.pending.value"
              data-test="resource-search-previous"
              @click="back"
              >{{ t("common.previous") }}</OButton
            ><OButton
              variant="secondary"
              size="sm"
              :disabled="!source?.has_more || search.pending.value"
              data-test="resource-search-next"
              @click="next"
              >{{ t("common.next") }}</OButton
            >
          </div>
        </div></template
      >
    </OTable>
  </OPageLayout>
</template>
