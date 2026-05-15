<!-- Copyright 2026 OpenObserve Inc.
Licensed under AGPL v3. -->

<template>
  <q-slide-item
    class="mobile-function-card-slide"
    right-color="red"
    @right="onSwipeRight"
  >
    <template #right>
      <span class="q-mr-xs">{{ t("common.delete") }}</span>
      <q-icon name="delete" />
    </template>
    <div
      class="mobile-function-card"
      @click="$emit('click', row)"
      @keydown.enter="$emit('click', row)"
      @keydown.space.prevent="$emit('click', row)"
      role="button"
      tabindex="0"
      :aria-label="`Function ${row.name}`"
    >
      <div class="mobile-function-card__row">
        <q-icon
          name="code"
          size="18px"
          class="mobile-function-card__icon"
        />
        <span class="mobile-function-card__title" :title="row.name">
          {{ row.name }}
        </span>
        <span
          v-if="row.transType"
          class="mobile-function-card__badge"
          :title="`Type: ${normalizedType}`"
        >
          {{ normalizedType }}
        </span>
        <q-btn
          :icon="moreIcon"
          round
          flat
          dense
          size="sm"
          class="mobile-function-card__more"
          aria-label="More actions"
          @click.stop
          @keydown.stop
        >
          <q-menu>
            <q-list dense style="min-width: 200px">
              <q-item clickable v-close-popup @click="$emit('edit', row)">
                <q-item-section avatar><q-icon name="edit" /></q-item-section>
                <q-item-section>{{ t("common.edit") }}</q-item-section>
              </q-item>
              <q-item
                clickable
                v-close-popup
                @click="$emit('pipelines', row)"
              >
                <q-item-section avatar
                  ><q-icon name="account_tree"
                /></q-item-section>
                <q-item-section>{{ t("function.associatedPipelines") }}</q-item-section>
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
      <pre v-if="preview" class="mobile-function-card__preview">{{ preview }}</pre>
    </div>
  </q-slide-item>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { outlinedMoreVert } from "@quasar/extras/material-icons-outlined";
import { useHaptics } from "@/composables/useHaptics";

export default defineComponent({
  name: "MobileFunctionCard",
  props: {
    row: {
      type: Object as PropType<Record<string, any>>,
      required: true,
    },
  },
  emits: ["click", "edit", "delete", "pipelines"],
  setup(props) {
    const { t } = useI18n();
    const { vibrate } = useHaptics();
    const normalizedType = computed(() => {
      const raw = props.row.transType;
      if (raw === 1 || raw === "1") return "vrl";
      if (raw === 0 || raw === "0") return "lua";
      return String(raw ?? "").toLowerCase();
    });
    const preview = computed(() => {
      const fn: string = props.row.function || "";
      const single = fn.replace(/\s+/g, " ").trim();
      if (!single) return "";
      return single.length > 80 ? `${single.slice(0, 80)}…` : single;
    });
    return { t, moreIcon: outlinedMoreVert, normalizedType, preview, vibrate };
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
.mobile-function-card-slide {
  margin-bottom: 8px;
  border-radius: 8px;
  overflow: hidden;
}

.mobile-function-card {
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
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: var(--o2-primary-btn-bg);
    background: color-mix(in srgb, var(--o2-primary-btn-bg) 12%, transparent);
    border-radius: 999px;
    padding: 2px 8px;
    flex-shrink: 0;
  }

  &__more {
    flex-shrink: 0;
    min-width: 44px;
    min-height: 44px;
  }

  &__preview {
    margin: 8px 0 0 28px;
    padding: 8px 10px;
    font-family:
      ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono",
      monospace;
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--o2-text-secondary);
    background: color-mix(in srgb, var(--o2-text-primary) 4%, transparent);
    border-radius: 6px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 3.6em;
    overflow: hidden;
  }
}
</style>
