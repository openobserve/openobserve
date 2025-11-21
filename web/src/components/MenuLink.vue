<!-- Copyright 2023 OpenObserve Inc.

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
  <q-item
    :data-test="`menu-link-${link}-item`"
    v-ripple="true"
    :to="
      !external
        ? {
            path: link,
            exact: false,
            query: {
              org_identifier: store.state.selectedOrganization?.identifier,
            },
          }
        : ''
    "
    clickable
    :class="{
      'q-router-link--active':
        router.currentRoute.value.path.indexOf(link) == 0 && link != '/',
      'q-link-function': title == 'Functions',
    }"
    :target="target"
    :aria-current="isActive ? 'page' : undefined"
    :aria-label="ariaLabel"
    v-on="external ? { click: () => openWebPage(link) } : {}"
  >
    <q-item-section v-if="icon" avatar>
      <div class="icon-wrapper">
        <q-icon :name="icon" />
        <div
          v-if="badge && badge > 0"
          class="menu-badge"
          aria-live="polite"
          :aria-label="`${badge} notifications`"
        >
          {{ badge > 99 ? '99+' : badge }}
        </div>
      </div>
      <q-item-label>{{ title }}</q-item-label>
    </q-item-section>
    <q-item-section v-else-if="iconComponent" avatar>
      <div class="icon-wrapper">
        <q-icon><component :is="iconComponent" /></q-icon>
        <div
          v-if="badge && badge > 0"
          class="menu-badge"
          aria-live="polite"
          :aria-label="`${badge} notifications`"
        >
          {{ badge > 99 ? '99+' : badge }}
        </div>
      </div>
      <q-item-label>{{ title }}</q-item-label>
    </q-item-section>
  </q-item>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";

export default defineComponent({
  name: "MenuLink",
  props: {
    title: {
      type: String,
      required: true,
    },

    caption: {
      type: String,
      default: "",
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

    // Phase 4: Badge support
    badge: {
      type: Number,
      default: 0,
    },
  },
  setup(props) {
    const store = useStore();
    const router: any = useRouter();

    const openWebPage = (url: string) => {
      window.open(url, "_blank");
    };

    // Phase 5: Accessibility - compute active state
    const isActive = computed(() => {
      return router.currentRoute.value.path.indexOf(props.link) === 0 && props.link !== '/';
    });

    // Phase 5: Accessibility - compute ARIA label with fallback
    const ariaLabel = computed(() => {
      let label = props.title || 'Navigation link';
      if (props.badge && props.badge > 0) {
        label += ` (${props.badge} notifications)`;
      }
      if (isActive.value) {
        label += ' - Current page';
      }
      return label;
    });

    return {
      store,
      router,
      openWebPage,
      isActive,
      ariaLabel,
    };
  },
});
</script>

<style scoped lang="scss">
@import "../styles/menu-variables";
@import "../styles/menu-animations";

.q-item {
  padding: 1px 8px;
  margin: 0px;
  border-radius: 6px;

  /* Always have a border to prevent layout shift when active */
  border: 1px solid transparent;

  /* Minimal height to prevent scrollbar */
  min-height: 24px;

  // Add top margin to first item so border is visible
  &:first-child {
    margin-top: 4px;
  }

  // Phase 2: Enhanced transitions
  transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);

  // Phase 6: Performance optimizations
  // Use transform and opacity for GPU acceleration
  will-change: transform;
  transform: translateZ(0);

  // Phase 2: Enhanced hover state with 3D icon effect
  &:hover:not(.q-router-link--active) {
    transform: translateZ(0);
    // background-color: rgba(30, 41, 59, 0.6);

    .q-icon {
      color: var(--o2-menu-color);
      // 3D pop-out effect with slight rotation
      transform: translateZ(20px) scale(1.15) rotateY(5deg);
      filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
    }

    .q-item-label {
      color: var(--o2-menu-color);
      transform: translateY(-2px);
    }
  }

  // Phase 2 & 3: Enhanced active state with modern UX
  &.q-router-link--active {
    transform: translateZ(0) !important;
    // Rich, vibrant multi-layer gradient background
    // background:
    //   linear-gradient(135deg, rgba(168, 85, 247, 0.4) 0%, rgba(236, 72, 153, 0.35) 100%),
    //   linear-gradient(180deg, rgba(139, 92, 246, 0.15) 0%, rgba(124, 58, 237, 0.25) 100%) !important;
    // // Stronger border with glow
    // border: 1px solid rgba(168, 85, 247, 0.6) !important;
    // // Minimal shadow for subtle depth
    // box-shadow:
    //   0 0 8px rgba(168, 85, 247, 0.2),
    //   0 2px 8px rgba(168, 85, 247, 0.25),
    //   inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
    background: linear-gradient(135deg, var(--o2-menu-gradient-start) 0%, var(--o2-menu-gradient-end) 100%) !important;

    box-shadow: 0 4px 12px rgba(89, 155, 174, 0.09) !important;
    color: var(--o2-menu-color) !important;
    transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
    // Subtle inner highlight for depth
    position: relative;
    backdrop-filter: blur(8px) !important;

    .q-icon {
      // Minimal icon glow
      filter: drop-shadow(0 0 4px rgba(168, 85, 247, 0.4));
      color: var(--o2-menu-color); // Lighter purple for better visibility
    }

    .q-item-label {
      font-weight: 700;
      color: var(--o2-menu-color); // Very light purple/white for contrast
      text-shadow: 0 0 4px rgba(168, 85, 247, 0.3);
    }

    // Phase 3: Enhanced active indicator with minimal shadow
    &::before {
      content: " ";
      width: 6px;
      height: 100%;
      position: absolute;
      left: -8px;
      top: 50%;
      transform: translateY(-50%);
      // Brighter gradient
      background: linear-gradient(180deg, var(--o2-primary-btn-bg) 0%, var(--o2-primary-btn-bg) 50%, var(--o2-primary-btn-bg) 100%);
      border-radius: 0 2px 2px 0;
      // Minimal glow
      box-shadow: 0 0 6px var(--o2-menu-color);
    }

    // Subtle animated glow overlay
    &::after {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: --o2-menu-gradient-start;
      border-radius: 0 6px 6px 0;
      pointer-events: none;
    }
  }

  // Phase 2: Enhanced focus state for keyboard navigation
  &:focus-visible {
    outline: 2px solid #a855f7;
    outline-offset: 2px;
  }

  &.ql-item-mini {
    margin: 0;

    &::before {
      display: none;
    }
  }

  &[aria-label="Billing"] {
    .q-icon {
      font-size: 1.3rem;
    }
  }
}

// Phase 3: Enhanced icon container with 3D effects and spring bounce-back
.q-item__section--avatar {
  margin: 0;
  padding: 0;
  min-width: 40px;
  perspective: 1000px; // Enable 3D space

  .q-icon {
    padding: 4px;
    border-radius: 12px;
    // Spring bounce-back effect: overshoots and bounces back
    transition: all 600ms cubic-bezier(0.68, -0.55, 0.265, 1.55);
    transform-style: preserve-3d;
  }
}

// Add spring bounce-back transition to label
.q-item-label {
  transition: all 500ms cubic-bezier(0.68, -0.55, 0.265, 1.55);
  transform-style: preserve-3d;
}

// Phase 4: Badge support
.icon-wrapper {
  position: relative;
  display: inline-block;
}

.menu-badge {
  position: absolute;
  top: -4px;
  right: -8px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: linear-gradient(135deg, #ef4444 0%, #ec4899 100%);
  border: 2px solid #0f172a;
  border-radius: 50%;
  font-size: 9px;
  font-weight: 700;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  box-shadow: 0 4px 8px rgba(239, 68, 68, 0.5);
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  z-index: 1;

  // Phase 6: Performance - GPU acceleration
  will-change: opacity;
  transform: translateZ(0);

  // Light mode
  body.body--light & {
    border-color: #ffffff;
    box-shadow: 0 4px 8px rgba(239, 68, 68, 0.3);
  }
}

// Light mode support - using :deep() to pierce scoped styles
body.body--light {
  .q-item {


    &.q-router-link--active {

      // &::before {
      //   // background: linear-gradient(180deg, var(--o2-body-primary-bg) 0%, var(--o2-body-secondary-bg) 100%) !important;
      //   box-shadow: 4px 0px 0px var(--o2-menu-color) !important;
      // }
    }
  }
}

</style>
