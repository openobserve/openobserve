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
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { Translation } from "vue-i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { FindMoreSource } from "@/composables/starterPacks/findMore";
import { STARTER_PACKS } from "@/composables/starterPacks/kubernetesPack";
import { useBrowserMatches } from "@/composables/starterPacks/useBrowserMatches";
import { useRefreshMatches } from "@/composables/starterPacks/useRefreshMatches";
import { useStarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { useStarterPackMatcher } from "@/composables/starterPacks/useStarterPackMatcher";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { getImageURL } from "@/utils/zincutils";
import StarterPackDrawer from "./StarterPackDrawer.vue";

const ROWS_SHOWN = 5;

// The header passes its spacing class; the drawers are siblings of the popover.
defineOptions({ inheritAttrs: false });

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

// The header remounts this per org, so every composable below binds to one org.
const org: string = store.state.selectedOrganization?.identifier ?? "";
const matches = useBrowserMatches(org);
const checker = useRefreshMatches(org);
const open = ref(false);
const activePack = ref<string | null>(null);
// A drawer mounts on first use, so app open costs nothing.
const usedPacks = ref<string[]>([]);

const shown = computed(() => !store.state.kioskMode && matches.show.value);
const rows = computed(() => matches.visible.value.slice(0, ROWS_SHOWN));
const moreCount = computed(() => Math.max(0, matches.count.value - ROWS_SHOWN));
const interrupted = computed(() => matches.copy.value?.interrupted ?? null);

const builtIns = STARTER_PACKS.map((pack) => {
  const flow = useStarterPackFlow(org, pack);
  const matcher = useStarterPackMatcher(org, { pack });
  return { pack, flow, matcher };
});

const builtInOf = (packId?: string) => builtIns.find(({ pack }) => pack.id === packId);

const nameOf = (source: FindMoreSource): I18nText => {
  const entry = builtInOf(source.packId);
  return entry ? t(entry.pack.titleKey) : raw(source.label);
};

const logoOf = (source: FindMoreSource) => builtInOf(source.packId)?.pack.logo;

const countsLine = (source: FindMoreSource): I18nText => {
  const dashboards = source.items.filter(({ kind }) => kind === "dashboard").length;
  const alerts = source.items.length - dashboards;
  // Visible rows never hold an installed built-in, so its setup also makes its saved views.
  const views = builtInOf(source.packId)?.pack.savedViews.length ?? 0;
  const parts = [
    ...(dashboards
      ? [t("starterPacks.headerChip.countDashboards", { count: dashboards }, dashboards)]
      : []),
    ...(alerts ? [t("starterPacks.countAlerts", { count: alerts }, alerts)] : []),
    ...(views ? [t("starterPacks.countViews", { count: views }, views)] : []),
  ];
  return raw(parts.join(" · "));
};

const openLibrary = () => {
  open.value = false;
  void router.push({ name: "starterPacks", query: { org_identifier: org } }).catch(() => {});
};

const openDrawer = (packId: string) => {
  const entry = builtInOf(packId);
  if (!entry) return;
  open.value = false;
  void entry.flow.load();
  void entry.matcher.check();
  if (!usedPacks.value.includes(packId)) usedPacks.value = [...usedPacks.value, packId];
  activePack.value = packId;
};

// A Library group has no setup popup of its own yet, so it is set up from the Starter Packs page.
const setUp = (source: FindMoreSource) =>
  builtInOf(source.packId) ? openDrawer(source.packId!) : openLibrary();

const notNowAll = () => {
  const ids = matches.notNowAll();
  open.value = false;
  toast({
    message: t("starterPacks.headerChip.hidden"),
    action: { label: t("starterPacks.headerChip.undo"), handler: () => matches.undoNotNow(ids) },
  });
};

const setDrawerOpen = (packId: string, isOpen: boolean) => {
  if (isOpen) activePack.value = packId;
  else if (activePack.value === packId) activePack.value = null;
};
</script>

<template>
  <OPopover
    v-if="shown"
    v-bind="$attrs"
    v-model:open="open"
    align="end"
    flip-align
    :aria-label="t('starterPacks.headerChip.title')"
  >
    <template #trigger>
      <OButton
        variant="outline"
        size="xs"
        class="bg-button-ghost-primary-active-bg! text-button-ghost-primary-text! border-accent/45! hover:border-accent! max-md:gap-1! max-md:ps-1.5! max-md:pe-1.5!"
        :aria-label="
          t(
            'starterPacks.headerChip.ariaLabel',
            { count: matches.count.value },
            matches.count.value,
          )
        "
        data-test="header-starter-packs-btn"
      >
        <template #icon-left>
          <OIcon name="package-2" size="sm" />
        </template>
        <span class="max-md:hidden">{{ t("starterPacks.headerChip.label") }}</span>
        <span aria-hidden="true" class="opacity-60 max-md:hidden">{{ raw("·") }}</span>
        <span class="font-bold" data-test="header-starter-packs-count">{{
          matches.count.value
        }}</span>
      </OButton>
    </template>
    <div
      class="flex w-[min(25rem,calc(100vw-1.5rem))] flex-col text-sm"
      data-test="header-starter-packs-popover"
    >
      <div class="flex flex-col px-3.5 pt-3 pb-2">
        <strong class="text-text-heading">{{ t("starterPacks.headerChip.title") }}</strong>
        <OText variant="meta">{{ t("starterPacks.headerChip.subtitle") }}</OText>
      </div>

      <div
        v-if="interrupted"
        class="bg-status-warning-bg border-dropdown-separator flex gap-2.5 border-t px-3.5 py-3"
        data-test="header-starter-packs-finish"
      >
        <span
          class="bg-icon-chip-warning-bg text-icon-chip-warning-text rounded-default flex size-8 shrink-0 items-center justify-center"
        >
          <OIcon name="warning-filled" size="xs" />
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <strong class="text-text-heading">{{
            t("starterPacks.headerChip.finishTitle", {
              pack: builtInOf(interrupted.packId)
                ? t(builtInOf(interrupted.packId)!.pack.titleKey)
                : raw(interrupted.label),
            })
          }}</strong>
          <OText v-if="interrupted.total" variant="meta">{{
            t("starterPacks.headerChip.finishMeta", {
              done: interrupted.done ?? 0,
              total: interrupted.total,
            })
          }}</OText>
        </div>
        <span class="self-center">
          <OButton
            variant="outline"
            size="xs"
            data-test="header-starter-packs-finish-btn"
            @click="openDrawer(interrupted.packId)"
          >
            {{ t("starterPacks.progress.finish") }}
          </OButton>
        </span>
      </div>

      <div
        v-for="source in rows"
        :key="source.id"
        class="border-dropdown-separator flex gap-2.5 border-t px-3.5 py-3"
        :data-test="`header-starter-packs-row-${source.id}`"
      >
        <span
          class="border-border-default rounded-default bg-surface-base flex size-8 shrink-0 items-center justify-center border"
        >
          <img
            v-if="logoOf(source)"
            :src="getImageURL(logoOf(source)!)"
            class="size-5 object-contain"
            alt=""
          />
          <OIcon v-else name="package-2" size="sm" class="text-text-secondary" />
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex items-center gap-2">
            <strong class="text-text-heading min-w-0 flex-1">{{ nameOf(source) }}</strong>
            <ODropdown align="end">
              <template #trigger>
                <OButton
                  variant="ghost-muted"
                  size="icon"
                  icon-left="more-vert"
                  :aria-label="t('starterPacks.headerChip.rowMenu', { pack: nameOf(source) })"
                  :data-test="`header-starter-packs-menu-btn-${source.id}`"
                />
              </template>
              <ODropdownItem
                icon-left="schedule"
                :data-test="`header-starter-packs-not-now-${source.id}`"
                @select="matches.notNowOne(source.id)"
              >
                {{ t("starterPacks.headerChip.notNow") }}
              </ODropdownItem>
            </ODropdown>
          </div>
          <OTruncatedText
            v-if="source.streams.length"
            class="text-text-secondary min-w-0 text-xs"
            :data-test="`header-starter-packs-fits-${source.id}`"
          >
            <Translation
              :keypath="
                source.streams.length > 1
                  ? 'starterPacks.headerChip.fitsMore'
                  : 'starterPacks.headerChip.fits'
              "
              tag="span"
              scope="global"
            >
              <template #stream>
                <span class="text-text-heading text-compact font-mono">{{
                  raw(source.streams[0])
                }}</span>
              </template>
              <template #count>{{ source.streams.length - 1 }}</template>
            </Translation>
          </OTruncatedText>
          <OText variant="meta">{{ countsLine(source) }}</OText>
          <div class="mt-1.5 flex">
            <OButton
              variant="primary"
              size="xs"
              :data-test="`header-starter-packs-setup-btn-${source.id}`"
              @click="setUp(source)"
            >
              {{ t("starterPacks.headerChip.setUp") }}
            </OButton>
          </div>
        </div>
      </div>

      <div v-if="moreCount" class="border-dropdown-separator border-t px-2.5 py-1.5">
        <OButton
          variant="ghost-primary"
          size="xs"
          data-test="header-starter-packs-more"
          @click="openLibrary"
        >
          {{ t("starterPacks.headerChip.more", { count: moreCount }) }}
        </OButton>
      </div>

      <div
        class="border-dropdown-separator bg-surface-panel flex items-center gap-1 border-t px-2.5 py-2 text-xs"
      >
        <OButton
          variant="ghost-primary"
          size="xs"
          data-test="header-starter-packs-open"
          @click="openLibrary"
        >
          {{ t("starterPacks.headerChip.open") }}
        </OButton>
        <span aria-hidden="true" class="text-text-muted">{{ raw("·") }}</span>
        <OButton
          variant="ghost"
          size="xs"
          data-test="header-starter-packs-not-now-all"
          @click="notNowAll"
        >
          {{ t("starterPacks.headerChip.notNowAll") }}
        </OButton>
        <span class="flex-1" />
        <OTooltip v-if="checker.checkedTip.value" side="bottom" :content="checker.checkedTip.value">
          <OText
            variant="meta"
            tabindex="0"
            class="whitespace-nowrap underline decoration-dotted"
            data-test="header-starter-packs-checked"
            >{{ checker.checkedLabel.value }}</OText
          >
        </OTooltip>
        <OButton
          variant="ghost"
          size="icon"
          icon-left="refresh"
          :loading="checker.running.value"
          :disabled="checker.running.value"
          :aria-label="t('starterPacks.matchCheck.checkAgain')"
          data-test="header-starter-packs-refresh"
          @click="checker.refresh()"
        />
      </div>
    </div>
  </OPopover>

  <template v-for="entry in builtIns" :key="entry.pack.id">
    <StarterPackDrawer
      v-if="usedPacks.includes(entry.pack.id)"
      :open="activePack === entry.pack.id"
      :flow="entry.flow"
      :clusters="entry.matcher.clusters.value"
      @update:open="setDrawerOpen(entry.pack.id, $event)"
      @copy-link="copyToClipboard(entry.flow.packLink(), t)"
    />
  </template>
</template>
