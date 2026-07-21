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
  OPageHeader — the standard page header used across the app (dashboards,
  pipelines, logs, …). The single header contract (the "TAS law"):

    ROW 1 (fixed h-14, never reflows): module icon tile + <h1> current-item
      title + right-aligned actions.
    ROW 2 (fixed h-5 band): EXACTLY ONE of —
      • Level 2 (list w/ peer sections): peer tabs (#tabs slot).
      • true module index: a plain tagline (`subtitle` prop / #subtitle).
    Tabs XOR tagline — never both at once.

  Sub-navigation (CRUD add/edit, drill-down editors): pass
  `:back="{ label, to|onClick }"` (or the #back slot). On a sub-page the leading
  module-icon TILE is replaced by a Back button (a ‹ chevron in the same 8×8
  footprint) — so a listing page shows the module icon and its add/edit page
  shows a Back button in the exact same spot, with the title's X position
  unchanged.

  NOTE: title/heading font sizes use `!important` because the app defines
  global, *unlayered* h1/h2 rules (styles/app.scss) that otherwise beat
  Tailwind utilities (unlayered CSS wins over layered utilities in v4).

  Props: title | titleDataTest | subtitle | icon | back | tabsBelow
  Slots: title-prefix | title | subtitle | actions | tabs | back
-->
<template>
  <!-- No overflow-hidden here: it clipped the focus ring of the right-most
       action button. Title overflow is handled by truncate + min-w-0 on the
       title block instead. h-14 gives the header a touch more breathing room. -->
  <!-- The header ALWAYS owns its own bottom divider (border-b, inside its own
       h-15 box so the header is exactly 60px whether it's used directly or via
       OPageLayout). Never wrap it in a bordered div and never hand-draw a
       border-b on a wrapper — that adds a second 1px line and makes the header
       61px on some pages and 60px on others. -->
  <header
    class="app-page-header shrink-0 px-page-edge border-b border-border-default"
    :class="[
      tabsBelow
        ? 'flex flex-col'
        : 'h-15 flex items-center justify-between gap-4',
    ]"
  >
    <!-- Row 1. In two-row mode this is its own flex row; otherwise it collapses
         (display:contents) so the title block + actions stay direct children of
         the header — preserving the original single-row inline-tabs layout. -->
    <div
      :class="
        tabsBelow
          ? 'h-15 flex items-center justify-between gap-4'
          : 'contents'
      "
    >
    <div class="flex items-center gap-3.25 min-w-0 h-full flex-1">
      <slot name="title-prefix" />

      <!-- Sub-page: the module-icon tile BECOMES a Back button (same 8×8
           footprint, so the title's X never shifts between list and add/edit). -->
      <template v-if="hasBack">
        <slot name="back">
          <button
            type="button"
            class="inline-flex items-center justify-center shrink-0 w-9.5 h-9.5 rounded-default bg-surface-subtle text-text-body transition-colors hover:bg-button-ghost-hover-bg outline-none focus-visible:ring-4 focus-visible:ring-primary-500/25 focus-visible:ring-inset"
            :title="backLabel"
            :aria-label="backLabel"
            :data-test="props.back?.dataTest ?? 'app-page-header-back'"
            @click="onBack"
          >
            <OIcon name="chevron-left" size="md" />
          </button>
        </slot>
      </template>

      <!-- Listing/index page: the module icon tile. -->
      <span
        v-else-if="icon"
        class="inline-flex items-center justify-center shrink-0 w-9.5 h-9.5 rounded-default bg-tabs-active-bg text-tabs-active-text"
        aria-hidden="true"
      >
        <OIcon :name="icon" size="md" />
      </span>

      <div class="flex flex-col justify-center min-w-0 shrink-0">
        <h1
          class="text-base! font-semibold! leading-[1.45]! tracking-[-0.02em]! text-text-heading truncate min-h-6"
          :title="title"
          :data-test="titleDataTest"
        >
          <slot name="title">{{ title }}</slot>
        </h1>
        <!-- Fixed-height subtitle band: keeps the <h1> at an identical Y whether
             the subtitle is present or not, so the title doesn't appear to shift
             when navigating between views. Content is vertically centered. -->
        <OText
          v-if="hasSubtitle"
          variant="meta"
          as="div"
          class="flex items-center h-5 min-w-0 -mt-0.5"
        >
          <slot name="subtitle">
            <!-- leading-normal (not the meta variant's leading-none): truncate
                 sets overflow:hidden, and a 1em line box clips descenders
                 (g/y/p). The h-5 band + items-center leaves room for it. -->
            <span class="truncate min-w-0 leading-normal">{{ subtitle }}</span>
          </slot>
        </OText>
      </div>

      <!-- Inline content placed immediately after the title block (e.g. a name
           input on create pages). Renders between title text and tabs/actions. -->
      <slot name="title-trail" />

      <!-- Module tabs (Level-2 nav), inline to the right of the title.
           Two-row mode renders them as a full-width strip below instead. -->
      <div
        v-if="hasTabs && !tabsBelow"
        class="flex items-center min-w-0 flex-1 h-full"
      >
        <slot name="tabs" />
      </div>
    </div>

    <div
      v-if="hasActions"
      class="flex items-center gap-2 shrink-0"
    >
      <slot name="actions" />
    </div>
    </div>

    <!-- Row 2: full-width section-tab strip (prototype's two-row header). The
         header draws its own bottom divider (see the border-b on <header> above)
         whenever it has tabs, and OTabs draws its active underline flush at its
         bottom edge — so the underline lands exactly on that divider with no
         margin hacks and no consumer-drawn border. The -mt-2 pulls the tab row up
         into the title row's slack so the overall header height stays compact. -->
    <div v-if="hasTabs && tabsBelow" class="-mt-2">
      <slot name="tabs" />
    </div>
  </header>
</template>

<script setup lang="ts">
import { Comment, Text, computed, useSlots } from "vue";
import { useRouter } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

interface BackTarget {
  /** Optional; button falls back to plain "Back" aria-label when omitted. */
  label?: string;
  to?: import("vue-router").RouteLocationRaw;
  onClick?: () => void;
  dataTest?: string;
}

const props = withDefaults(
  defineProps<{
    title?: string;
    /** Optional data-test attribute rendered on the <h1>, so consumers can
     *  drop the #title slot (whose only purpose was attaching a test hook). */
    titleDataTest?: string;
    subtitle?: string;
    icon?: IconName;
    /** Overlay/dialog back-pill ("‹ {label}") shown leading, before the icon. */
    back?: BackTarget;
    /** Render the #tabs slot as a full-width strip below row 1 (prototype's
     *  two-row header) instead of inline beside the title. */
    tabsBelow?: boolean;
  }>(),
  {
    title: "",
    subtitle: "",
  },
);

const router = useRouter();
const slots = useSlots();

// A slot passed with an always-present <template> but a falsy inner v-if still
// yields a comment placeholder node — so checking `$slots.x` is truthy even
// when there's nothing to show. Detect *real* content instead, so we never
// render an empty subtitle band / tabs strip / actions group.
const slotHasContent = (name: string): boolean => {
  const fn = slots[name];
  if (!fn) return false;
  return fn().some((node) => {
    if (node.type === Comment) return false;
    if (node.type === Text)
      return typeof node.children === "string" && node.children.trim() !== "";
    return true;
  });
};

const hasSubtitle = computed(
  () => Boolean(props.subtitle) || slotHasContent("subtitle"),
);
const hasTabs = computed(() => slotHasContent("tabs"));
const hasActions = computed(() => slotHasContent("actions"));
const hasBack = computed(() => Boolean(props.back) || slotHasContent("back"));
const backLabel = computed(() =>
  props.back?.label ? `Back to ${props.back.label}` : "Back",
);

const onBack = () => {
  if (props.back?.onClick) props.back.onClick();
  else if (props.back?.to) router.push(props.back.to);
};
</script>
