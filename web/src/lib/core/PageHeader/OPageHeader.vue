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

<!-- The stacked page header (header-spec v2.1, H1–H8): a fixed 56 px band, then tabs on their own 40 px row. -->
<template>
  <header
    ref="headerEl"
    class="app-page-header relative shrink-0"
    data-test="o-page-header"
    data-o2-page-shell
    :data-drawer-anchor="ownsSidebarTrigger ? 'page-layout-sidebar' : undefined"
  >
    <!-- Fixed rows, never sized by content, so the title's box is the same on every page (H1, H8). -->
    <!-- Not positioned, so its bottom rule resolves against the header and spans it under a narrowed band. -->
    <div
      class="px-page-edge grid h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-4"
      :class="contentSize && SIZE_CLASS[contentSize]"
      data-test="o-page-header-band"
    >
      <div class="flex min-w-0 flex-col">
        <div
          class="text-text-secondary flex h-4 min-w-0 items-center text-xs leading-4"
          data-test="o-page-header-context"
        >
          <FeatureLockExempt v-if="back" as="span" class="flex min-w-0">
            <component
              :is="backHref ? 'a' : 'button'"
              :href="backHref"
              :type="backHref ? undefined : 'button'"
              class="rounded-chip text-text-link hover:text-text-link-hover focus-visible:ring-focus-ring-accent inline-flex max-w-full min-w-0 cursor-pointer items-center gap-0.5 underline-offset-2 transition-[color,box-shadow] outline-none hover:underline focus-visible:ring-2"
              :aria-label="t('common.backTo', { label: back.label })"
              :data-test="back.dataTest ?? 'app-page-header-back'"
              @click="onBack"
            >
              <OIcon name="chevron-left" size="xs" class="shrink-0" />
              <span class="min-w-0 truncate">{{ back.label }}</span>
            </component>
          </FeatureLockExempt>
          <!-- An ungrouped page keeps the empty slot so its title sits where every other title does (H1). -->
          <span
            v-else
            class="min-w-0 truncate"
            :aria-hidden="contextLabel ? undefined : 'true'"
            data-test="o-page-header-context-label"
            >{{ contextLabel }}</span
          >
        </div>

        <div class="flex h-6 min-w-0 items-center gap-2" data-test="o-page-header-title-row">
          <!-- A slotted title (an inline-edited name) owns its overflow, so its focus ring is not clipped. -->
          <h1
            v-if="slots.title"
            class="text-text-heading font-title flex min-w-0 items-center text-lg leading-6 tracking-normal"
            :data-test="titleDataTest"
          >
            <slot name="title" />
          </h1>
          <OTruncatedText
            v-else
            as="h1"
            class="text-text-heading font-title min-w-0 text-lg leading-6 tracking-normal"
            :data-test="titleDataTest"
            >{{ title }}</OTruncatedText
          >
          <span
            v-if="locked"
            role="img"
            :aria-label="lockedLabel"
            class="lock-chip inline-flex shrink-0"
            data-test="app-page-header-locked"
          >
            <OIcon name="lock" size="sm" />
            <OTooltip :content="lockedLabel" />
          </span>
          <OPopover v-if="about" size="md" side="bottom" align="start" :aria-label="aboutLabel">
            <template #trigger>
              <OButton
                icon-only
                variant="ghost"
                size="xs"
                icon="info-outline"
                class="shrink-0"
                :label="aboutLabel"
                data-test="o-page-header-about"
              />
            </template>
            <p class="text-text-body p-3 text-sm leading-5" data-test="o-page-header-about-text">
              {{ about }}
            </p>
          </OPopover>
          <span v-if="hasStatus()" class="flex shrink-0 items-center gap-2">
            <slot name="status" />
          </span>
          <span v-if="statusComponent" class="flex shrink-0 items-center">
            <component :is="statusComponent" :compact="compactStatus" />
          </span>
        </div>
      </div>

      <!-- Secondary, then primary, then ⋯ More last; under 640 px the secondaries fold into More (H3, R2). -->
      <div
        v-if="hasActions() || hasActionsOverflow() || ownsSidebarTrigger"
        class="flex items-center justify-end gap-2 max-md:[&_.date-time-label]:hidden"
        data-test="o-page-header-actions"
      >
        <FeatureLockExempt v-if="ownsSidebarTrigger" as="span" class="contents">
          <OButton
            icon-only
            variant="ghost"
            icon="menu"
            data-test="o-page-layout-mobile-sidebar-btn"
            :label="t('common.sidePanel')"
            @click="layoutSidebar?.open()"
          />
        </FeatureLockExempt>
        <slot v-if="hasActionsOverflow() && smUp" name="actions-overflow" />
        <slot name="actions" />
        <ODropdown v-if="hasActionsOverflow() && !smUp" side="bottom" align="end">
          <template #trigger>
            <OButton
              icon-only
              variant="ghost"
              icon="more-horiz"
              data-test="app-page-header-more-btn"
              :label="t('common.more')"
            />
          </template>
          <div class="flex max-w-56 flex-col items-stretch gap-1 p-1.5">
            <slot name="actions-overflow" />
          </div>
        </ODropdown>
      </div>

      <div
        v-if="!hasTabs()"
        aria-hidden="true"
        class="border-border-default pointer-events-none absolute inset-x-0 bottom-0 border-b"
      />
    </div>

    <!-- OTabs insets its first label by its own list and tab padding (0.6875rem), so the row starts that much before the gutter. -->
    <!-- The strip is taller than the row (OTabs' top inset), so a fixed track pins its bottom, and the underline, onto the divider. -->
    <div
      v-if="hasTabs()"
      class="pe-page-edge relative grid h-10 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] items-end ps-[calc(var(--spacing-page-edge)-0.6875rem)] pb-px"
      data-test="o-page-header-tabs"
    >
      <div
        aria-hidden="true"
        class="border-border-default pointer-events-none absolute inset-x-0 bottom-0 border-b"
      />
      <slot name="tabs" />
    </div>
  </header>
</template>

<script setup lang="ts">
import { raw, useI18nTyped } from "@/types/i18n";
import {
  Comment,
  Text,
  computed,
  inject,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  useSlots,
} from "vue";
import { useRouter } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import useSmartBack from "@/composables/useSmartBack";
import { useFeatureLock, useFeatureNames } from "@/composables/useFeatureLock";
import { PAGE_LAYOUT_SIDEBAR_KEY } from "@/lib/core/PageLayout/pageLayoutSidebar";
import { usePageHeaderStatusHost } from "@/lib/core/PageHeader/pageHeaderStatus";
import { usePageContextLabel } from "@/lib/core/PageHeader/pageContext";
import FeatureLockExempt from "@/components/common/FeatureLockExempt.vue";
import type { PageHeaderProps } from "./OPageHeader.types";

const props = withDefaults(defineProps<PageHeaderProps>(), {
  title: raw(""),
  titleDataTest: undefined,
  back: undefined,
  context: undefined,
  about: undefined,
  contentSize: undefined,
});

// Tailwind's `4xl` container width: a narrower page shows the status chip compact.
const PAGE_COMPACT_REM = 56;
// The same widths as ConstrainedPage and OSaveBar, so the actions end where the form column ends.
const SIZE_CLASS = {
  sm: "max-w-2xl",
  md: "max-w-3xl",
  lg: "max-w-5xl",
  xl: "max-w-7xl",
} as const;

const router = useRouter();
const slots = useSlots();
const { t } = useI18nTyped();
const { featureName } = useFeatureNames();
const breakpoint = useBreakpoint();
// A spec that mocks useBreakpoint may omit smUp; treat that as a wide window.
const smUp = computed(() => breakpoint.smUp?.value ?? true);
const lgUp = computed(() => breakpoint.lgUp?.value ?? true);
const isMobile = computed(() => breakpoint.isMobile?.value ?? false);
const { locked, feature: lockedFeature } = useFeatureLock();
const lockedLabel = computed(() =>
  t("featureLock.headerLocked", {
    feature: raw(
      lockedFeature.value ? (featureName(lockedFeature.value) ?? lockedFeature.value) : "",
    ),
  }),
);
const aboutLabel = computed(() => t("pageHeader.about"));
const derivedContext = usePageContextLabel(() => props.title);
const contextLabel = computed(() => props.context || derivedContext.value);

const backHref = computed(() => {
  const to = props.back?.to;
  if (!to || !router?.resolve) return undefined;
  try {
    return router.resolve(to).href;
  } catch {
    return undefined;
  }
});
const { goBack } = useSmartBack(() => props.back?.to ?? "/");
const onBack = (event: MouseEvent) => {
  // A modified click opens the parent in a new tab, as any link does.
  if (backHref.value && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0))
    return;
  event.preventDefault();
  if (props.back?.onClick) props.back.onClick();
  else goBack();
};

// The first header inside a sidebar layout carries its phone trigger, saving the layout a row.
const layoutSidebar = inject(PAGE_LAYOUT_SIDEBAR_KEY, null);
const sidebarClaim = Symbol("page-header");
const claimSidebarTrigger = () => {
  if (layoutSidebar && layoutSidebar.owner.value === null) layoutSidebar.owner.value = sidebarClaim;
};
const releaseSidebarTrigger = () => {
  if (layoutSidebar?.owner.value === sidebarClaim) layoutSidebar.owner.value = null;
};
onMounted(claimSidebarTrigger);
onActivated(claimSidebarTrigger);
onBeforeUnmount(releaseSidebarTrigger);
onDeactivated(releaseSidebarTrigger);
const ownsSidebarTrigger = computed(
  () => isMobile.value && layoutSidebar?.owner.value === sidebarClaim,
);

const headerEl = ref<HTMLElement | null>(null);
const statusComponent = usePageHeaderStatusHost(headerEl);

// The page container, not the viewport, decides: the AI panel narrows the page on a wide window.
const pageNarrow = ref(false);
let pageObserver: ResizeObserver | null = null;
onMounted(() => {
  const page = headerEl.value?.closest<HTMLElement>('[class~="@container/page"]');
  if (!page || typeof ResizeObserver === "undefined") return;
  const measure = () => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    pageNarrow.value = page.clientWidth < PAGE_COMPACT_REM * rem;
  };
  measure();
  pageObserver = new ResizeObserver(measure);
  pageObserver.observe(page);
});
onBeforeUnmount(() => pageObserver?.disconnect());
const compactStatus = computed(() => !lgUp.value || pageNarrow.value);

// A slot whose only content is a falsy v-if still yields a comment node, so look for real content.
const slotHasContent = (name: string): boolean => {
  const fn = slots[name];
  if (!fn) return false;
  return fn().some((node) => {
    if (node.type === Comment) return false;
    if (node.type === Text) return typeof node.children === "string" && node.children.trim() !== "";
    return true;
  });
};

// Plain functions, not computed: useSlots() is not reactive, so a cached answer would miss late content.
const hasTabs = (): boolean => slotHasContent("tabs");
const hasStatus = (): boolean => slotHasContent("status");
const hasActions = (): boolean => slotHasContent("actions");
const hasActionsOverflow = (): boolean => slotHasContent("actions-overflow");
</script>
