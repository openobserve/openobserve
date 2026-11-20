<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import OButton from "../Button/OButton.vue";
import type { CopyButtonEmits, CopyButtonProps } from "./OCopyButton.types";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<CopyButtonProps>(), {
  label: undefined,
  size: "sm",
  showLabel: false,
  variant: "ghost",
});

const emit = defineEmits<CopyButtonEmits>();
const { t } = useI18nTyped();

/** How long the check (or the failure note) stays before the button returns to rest. */
const FEEDBACK_MS = 1500;

const state = ref<"idle" | "copied" | "failed">("idle");
let timer: ReturnType<typeof setTimeout> | undefined;

const currentLabel = computed(() => {
  if (state.value === "copied") return t("copyButton.copied");
  if (state.value === "failed") return t("copyButton.failed");
  return props.label ?? t("copyButton.copy");
});

async function copy() {
  const text = typeof props.value === "function" ? props.value() : props.value;
  const ok = await copyToClipboard(text, t, { silent: true });
  clearTimeout(timer);
  state.value = ok ? "copied" : "failed";
  timer = setTimeout(() => (state.value = "idle"), FEEDBACK_MS);
  if (ok) emit("copied", text);
  else emit("failed", text);
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <OButton
    v-bind="$attrs"
    :variant="variant"
    :size="size"
    :icon-only="!showLabel"
    :label="currentLabel"
    :icon="state === 'copied' ? 'check' : 'content-copy'"
    :class="state === 'copied' ? 'text-status-success-text!' : undefined"
    :data-copied="state === 'copied' || undefined"
    @click.stop="copy"
  />
  <!-- The result is visible in place, so screen readers hear it here instead of from a toast. -->
  <span class="sr-only" role="status" aria-live="polite">{{
    state === "idle" ? "" : currentLabel
  }}</span>
</template>
