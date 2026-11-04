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
  <!-- Always wrapped (disabled when silent) so the tile element the rail measures never remounts. -->
  <OTooltip :disabled="!tooltipText" :side="tooltipSide" :delay="300">
    <!-- Single dynamic root so external links (<a>), internal links (<router-link>)
         and submenu-group triggers (<button>, used by ONavGroup) all share the
         exact same tile markup and styling — a group tile is literally a MenuLink. -->
    <component
      :is="rootComponent"
      v-bind="{ ...$attrs, ...rootProps }"
      :class="rootClass"
      @click="onRootClick"
    >
      <div
        class="nav-menu-item-avatar flex w-full flex-col items-center gap-0.5 max-md:flex-row max-md:items-center max-md:gap-3 max-md:px-1"
      >
        <div
          class="icon-wrapper relative inline-flex items-center justify-center transition-colors duration-250"
          :class="iconClass"
        >
          <!-- Rail icons are a hair smaller than the md (24px) default. -->
          <OIcon v-if="icon" :name="icon" size="md" :filled="lens && isActive" class="size-5.5!" />
          <component v-else-if="hasIconComponent" :is="iconComponent" class="o-icon size-5.5" />
          <div
            v-if="locked"
            class="bg-surface-base absolute z-1 flex h-3.5 w-3.5 items-center justify-center rounded-full"
            :class="lens ? 'end-1.75 -top-1.25' : '-top-1 -right-1'"
          >
            <OIcon name="lock" size="xs" class="text-warning-600" />
          </div>
          <div
            v-if="badge && badge > 0"
            class="menu-badge text-3xs text-text-inverse shadow-error-500/50 border-menu-badge-ring bg-gradient-notification absolute z-1 flex h-4 min-w-4 animate-pulse items-center justify-center rounded-full border-2 px-1 leading-none font-bold shadow-md"
            :class="lens ? 'end-0.75 -top-1.25' : '-top-1 -right-2'"
            aria-live="polite"
            :aria-label="t('common.notificationsCount', { count: badge })"
          >
            {{ badge > 99 ? "99+" : badge }}
          </div>
          <span
            v-else-if="paywalled"
            :data-test="`menu-link-${link}-lock`"
            class="menu-lock text-text-secondary absolute z-1 inline-flex"
            :class="lens ? 'end-1.25 -top-1.25' : '-end-1.5 -top-1'"
            aria-hidden="true"
          >
            <OIcon name="lock" size="xs" class="size-3!" />
          </span>
        </div>
        <!-- The hidden semibold copy holds the selected label's size, so selecting a tile never rewraps the rail. -->
        <div :class="labelSlotClass" :data-label="lens ? title : undefined">
          <div
            ref="labelRef"
            class="nav-menu-item-label col-start-1 row-start-1 line-clamp-2 w-full text-center text-xs leading-tight tracking-[0.01em] break-normal wrap-normal text-ellipsis [hyphens:none] transition-colors duration-250 max-md:text-start max-md:text-sm max-md:leading-snug"
            :class="labelClass"
          >
            {{ title }}
          </div>
        </div>
      </div>
      <TooltipSilencer :silent="!tooltipText" />
      <span v-if="paywalled" :id="paywallDescriptionId" class="sr-only">{{ paywallText }}</span>

      <!-- Submenu affordance: hidden at rest so a group/link-with-subnav tile is
           indistinguishable from a plain tile (consistency). It fades in only on
           hover, or stays lit while the flyout is open / the section is active. -->
      <span
        v-if="asTrigger || submenu"
        class="absolute transition-opacity duration-150 max-md:end-3 max-md:top-1/2 max-md:-translate-y-1/2 max-md:opacity-100"
        :class="[chevronClass, expanded ? 'max-md:rotate-90 max-md:rtl:-rotate-90' : '']"
        aria-hidden="true"
      >
        <OIcon name="chevron-right" size="xs" class="max-md:size-4.5!" />
      </span>
    </component>
    <template #content>
      <span :data-test="`menu-link-${link}-tooltip`" class="flex flex-col">
        <span>{{ tooltipText }}</span>
        <span v-if="paywalled">{{ t("menu.trialEndedTitle") }}</span>
      </span>
    </template>
  </OTooltip>
</template>

<script lang="ts">
import { defineComponent, computed, inject, nextTick, ref, useId, watch, type PropType } from "vue";
import { useStore } from "vuex";
import { useRouter, RouterLink } from "vue-router";
import { injectTooltipRootContext } from "reka-ui";
import { useTheme } from "@/composables/useTheme";
import { raw, type I18nText, useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useIsTruncated } from "@/lib/overlay/Tooltip/useIsTruncated";
import { RailIndicatorActiveKey, RailLensKey } from "@/lib/core/Navbar/ONavbar.types";

// A disabled reka tooltip drops its trigger listeners but keeps a pending hover-open timer; onClose() is the only way to cancel it.
const TooltipSilencer = defineComponent({
  name: "MenuLinkTooltipSilencer",
  props: {
    silent: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const tooltip = injectTooltipRootContext(null);
    watch(
      () => props.silent,
      (silent) => {
        if (silent) tooltip?.onClose();
      },
    );
    return () => null;
  },
});

export default defineComponent({
  name: "MenuLink",
  components: { OIcon, OTooltip, TooltipSilencer },
  // Attrs are re-bound onto the tile element by hand: the tooltip wrapper is a fragment.
  inheritAttrs: false,
  props: {
    title: {
      type: String as unknown as PropType<I18nText>,
      required: true,
    },

    caption: {
      type: String as unknown as PropType<I18nText>,
      default: raw(""),
    },

    link: {
      type: String,
      default: "#",
    },

    icon: {
      type: String,
      default: "",
    },

    iconComponent: {
      type: Object,
      default: () => ({}),
    },

    mini: {
      type: Boolean,
      default: true,
    },

    target: {
      type: String,
      default: "_self",
    },

    external: {
      type: Boolean,
      default: false,
    },

    badge: {
      type: Number,
      default: 0,
    },

    // Trigger mode — render as a non-navigating <button> that opens a submenu
    // (used by ONavGroup for a group header). In this mode `active` is supplied
    // by the parent (the group is active when any child route is active) and
    // `expanded` reflects the open flyout for aria + the caret state.
    asTrigger: {
      type: Boolean,
      default: false,
    },
    active: {
      type: Boolean,
      default: false,
    },
    expanded: {
      type: Boolean,
      default: false,
    },
    // Show the submenu caret on a normal link (it reveals sub-pages on hover but
    // still navigates on click). `asTrigger` implies this for pure groups.
    submenu: {
      type: Boolean,
      default: false,
    },
    // The destination is behind the trial paywall: muted, locked, still clickable.
    paywalled: {
      type: Boolean,
      default: false,
    },
    // Present but unreachable — an enterprise/cloud-only item in a build that
    // doesn't unlock it (see utils/enterpriseFeatures.ts). Dimmed, inert on
    // click, and shows `lockedMessage` as a tooltip instead of navigating.
    locked: {
      type: Boolean,
      default: false,
    },
    lockedMessage: {
      type: String as unknown as PropType<I18nText>,
      default: raw(""),
    },
  },
  emits: ["trigger"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const store = useStore();
    const router: any = useRouter();

    const openWebPage = (url: string) => {
      window.open(url, "_blank");
    };

    // Compute the tile's active state.
    // In trigger mode the parent owns the active flag; otherwise we derive it
    // from the route. Home (link === '/') needs special handling because every
    // path starts with '/' — match by route name "home". Others prefix-match.
    const isActive = computed(() => {
      if (props.asTrigger) return props.active;
      // Explicit override — link+subnav group tiles (e.g. Data) pass `active`
      // computed from "is ANY child route active", since their children live
      // under different path roots than the tile's own link.
      if (props.active) return true;
      const route = router.currentRoute.value;
      if (props.link === "/") {
        return route.name === "home" || route.path === "/" || route.path === "";
      }
      return route.path.indexOf(props.link) === 0;
    });

    // Active-state styling is theme-aware: LIGHT keeps the classic white pill
    // with primary-coloured text/icon; DARK uses the tinted "selected" pill
    // (matching the dashboard-folder selection) with white text/icon — because
    // surface-base is black in dark mode, a white pill there would vanish.
    const { isDark } = useTheme();

    // When the rail draws a single sliding pill (ONavbar provides this), an active
    // tile defers its fill (background + coloured left accent) to that pill and
    // keeps only its active text colour — the transparent left border stays so
    // there is no width shift between states. Falls back to the self-painted pill
    // when the indicator isn't active (default `false` off the rail, or before it
    // is positioned), so the nav always shows a selection.
    const railIndicatorActive = inject(RailIndicatorActiveKey, undefined);
    const slideActive = computed(() => Boolean(railIndicatorActive?.value));

    // Desktop rail: the selection is a lens around the tile, so the tile itself carries no fill or accent border.
    const railLens = inject(RailLensKey, undefined);
    const lens = computed(() => Boolean(railLens?.value));

    const activePillClass = computed(() => {
      if (slideActive.value) {
        return isDark.value
          ? "text-tabs-active-text border-s-2 border-transparent"
          : "text-accent border-s-2 border-transparent";
      }
      return isDark.value
        ? "text-tabs-active-text bg-tabs-active-bg border-s-2 border-accent"
        : "text-accent bg-surface-base border-s-2 border-accent";
    });
    const activeIconClass = computed(() =>
      isDark.value ? "text-tabs-active-text!" : "text-accent!",
    );
    // Light active and hover labels use the darker label token; the icon keeps the accent.
    const activeLabelClass = computed(() =>
      isDark.value
        ? "font-semibold text-tabs-active-text!"
        : "font-semibold text-nav-label-accent!",
    );
    const lensIconClass = computed(() => {
      const well = "h-6 w-12";
      // A selected tile sits on the lens, so it keeps the lens foreground even when paywalled; the lock still marks it.
      if (isActive.value) return `${well} text-nav-lens-icon`;
      if (props.paywalled) return `${well} text-text-secondary`;
      return `${well} text-nav-rail-text group-hover:text-nav-rail-text-strong`;
    });
    const iconClass = computed(() => {
      if (lens.value) return lensIconClass.value;
      if (props.paywalled) return "rounded-default p-0.5 text-text-secondary";
      return isActive.value
        ? `rounded-default p-0.5 ${activeIconClass.value}`
        : "rounded-default p-0.5 text-tabs-inactive-text group-hover:text-accent";
    });
    const labelClass = computed(() => {
      if (lens.value) {
        if (isActive.value) return "font-semibold text-nav-rail-text-strong";
        if (props.paywalled) return "text-text-body font-medium";
        return "font-medium text-nav-rail-text group-hover:text-nav-rail-text-strong";
      }
      if (props.paywalled) return "text-text-body font-medium";
      return isActive.value
        ? activeLabelClass.value
        : "text-tabs-inactive-text group-hover:text-nav-label-accent font-medium";
    });
    const labelSlotClass = computed(() =>
      lens.value
        ? "grid w-full px-0.5 after:invisible after:col-start-1 after:row-start-1 after:line-clamp-2 after:w-full after:text-center after:text-xs after:leading-tight after:font-semibold after:tracking-[0.01em] after:break-normal after:[hyphens:none] after:content-[attr(data-label)]"
        : "contents",
    );
    const chevronClass = computed(() => {
      const on = isActive.value || props.expanded;
      if (lens.value) {
        return [
          "end-1.5 top-1",
          on
            ? "text-nav-rail-text-strong opacity-100"
            : "text-nav-rail-text opacity-70 group-hover:opacity-100",
        ];
      }
      return [
        "end-1 top-3",
        on
          ? "text-accent opacity-100"
          : "text-tabs-inactive-text opacity-70 group-hover:opacity-100",
      ];
    });

    // aria-current already announces the page, so the name carries no suffix.
    const ariaLabel = computed(() => {
      const label: string = props.title || t("menu.navigationLink");
      if (props.badge && props.badge > 0) {
        return t("menu.ariaWithNotifications", { label, count: props.badge });
      }
      return label;
    });

    const paywallDescriptionId = useId();
    const paywallText = computed(() => t("menu.trialPageNeedsPlan", { page: props.title }));

    const labelRef = ref<HTMLElement | null>(null);
    const { isTruncated, update: updateTruncated } = useIsTruncated(labelRef, { clamp: true });
    // A new label in the same box never resizes it, so the observer would miss a language switch.
    watch(
      () => props.title,
      async () => {
        await nextTick();
        updateTruncated();
      },
    );

    // A group tile never gets a tooltip: its flyout opens on the same edge and shows the title.
    const tooltipText = computed<I18nText | "">(() => {
      if (props.asTrigger || props.submenu) return "";
      if (props.paywalled) return paywallText.value;
      return isTruncated.value ? props.title : "";
    });
    const tooltipSide = computed(() => (document.documentElement.dir === "rtl" ? "left" : "right"));

    // The default prop is an empty object `{}`; only render a custom icon
    // component when a real one was passed.
    const hasIconComponent = computed(() => {
      const c: any = props.iconComponent;
      return !!c && (typeof c === "function" || Object.keys(c).length > 0);
    });

    // Locked wins over everything else. A real `RouterLink` can't be made
    // inert via `onRootClick`'s preventDefault — RouterLink's own click
    // handler runs before the parent's `@click` fallthrough listener (vue-
    // router merges its `navigate` first) — so a plain `div` is the only way
    // to guarantee no navigation.
    const rootComponent = computed(() =>
      props.locked ? "div" : props.external ? "a" : props.asTrigger ? "button" : RouterLink,
    );

    // Attributes bound to the root, per mode. Kept in one place so the three
    // modes can never drift apart visually.
    const rootProps = computed<Record<string, any>>(() => {
      const common: Record<string, any> = {
        "data-test": props.locked
          ? `menu-link-${props.link}-item-locked`
          : `menu-link-${props.link}-item`,
        "aria-label": ariaLabel.value,
        "data-truncated": isTruncated.value ? "true" : undefined,
      };
      if (props.locked) {
        // A plain `div` carries no native tabindex — add one so keyboard
        // users can still reach it (and trigger its click) by Tab.
        return { ...common, role: "link", tabindex: 0 };
      }
      // Set only when present: an explicit undefined would erase the tooltip's own describedby.
      if (props.paywalled) {
        common["data-paywalled"] = "true";
        common["aria-describedby"] = paywallDescriptionId;
      }
      if (props.external) {
        return {
          ...common,
          href: "#",
          target: props.target,
          "aria-current": isActive.value ? "page" : undefined,
        };
      }
      if (props.asTrigger) {
        return {
          ...common,
          type: "button",
          "aria-haspopup": "menu",
          "aria-expanded": props.expanded,
        };
      }
      return {
        ...common,
        to: {
          path: props.link,
          query: { org_identifier: store.state.selectedOrganization?.identifier },
        },
        target: props.target,
        "aria-current": isActive.value ? "page" : undefined,
        ...(props.submenu ? { "aria-haspopup": "menu", "aria-expanded": props.expanded } : {}),
      };
    });

    // The rail's lens is measured to the tile itself, so hover and selection share the clickable box.
    const lensTileClass = computed(() => {
      const tile = "py-1.25";
      // Hover tints the whole tile with no rim and no accent, so it never reads as selected.
      if (!isActive.value) return `${tile} hover:bg-nav-lens-hover`;
      // Until the rail's lens is positioned the tile paints the matte lens itself, so a selection always shows.
      return slideActive.value
        ? tile
        : `${tile} bg-nav-lens-tint ring-1 ring-inset ring-nav-lens-rim`;
    });

    const tileStateClass = computed(() => {
      if (lens.value)
        return props.locked ? `${lensTileClass.value} cursor-pointer` : lensTileClass.value;
      if (props.locked) {
        return "py-1 cursor-pointer text-tabs-inactive-text border-s-2 border-transparent bg-transparent hover:bg-tabs-hover-bg";
      }
      return isActive.value
        ? `py-1 ${activePillClass.value}`
        : "py-1 text-tabs-inactive-text border-s-2 border-transparent bg-transparent hover:bg-tabs-hover-bg";
    });

    const rootClass = computed(() => [
      "nav-menu-item",
      "group relative block [text-decoration:none]! text-inherit shrink-0 px-0 min-h-0 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface-chrome-deeper",
      // The lens tile is 4px wider than a drawer row so the selected bold label clears the lens rim.
      lens.value ? "mx-0.5 rounded-nav-lens" : "mx-1 rounded-surface",
      // Drawer rows are tap targets, so they clear the 44px touch-target minimum.
      "max-md:flex max-md:min-h-11 max-md:items-center max-md:px-2 max-md:py-2",
      // Sit above the rail's sliding pill so icon/label stay readable.
      slideActive.value ? "z-10" : "",
      tileStateClass.value,
      isActive.value ? "nav-menu-item--active" : "",
      props.title === "Functions" ? "menu-link-function" : "",
      // Reset native <button> chrome so the trigger looks EXACTLY like a link.
      // NOTE: do NOT set a background here — the active/inactive branch above owns
      // it. `appearance-none` clears the native button background; adding
      // `bg-transparent` here would override the active pill and break the
      // selected-state highlight. `font:inherit` keeps the label font identical.
      props.asTrigger
        ? "w-full appearance-none border-0 cursor-pointer text-left [font-family:inherit] [font-size:inherit] [line-height:inherit] [letter-spacing:inherit]"
        : "",
    ]);

    const onRootClick = (event: MouseEvent) => {
      if (props.locked) {
        event.preventDefault();
        router.push({ name: "enterpriseFeatures" }).catch(() => {});
        return;
      }
      if (props.external) {
        event.preventDefault();
        openWebPage(props.link);
        return;
      }
      if (props.asTrigger) {
        emit("trigger", event);
      }
    };

    return {
      t,
      store,
      router,
      openWebPage,
      isActive,
      ariaLabel,
      activePillClass,
      activeIconClass,
      activeLabelClass,
      lens,
      iconClass,
      labelClass,
      labelSlotClass,
      chevronClass,
      labelRef,
      isTruncated,
      tooltipText,
      tooltipSide,
      paywallDescriptionId,
      paywallText,
      hasIconComponent,
      rootComponent,
      rootProps,
      rootClass,
      onRootClick,
    };
  },
});
</script>
