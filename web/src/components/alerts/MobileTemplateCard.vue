<!-- Copyright 2026 OpenObserve Inc.
Licensed under AGPL v3. -->

<template>
  <q-slide-item
    class="mobile-template-card-slide"
    right-color="red"
    @right="onSwipeRight"
  >
    <template #right>
      <span class="q-mr-xs">{{ t("common.delete") }}</span>
      <q-icon name="delete" />
    </template>
    <div
      class="mobile-template-card"
      @click="$emit('click', row)"
      @keydown.enter="$emit('click', row)"
      @keydown.space.prevent="$emit('click', row)"
      role="button"
      tabindex="0"
      :aria-label="`Template ${row.name}`"
    >
      <div class="mobile-template-card__row">
        <q-icon
          name="description"
          size="18px"
          class="mobile-template-card__icon"
        />
        <span class="mobile-template-card__title" :title="row.name">
          {{ row.name }}
        </span>
        <q-badge
          v-if="typeLabel"
          color="deep-purple"
          outline
          :label="typeLabel"
          class="mobile-template-card__badge"
        />
        <q-btn
          :icon="moreIcon"
          round
          flat
          dense
          size="sm"
          class="mobile-template-card__more"
          aria-label="More actions"
          @click.stop
          @keydown.stop
        >
          <q-menu>
            <q-list dense style="min-width: 180px">
              <q-item clickable v-close-popup @click="$emit('edit', row)">
                <q-item-section avatar><q-icon name="edit" /></q-item-section>
                <q-item-section>{{ t("common.edit") }}</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="$emit('export', row)">
                <q-item-section avatar>
                  <q-icon name="download" />
                </q-item-section>
                <q-item-section>{{ t("common.export") }}</q-item-section>
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
    </div>
  </q-slide-item>
</template>

<script lang="ts">
import { defineComponent, computed, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { outlinedMoreVert } from "@quasar/extras/material-icons-outlined";
import { useHaptics } from "@/composables/useHaptics";

export default defineComponent({
  name: "MobileTemplateCard",
  props: {
    row: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
  },
  emits: ["click", "edit", "export", "delete"],
  setup(props) {
    const { t } = useI18n();
    const moreIcon = outlinedMoreVert;
    const { vibrate } = useHaptics();
    const typeLabel = computed(() => {
      const rawType = props.row.type;
      return rawType ? String(rawType).toLowerCase() : "";
    });
    return { t, moreIcon, typeLabel, vibrate };
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
.mobile-template-card-slide {
  margin-bottom: 8px;
  border-radius: 8px;
  overflow: hidden;
}

.mobile-template-card {
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
    min-width: 0;
  }

  &__badge {
    flex-shrink: 0;
    font-size: 9px;
    text-transform: uppercase;
  }

  &__more {
    flex-shrink: 0;
    min-width: 44px;
    min-height: 44px;
  }
}
</style>
