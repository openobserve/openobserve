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
  <nav
    class="mobile-bottom-nav safe-area-bottom"
    role="navigation"
    aria-label="Mobile navigation"
  >
    <!-- Primary nav items -->
    <router-link
      v-for="item in primaryItems"
      :key="item.name"
      :to="
        orgIdentifier
          ? { path: item.link, query: { org_identifier: orgIdentifier } }
          : { path: item.link }
      "
      class="mobile-bottom-nav__item"
      :class="{
        'mobile-bottom-nav__item--active': isItemActive(item),
      }"
      :aria-label="item.title"
      :aria-current="isItemActive(item) ? 'page' : undefined"
      @click="onTabClick(item)"
    >
      <q-icon :name="item.icon" size="22px" />
      <span class="mobile-bottom-nav__label">{{ item.title }}</span>
    </router-link>

    <!-- More button -->
    <button
      class="mobile-bottom-nav__item"
      :class="{ 'mobile-bottom-nav__item--active': showMoreSheet }"
      @click="onMoreClick"
      aria-label="More navigation options"
      :aria-expanded="showMoreSheet"
    >
      <q-icon name="more_horiz" size="22px" />
      <span class="mobile-bottom-nav__label">{{ t("common.more") }}</span>
    </button>

    <!-- More sheet -->
    <q-dialog v-model="showMoreSheet" position="bottom" full-width transition-show="slide-up" transition-hide="slide-down" aria-label="More navigation options">
      <q-card class="mobile-more-sheet">
        <div class="mobile-more-sheet__handle" />
        <q-list>
          <menu-link
            v-for="item in overflowItems"
            :key="item.name"
            v-bind="{ ...item, mini: false }"
            variant="bottomsheet"
            @click="showMoreSheet = false"
          />
        </q-list>
      </q-card>
    </q-dialog>
  </nav>
</template>

<script lang="ts">
import { defineComponent, computed, ref, type PropType } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import MenuLink from "./MenuLink.vue";
import { useHaptics } from "@/composables/useHaptics";

interface NavItem {
  title: string;
  icon: string;
  link: string;
  name: string;
  display?: boolean;
}

const PRIMARY_NAV_NAMES = ["home", "logs", "dashboards", "alertList"];

export default defineComponent({
  name: "MobileBottomNav",
  components: {
    "menu-link": MenuLink,
  },
  props: {
    links: {
      type: Array as PropType<NavItem[]>,
      required: true,
    },
  },
  setup(props) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const { vibrate } = useHaptics();
    const showMoreSheet = ref(false);

    const orgIdentifier = computed(
      () => store.state.selectedOrganization?.identifier,
    );

    const visibleLinks = computed(() =>
      props.links.filter((l) => l.display !== false),
    );

    const primaryItems = computed(() => {
      return PRIMARY_NAV_NAMES.map((name) =>
        visibleLinks.value.find((l) => l.name === name),
      ).filter(Boolean) as NavItem[];
    });

    const overflowItems = computed(() => {
      const primarySet = new Set(PRIMARY_NAV_NAMES);
      return visibleLinks.value.filter((l) => !primarySet.has(l.name));
    });

    // Exact match for "/" and exact-or-trailing-slash match elsewhere so
    // sibling routes like /logs and /logstreams don't both highlight.
    const isItemActive = (item: NavItem) => {
      const path = router.currentRoute.value.path;
      if (item.link === "/") return path === "/";
      return path === item.link || path.startsWith(item.link + "/");
    };

    const onTabClick = (item: NavItem) => {
      // Skip haptic on the already-active tab — re-tap shouldn't feel like a
      // fresh navigation.
      if (isItemActive(item)) return;
      vibrate("selection");
    };

    const onMoreClick = () => {
      vibrate("selection");
      showMoreSheet.value = true;
    };

    return {
      t,
      primaryItems,
      overflowItems,
      showMoreSheet,
      orgIdentifier,
      isItemActive,
      onTabClick,
      onMoreClick,
    };
  },
});
</script>

<style scoped lang="scss">
.mobile-bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 2000;
  height: var(--o2-mobile-nav-height);
  display: flex;
  align-items: stretch;
  justify-content: space-around;
  background: var(--o2-card-bg);
  border-top: 1px solid var(--o2-border-color);
  // Subtle frosted-glass depth — matches sidebar's backdrop-filter usage
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  &__item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    text-decoration: none;
    color: var(--o2-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    position: relative;
    min-height: var(--o2-touch-target-min);
    font-family: inherit;
    -webkit-tap-highlight-color: transparent;
    // Match sidebar's transition timing
    transition: color 200ms cubic-bezier(0.4, 0, 0.2, 1);

    .q-icon {
      transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1),
        filter 200ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    // Tap feedback: slight scale
    &:active {
      .q-icon {
        transform: scale(0.92);
      }
    }

    &--active {
      color: var(--o2-primary-btn-bg);

      .q-icon {
        // Subtle glow matching sidebar active icon treatment
        filter: drop-shadow(0 0 3px var(--o2-menu-gradient-start));
      }

      // Active indicator — gradient bar matching sidebar's left-edge style
      // but rotated horizontal for bottom nav context
      &::before {
        content: "";
        position: absolute;
        top: 0;
        left: 20%;
        right: 20%;
        height: 2px;
        background: linear-gradient(
          90deg,
          var(--o2-menu-gradient-start) 0%,
          var(--o2-menu-gradient-end) 100%
        );
        border-radius: 0 0 1px 1px;
        // Soft glow to match sidebar indicator's box-shadow
        box-shadow: 0 1px 4px var(--o2-menu-gradient-start);
      }
    }
  }

  &__label {
    font-size: 10px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
}

.mobile-more-sheet {
  border-radius: 12px 12px 0 0 !important;
  max-height: 70vh;
  overflow-y: auto;
  background: var(--o2-card-bg) !important;
  // Match sidebar's backdrop-filter
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  // Keep the bottom row clear of the iPhone home indicator.
  padding-bottom: env(safe-area-inset-bottom);

  &__handle {
    width: 36px;
    height: 4px;
    background: var(--o2-border-color);
    border-radius: 2px;
    margin: 10px auto;
    opacity: 0.6;
  }
}
</style>
