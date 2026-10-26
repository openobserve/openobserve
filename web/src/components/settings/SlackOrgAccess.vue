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
import { computed, ref, watch } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue, SelectOption } from "@/lib/forms/Select/OSelect.types";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import {
  previewOrgAccessMutation,
  putOrgAccessMutation,
  slackOrgAccessQuery,
} from "@/services/slack.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type {
  InstallationView,
  SlackOrgAccessRequest,
  SlackOrgAccessRow,
  SlackOrgAccessView,
  SlackOrgRemoval,
} from "@/types/slack";
import { formatTimestamp } from "@/utils/date";
import { serverMessageOf } from "@/utils/slackLink";

type Mode = "all" | "listed";

interface AccessRow {
  org_id: string;
  org_name: string;
  added: I18nText;
  kind: "saved" | "joined" | "unsaved";
  channel_defaults: number | null;
  links: number | null;
}

const props = defineProps<{ installation: InstallationView }>();

const { t } = useI18nTyped();
const store = useStore();
// This card renders only in the meta org, which is always served.
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const team = computed(() => props.installation.team_name);

const access = useQuery(() => slackOrgAccessQuery(org.value, props.installation.id));
// The card shows the refusal itself, so the shared error toast stays quiet.
const put = useMutation(() => {
  const options = putOrgAccessMutation(org.value, props.installation.id);
  return { ...options, meta: { ...options.meta, silentError: true } };
});
const preview = useMutation(() => {
  const options = previewOrgAccessMutation(org.value, props.installation.id);
  return { ...options, meta: { ...options.meta, silentError: true } };
});

const view = computed<SlackOrgAccessView | null>(() => access.data.value ?? null);
const mode = ref<Mode>("listed");
const picked = ref<string[]>([]);
const saveError = ref<string | null>(null);
const removals = ref<SlackOrgRemoval[]>([]);
const confirmOpen = ref(false);
const confirmBody = ref<SlackOrgAccessRequest | null>(null);

const withMeta = (ids: readonly string[]): string[] => [
  org.value,
  ...ids.filter((id) => id !== org.value),
];

const servedIds = computed<string[]>(() => {
  const v = view.value;
  if (!v) return [];
  return withMeta(v.all ? v.organizations.map((o) => o.org_id) : v.orgs.map((o) => o.org_id));
});

const reset = (): void => {
  mode.value = view.value?.all ? "all" : "listed";
  picked.value = servedIds.value;
  saveError.value = null;
};
watch(view, reset, { immediate: true });

const total = computed(() => view.value?.organizations.length ?? 0);
const selectedCount = computed(() => (mode.value === "all" ? total.value : picked.value.length));
const onlyMeta = computed(() => {
  const v = view.value;
  return !!v && !v.all && v.orgs.length === 1 && v.orgs[0].org_id === org.value;
});

const options = computed<SelectOption[]>(() =>
  (view.value?.organizations ?? []).map((o) => ({
    label: raw(o.org_name),
    value: o.org_id,
    subLabel: t("slackApp.orgAccess.members", { count: o.members }, o.members),
    subLabelInline: true,
    disabled: o.org_id === org.value,
  })),
);

const onPick = (value: SelectModelValue): void => {
  picked.value = withMeta(Array.isArray(value) ? value.map(String) : []);
};

const onMode = (value: unknown): void => {
  if (value === "all" || value === "listed") mode.value = value;
};

const addedText = (row: SlackOrgAccessRow): I18nText => {
  const date = formatTimestamp(row.added_at, "MMM d");
  if (row.source === "org" && row.org_id === org.value) {
    return t("slackApp.orgAccess.atInstall", { date });
  }
  if (row.source === "org") return t("slackApp.orgAccess.joinedItself");
  return t("slackApp.orgAccess.addedBy", { date, user: row.added_by });
};

const rows = computed<AccessRow[]>(() => {
  const served = new Map((view.value?.orgs ?? []).map((r) => [r.org_id, r]));
  const names = new Map((view.value?.organizations ?? []).map((o) => [o.org_id, o.org_name]));
  return picked.value.map((id) => {
    const row = served.get(id);
    if (!row) {
      return {
        org_id: id,
        org_name: names.get(id) ?? id,
        added: t("slackApp.orgAccess.notSaved"),
        kind: "unsaved",
        channel_defaults: null,
        links: null,
      };
    }
    return {
      org_id: id,
      org_name: row.org_name,
      added: addedText(row),
      kind: row.source === "org" && id !== org.value ? "joined" : "saved",
      channel_defaults: row.channel_defaults,
      links: row.links,
    };
  });
});

const columns = computed<OTableColumnDef<AccessRow>[]>(() => [
  { id: "org", header: t("slackApp.orgAccess.columnOrg"), accessorKey: "org_name", size: 90 },
  { id: "added", header: t("slackApp.orgAccess.columnAdded"), meta: { flex: true } },
  {
    id: "channel_defaults",
    header: t("slackApp.orgAccess.columnChannelDefaults"),
    accessorKey: "channel_defaults",
    size: 120,
  },
  { id: "links", header: t("slackApp.orgAccess.columnLinked"), accessorKey: "links", size: 105 },
]);

const requestBody = (): SlackOrgAccessRequest =>
  mode.value === "all" ? { all: true } : { orgs: [...picked.value] };

const removesOrgs = computed(
  () => mode.value === "listed" && servedIds.value.some((id) => !picked.value.includes(id)),
);

const apply = async (body: SlackOrgAccessRequest): Promise<void> => {
  try {
    await put.mutateAsync(body);
    toast({ variant: "success", message: t("slackApp.orgAccess.saved") });
  } catch (error) {
    saveError.value = serverMessageOf(error) ?? t("slackApp.orgAccess.saveFailed");
  }
};

const save = async (): Promise<void> => {
  saveError.value = null;
  const body = requestBody();
  if (!removesOrgs.value) {
    await apply(body);
    return;
  }
  try {
    const result = await preview.mutateAsync(body);
    const removed = result.removed ?? [];
    if (!removed.length) {
      await apply(body);
      return;
    }
    removals.value = removed;
    confirmBody.value = body;
    confirmOpen.value = true;
  } catch (error) {
    saveError.value = serverMessageOf(error) ?? t("slackApp.orgAccess.saveFailed");
  }
};

const confirmRemove = async (): Promise<void> => {
  const body = confirmBody.value;
  confirmOpen.value = false;
  if (body) await apply(body);
};

const confirmTitle = computed(() =>
  t("slackApp.orgAccess.removeTitle", {
    org: removals.value.map((r) => r.org_name).join(", "),
    team: team.value,
  }),
);

const channelList = (removal: SlackOrgRemoval): string =>
  removal.channels.map((name) => `#${name}`).join(", ");

const otherAppOrgs = (orgIds: readonly string[]): string => orgIds.join(", ");
</script>

<template>
  <OCard variant="outlined" class="gap-4 p-5" data-test="slack-org-access">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex flex-col gap-0.5">
        <h2 class="text-text-heading m-0 text-lg font-semibold">
          {{ t("slackApp.orgAccess.title") }}
        </h2>
        <p class="text-text-secondary m-0 text-sm">
          {{ t("slackApp.orgAccess.description", { team }) }}
        </p>
      </div>
      <span v-if="view" class="text-text-secondary text-sm" data-test="slack-org-access-count">{{
        t("slackApp.orgAccess.count", { selected: selectedCount, total })
      }}</span>
    </div>

    <div v-if="access.isPending.value" class="flex justify-center py-8">
      <OSpinner size="md" />
    </div>
    <OEmptyState
      v-else-if="access.isError.value || !view"
      size="compact"
      preset="load-error"
      :backdrop="false"
      data-test="slack-org-access-load-error"
      @action="access.refetch()"
    />
    <template v-else>
      <OBanner v-if="onlyMeta" variant="info" icon="info" data-test="slack-org-access-only-meta">
        <span class="text-text-heading font-semibold">{{
          t("slackApp.orgAccess.onlyMetaTitle", { team })
        }}</span>
        {{ t("slackApp.orgAccess.onlyMetaAction") }}
      </OBanner>

      <div class="flex flex-wrap items-center gap-3">
        <OToggleGroup
          :model-value="mode"
          type="single"
          data-test="slack-org-access-mode"
          @update:model-value="onMode"
        >
          <OToggleGroupItem value="all" data-test="slack-org-access-mode-all">{{
            t("slackApp.orgAccess.all")
          }}</OToggleGroupItem>
          <OToggleGroupItem value="listed" data-test="slack-org-access-mode-listed">{{
            t("slackApp.orgAccess.selected")
          }}</OToggleGroupItem>
        </OToggleGroup>
        <span v-if="mode === 'listed'" class="text-text-secondary text-xs">
          {{ t("slackApp.orgAccess.selectedHint") }}
        </span>
      </div>

      <div v-if="mode === 'all'" class="flex flex-col gap-1">
        <p class="text-text-body m-0 text-sm">
          {{ t("slackApp.orgAccess.allHint", { total, team }) }}
        </p>
        <p class="text-text-secondary m-0 text-xs">{{ t("slackApp.orgAccess.ownChannels") }}</p>
      </div>

      <div
        v-else
        class="grid grid-cols-[minmax(0,9fr)_minmax(0,11fr)] items-start gap-6 max-lg:grid-cols-1"
      >
        <OSelect
          :model-value="picked"
          :options="options"
          :label="t('slackApp.orgAccess.picker')"
          :help-text="t('slackApp.orgAccess.metaAlways')"
          :max-visible-chips="20"
          multiple
          searchable
          data-test="slack-org-access-picker"
          @update:model-value="onPick"
        >
          <template #chip="{ label, value }">
            <span
              class="rounded-default bg-select-item-selected-bg text-select-item-selected-text inline-flex shrink-0 items-center gap-1 px-2 py-0.5 text-xs leading-none"
            >
              <OIcon v-if="value === org" name="lock" size="xs" />
              {{ raw(label) }}
            </span>
          </template>
        </OSelect>
        <div class="flex min-w-0 flex-col gap-1">
          <span class="text-text-secondary text-xs font-medium">{{
            t("slackApp.orgAccess.selectedList")
          }}</span>
          <OTable
            :data="rows"
            :columns="columns"
            row-key="org_id"
            pagination="none"
            :show-global-filter="false"
            dense
            data-test="slack-org-access-table"
          >
            <template #cell-added="{ row }">
              <OTag
                v-if="row.kind === 'unsaved'"
                variant="default-soft"
                size="sm"
                :label="row.added"
              />
              <span v-else-if="row.kind === 'joined'" class="text-text-secondary">{{
                row.added
              }}</span>
              <template v-else>{{ row.added }}</template>
            </template>
            <template #cell-channel_defaults="{ row }">
              <span v-if="row.channel_defaults === null" class="text-text-muted">{{
                raw("—")
              }}</span>
              <template v-else>{{ row.channel_defaults }}</template>
            </template>
            <template #cell-links="{ row }">
              <span v-if="row.links === null" class="text-text-muted">{{ raw("—") }}</span>
              <template v-else>{{ row.links }}</template>
            </template>
          </OTable>
        </div>
      </div>

      <OBanner
        v-for="other in view.other_apps_in_team"
        :key="other.installation_id"
        variant="warning"
        icon="warning"
        data-test="slack-org-access-other-app"
      >
        <span class="text-text-heading font-semibold">{{
          t("slackApp.orgAccess.otherAppTitle", { team })
        }}</span>
        {{ raw("·") }}
        {{ t("slackApp.orgAccess.otherAppDetail", { orgs: otherAppOrgs(other.org_ids) }) }}
      </OBanner>

      <OBanner
        v-if="saveError"
        variant="error-soft"
        dense
        icon="error-outline"
        data-test="slack-org-access-error"
        >{{ raw(saveError) }}</OBanner
      >

      <div class="flex justify-end gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          data-test="slack-org-access-cancel"
          @click="reset"
        >
          {{ t("common.cancel") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :loading="put.isPending.value || preview.isPending.value"
          data-test="slack-org-access-save"
          @click="save"
        >
          {{ t("common.save") }}
        </OButton>
      </div>
    </template>

    <ODialog
      v-model:open="confirmOpen"
      size="md"
      :title="confirmTitle"
      :primary-button-label="t('slackApp.orgAccess.remove')"
      primary-button-variant="outline-destructive"
      :secondary-button-label="t('common.cancel')"
      initial-focus="secondary"
      data-test="slack-org-access-confirm"
      @click:primary="confirmRemove"
      @click:secondary="confirmOpen = false"
    >
      <div class="flex flex-col gap-4 text-sm">
        <div
          v-for="removal in removals"
          :key="removal.org_id"
          class="flex flex-col gap-3"
          data-test="slack-org-access-removal"
        >
          <p class="m-0">
            {{ t("slackApp.orgAccess.removeLead", { org: removal.org_name, team }) }}
          </p>
          <ul class="m-0 flex list-disc flex-col gap-1 ps-5">
            <li v-if="removal.channels.length">
              {{
                t(
                  "slackApp.orgAccess.removeDefaults",
                  { count: removal.channels.length, channels: channelList(removal) },
                  removal.channels.length,
                )
              }}
            </li>
            <li v-if="removal.links_moving + removal.links_unlinked > 0">
              {{
                t("slackApp.orgAccess.removeLinks", {
                  count: removal.links_moving + removal.links_unlinked,
                  moved: removal.links_moving,
                  unlinked: removal.links_unlinked,
                })
              }}
            </li>
            <li>{{ t("slackApp.orgAccess.removeThreads", { org: removal.org_name }) }}</li>
          </ul>
          <p class="text-text-secondary m-0 text-xs">
            {{ t("slackApp.orgAccess.removeDestinations", { org: removal.org_name }) }}
          </p>
        </div>
      </div>
    </ODialog>
  </OCard>
</template>
