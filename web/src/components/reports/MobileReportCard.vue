<!-- Copyright 2026 OpenObserve Inc.
Licensed under AGPL v3. -->

<template>
  <q-slide-item
    class="mobile-report-card-slide"
    left-color="green"
    right-color="red"
    @left="onSwipeLeft"
    @right="onSwipeRight"
  >
    <template #left>
      <q-icon :name="row.enabled ? 'pause' : 'play_arrow'" />
      <span class="q-ml-xs">{{ row.enabled ? t("alerts.pause") : t("alerts.start") }}</span>
    </template>
    <template #right>
      <span class="q-mr-xs">{{ t("common.delete") }}</span>
      <q-icon name="delete" />
    </template>
  <div
    class="mobile-report-card"
    :class="{ 'mobile-report-card--disabled': !row.enabled }"
    @click="$emit('click', row)"
    @keydown.enter="$emit('click', row)"
    @keydown.space.prevent="$emit('click', row)"
    role="button"
    tabindex="0"
    :aria-label="`Report ${row.name}`"
  >
    <div class="mobile-report-card__row">
      <div class="mobile-report-card__title-wrap">
        <span
          class="mobile-report-card__status-dot"
          :class="row.enabled ? 'is-on' : 'is-off'"
          :aria-label="row.enabled ? 'Enabled' : 'Paused'"
        />
        <span class="mobile-report-card__title" :title="row.name">{{
          row.name
        }}</span>
        <q-badge
          v-if="reportType === 'png'"
          color="teal"
          label="PNG"
          outline
          class="mobile-report-card__badge"
        />
        <q-badge
          v-if="row.imagePreview"
          color="blue-grey"
          label="Preview"
          outline
          class="mobile-report-card__badge"
        />
      </div>
      <q-btn
        :icon="moreIcon"
        round
        flat
        dense
        size="sm"
        class="mobile-report-card__more"
        aria-label="More actions"
        @click.stop
        @keydown.stop
      >
        <q-menu>
          <q-list dense style="min-width: 180px">
            <q-item clickable v-close-popup @click="$emit('toggle', row)">
              <q-item-section avatar>
                <q-icon :name="row.enabled ? 'pause' : 'play_arrow'" />
              </q-item-section>
              <q-item-section>{{
                row.enabled ? t("alerts.pause") : t("alerts.start")
              }}</q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="$emit('edit', row)">
              <q-item-section avatar><q-icon name="edit" /></q-item-section>
              <q-item-section>{{ t("common.edit") }}</q-item-section>
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

    <div v-if="row.description" class="mobile-report-card__desc">
      {{ row.description }}
    </div>

    <div class="mobile-report-card__meta">
      <span v-if="row.owner" class="mobile-report-card__meta-item">
        <q-icon name="person" size="12px" />{{ row.owner }}
      </span>
      <span
        v-if="lastTriggered"
        class="mobile-report-card__meta-item"
      >
        <q-icon name="schedule" size="12px" />{{ lastTriggered }}
      </span>
      <span
        class="mobile-report-card__state"
        :class="row.enabled ? 'is-on' : 'is-off'"
      >
        {{ row.enabled ? t("alerts.enabled") : t("alerts.paused") }}
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

export default defineComponent({
  name: "MobileReportCard",
  props: {
    row: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
  },
  emits: ["click", "toggle", "edit", "delete"],
  setup(props) {
    const { t } = useI18n();
    const moreIcon = outlinedMoreVert;
    const { vibrate } = useHaptics();
    const reportType = computed(
      () => props.row.dashboards?.[0]?.report_type,
    );
    const lastTriggered = computed(() => {
      const v = props.row.last_triggered_at;
      if (!v || v === "-") return "";
      return String(v);
    });
    return { t, moreIcon, reportType, lastTriggered, vibrate };
  },
  methods: {
    onSwipeLeft({ reset }: { reset: () => void }) {
      this.vibrate("selection");
      this.$emit("toggle", this.row);
      reset();
    },
    onSwipeRight({ reset }: { reset: () => void }) {
      this.vibrate("impact");
      this.$emit("delete", this.row);
      reset();
    },
  },
});
</script>

<style scoped lang="scss">
.mobile-report-card-slide {
  margin-bottom: 8px;
  border-radius: 8px;
  overflow: hidden;
}

.mobile-report-card {
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

  &--disabled {
    opacity: 0.65;
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

  &__status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;

    &.is-on {
      background: var(--o2-status-success-text);
      box-shadow: 0 0 0 3px rgba(33, 186, 69, 0.15);
    }
    &.is-off {
      background: var(--o2-text-muted);
    }
  }

  &__title {
    font-weight: 600;
    font-size: 14px;
    color: var(--o2-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  &__badge {
    flex-shrink: 0;
    font-size: 9px;
  }

  &__more {
    flex-shrink: 0;
    min-width: 44px;
    min-height: 44px;
  }

  &__desc {
    margin-top: 4px;
    margin-left: 16px;
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
    margin-left: 16px;
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

  &__state {
    margin-left: auto;
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;

    &.is-on {
      background: rgba(33, 186, 69, 0.12);
      color: var(--o2-status-success-text);
    }
    &.is-off {
      background: rgba(129, 133, 148, 0.12);
      color: var(--o2-text-muted);
    }
  }
}
</style>
