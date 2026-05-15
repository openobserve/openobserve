<!-- Copyright 2026 OpenObserve Inc.
Licensed under AGPL v3. -->

<template>
  <q-slide-item
    class="mobile-user-card-slide"
    right-color="red"
    @right="onSwipeRight"
  >
    <template #right>
      <span class="q-mr-xs">{{ t("common.delete") }}</span>
      <q-icon name="delete" />
    </template>
    <div
      class="mobile-user-card"
      @click="$emit('click', row)"
      @keydown.enter="$emit('click', row)"
      @keydown.space.prevent="$emit('click', row)"
      role="button"
      tabindex="0"
      :aria-label="`User ${fullName || row.email}`"
    >
      <div class="mobile-user-card__row">
        <div
          class="mobile-user-card__avatar"
          :style="{ background: avatarColor }"
          aria-hidden="true"
        >
          {{ initials }}
        </div>
        <div class="mobile-user-card__title-wrap">
          <span class="mobile-user-card__title" :title="fullName || row.email">
            {{ fullName || row.email }}
          </span>
          <span
            v-if="fullName"
            class="mobile-user-card__email"
            :title="row.email"
          >
            {{ row.email }}
          </span>
        </div>
        <q-btn
          v-if="showMenu"
          :icon="moreIcon"
          round
          flat
          dense
          size="sm"
          class="mobile-user-card__more"
          aria-label="More actions"
          @click.stop
          @keydown.stop
        >
          <q-menu>
            <q-list dense style="min-width: 180px">
              <q-item
                v-if="row.enableEdit && row.status !== 'pending'"
                clickable
                v-close-popup
                @click="$emit('edit', row)"
              >
                <q-item-section avatar><q-icon name="edit" /></q-item-section>
                <q-item-section>{{ t("common.edit") }}</q-item-section>
              </q-item>
              <q-item
                v-if="row.status === 'pending' && row.token"
                clickable
                v-close-popup
                @click="$emit('revoke', row)"
              >
                <q-item-section avatar><q-icon name="cancel" /></q-item-section>
                <q-item-section>{{ t("user.revoke_invite") }}</q-item-section>
              </q-item>
              <template
                v-if="row.enableDelete && row.status !== 'pending'"
              >
                <q-separator />
                <q-item
                  clickable
                  v-close-popup
                  class="text-negative"
                  @click="$emit('delete', row)"
                >
                  <q-item-section avatar><q-icon name="delete" /></q-item-section>
                  <q-item-section>{{ t("common.delete") }}</q-item-section>
                </q-item>
              </template>
            </q-list>
          </q-menu>
        </q-btn>
      </div>

      <div class="mobile-user-card__meta">
        <span v-if="row.role" class="mobile-user-card__role-pill">
          {{ row.role }}
        </span>
        <span
          v-if="row.status === 'pending'"
          class="mobile-user-card__status is-pending"
        >
          {{ t("user.invited") }}
        </span>
      </div>
    </div>
  </q-slide-item>
</template>

<script lang="ts">
import { defineComponent, computed, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { outlinedMoreVert } from "@quasar/extras/material-icons-outlined";
import { useHaptics } from "@/composables/useHaptics";

const PALETTE = [
  "#5960b2",
  "#2e7d32",
  "#c62828",
  "#ef6c00",
  "#6a1b9a",
  "#00838f",
  "#ad1457",
  "#4527a0",
];

export default defineComponent({
  name: "MobileUserCard",
  props: {
    row: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
  },
  emits: ["click", "edit", "delete", "revoke"],
  setup(props) {
    const { t } = useI18n();
    const moreIcon = outlinedMoreVert;
    const { vibrate } = useHaptics();
    const fullName = computed(() => {
      const parts = [props.row.first_name, props.row.last_name]
        .filter((p) => p && String(p).trim().length > 0)
        .map((p) => String(p).trim());
      return parts.join(" ");
    });
    const initials = computed(() => {
      const first = String(props.row.first_name || "").trim();
      const last = String(props.row.last_name || "").trim();
      if (first || last) {
        return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || "?";
      }
      const email = String(props.row.email || "");
      return (email.charAt(0) || "?").toUpperCase();
    });
    const avatarColor = computed(() => {
      const seed = String(props.row.email || fullName.value || "");
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
      }
      return PALETTE[hash % PALETTE.length];
    });
    const showMenu = computed(() => {
      const r = props.row;
      const canEdit = r.enableEdit && r.status !== "pending";
      const canDelete = r.enableDelete && r.status !== "pending";
      const canRevoke = r.status === "pending" && r.token;
      return canEdit || canDelete || canRevoke;
    });
    return { t, moreIcon, fullName, initials, avatarColor, showMenu, vibrate };
  },
  methods: {
    onSwipeRight({ reset }: { reset: () => void }) {
      if (this.row.status === "pending" && this.row.token) {
        this.vibrate("impact");
        this.$emit("revoke", this.row);
      } else if (this.row.enableDelete) {
        this.vibrate("impact");
        this.$emit("delete", this.row);
      }
      reset();
    },
  },
});
</script>

<style scoped lang="scss">
.mobile-user-card-slide {
  margin-bottom: 8px;
  border-radius: 8px;
  overflow: hidden;
}

.mobile-user-card {
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background 150ms ease,
    transform 120ms ease;

  &:active {
    background: var(--o2-hover-accent);
    transform: scale(0.995);
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__avatar {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  &__title-wrap {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  &__title {
    font-weight: 600;
    font-size: 14px;
    color: var(--o2-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__email {
    font-size: 11px;
    color: var(--o2-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__more {
    flex-shrink: 0;
    min-width: 44px;
    min-height: 44px;
  }

  &__meta {
    margin-top: 8px;
    margin-left: 46px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--o2-text-muted);
  }

  &__role-pill {
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(89, 96, 178, 0.12);
    color: var(--o2-primary-btn-bg);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  &__status {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;

    &.is-pending {
      background: rgba(239, 108, 0, 0.12);
      color: #ef6c00;
    }
  }
}
</style>
