<!-- Copyright 2026 OpenObserve Inc.
Licensed under AGPL v3. -->

<template>
  <q-slide-item
    class="mobile-dashboard-card-slide"
    right-color="red"
    @right="onSwipeRight"
  >
    <template #right>
      <span class="q-mr-xs">{{ t("common.delete") }}</span>
      <q-icon name="delete" />
    </template>
  <div
    class="mobile-dashboard-card"
    @click="$emit('click', row)"
    @keydown.enter="$emit('click', row)"
    @keydown.space.prevent="$emit('click', row)"
    role="button"
    tabindex="0"
    :aria-label="`Dashboard ${row.name}`"
  >
    <div class="mobile-dashboard-card__row">
      <div class="mobile-dashboard-card__title-wrap">
        <q-icon
          name="dashboard"
          size="18px"
          class="mobile-dashboard-card__icon"
        />
        <span class="mobile-dashboard-card__title" :title="row.name">{{
          row.name
        }}</span>
      </div>
      <q-btn
        icon="more_vert"
        round
        flat
        dense
        size="sm"
        class="mobile-dashboard-card__more"
        aria-label="More actions"
        @click.stop
        @keydown.stop
      >
        <q-menu>
          <q-list dense style="min-width: 180px">
            <q-item clickable v-close-popup @click="$emit('open', row)">
              <q-item-section avatar
                ><q-icon name="open_in_new"
              /></q-item-section>
              <q-item-section>{{ t("common.open") }}</q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="$emit('clone', row)">
              <q-item-section avatar
                ><q-icon name="content_copy"
              /></q-item-section>
              <q-item-section>{{ t("common.duplicate") }}</q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="$emit('move', row)">
              <q-item-section avatar
                ><q-icon name="drive_file_move"
              /></q-item-section>
              <q-item-section>{{ t("common.move") }}</q-item-section>
            </q-item>
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
          </q-list>
        </q-menu>
      </q-btn>
    </div>

    <div v-if="row.description" class="mobile-dashboard-card__desc">
      {{ row.description }}
    </div>

    <div class="mobile-dashboard-card__meta">
      <span v-if="row.owner" class="mobile-dashboard-card__meta-item">
        <q-icon name="person" size="12px" />{{ row.owner }}
      </span>
      <span v-if="row.created" class="mobile-dashboard-card__meta-item">
        <q-icon name="schedule" size="12px" />{{ row.created }}
      </span>
    </div>
  </div>
  </q-slide-item>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useHaptics } from "@/composables/useHaptics";

export default defineComponent({
  name: "MobileDashboardCard",
  props: {
    row: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
  },
  emits: ["click", "open", "clone", "move", "delete"],
  setup() {
    const { t } = useI18n();
    const { vibrate } = useHaptics();
    return { t, vibrate };
  },
  methods: {
    onSwipeRight({ reset }: { reset: () => void }) {
      this.vibrate("impact");
      this.$emit("delete", this.row);
      reset();
    },
  },
});
</script>

<style scoped lang="scss">
.mobile-dashboard-card-slide {
  margin-bottom: 8px;
  border-radius: 8px;
  overflow: hidden;
}

.mobile-dashboard-card {
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
    gap: 8px;
  }

  &__title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  &__icon {
    color: var(--o2-primary-btn-bg);
    flex-shrink: 0;
  }

  &__title {
    font-weight: 600;
    font-size: 14px;
    color: var(--o2-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  &__more {
    flex-shrink: 0;
    min-width: 44px;
    min-height: 44px;
  }

  &__desc {
    margin-top: 4px;
    margin-left: 26px;
    font-size: 12px;
    color: var(--o2-text-secondary);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__meta {
    margin-top: 8px;
    margin-left: 26px;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 11px;
    color: var(--o2-text-muted);
  }

  &__meta-item {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
}
</style>
