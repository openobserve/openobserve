<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { PROMPT_SUGGESTIONS } from "./welcomeContent";

const { t } = useI18n();

const emit = defineEmits<{ (e: "select", prompt: string): void }>();

function selectPrompt(id: string) {
  emit("select", t(`aiAssistant.suggestions.${id}`));
}
</script>

<template>
  <section class="prompt-suggestions">
    <p class="prompt-suggestions__heading">
      {{ t("aiAssistant.welcome.tryOneOfThese") }}
    </p>

    <div class="suggestions-grid">
      <button
        v-for="s in PROMPT_SUGGESTIONS"
        :key="s.id"
        type="button"
        class="suggestion-chip"
        @click="selectPrompt(s.id)"
      >
        <span class="suggestion-chip__icon">
          <OIcon :name="s.icon" size="sm" />
        </span>
        <span class="suggestion-chip__label">
          {{ t(`aiAssistant.suggestions.${s.id}`) }}
        </span>
        <span class="suggestion-chip__arrow" aria-hidden="true">
          <OIcon name="arrow-forward" size="xs" />
        </span>
      </button>
    </div>
  </section>
</template>

<style scoped lang="scss">
.prompt-suggestions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
}

.prompt-suggestions__heading {
  margin: 0;
  align-self: center;
  font-size: 12px;
  font-weight: 400;
  color: var(--color-typography-meta);
  opacity: 0.75;
}

.suggestions-grid {
  display: grid;
  width: 100%;
  gap: 0.5rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (max-width: 64rem) {
  .suggestions-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 40rem) {
  .suggestions-grid {
    grid-template-columns: 1fr;
  }
}

.suggestion-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem 0.5rem 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid var(--color-border-default);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-card-bg) 100%, transparent),
    color-mix(in srgb, var(--color-card-bg) 92%, transparent)
  );
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.25;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease,
    box-shadow 0.15s ease;
  overflow: hidden;
}

.suggestion-chip:hover {
  border-color: rgba(123, 97, 255, 0.5);
  color: var(--color-text-primary);
  transform: translateY(-1px);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 6px 16px -8px rgba(123, 97, 255, 0.3);
}

.suggestion-chip:focus-visible {
  outline: none;
  border-color: rgba(123, 97, 255, 0.7);
  box-shadow: 0 0 0 2px rgba(123, 97, 255, 0.4);
}

.suggestion-chip__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 0.375rem;
  background: color-mix(
    in srgb,
    var(--color-border-default) 40%,
    transparent
  );
  color: var(--color-typography-meta);
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.suggestion-chip:hover .suggestion-chip__icon {
  background: rgba(123, 97, 255, 0.15);
  color: #7b61ff;
}

.suggestion-chip__label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.suggestion-chip__arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--color-typography-meta);
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease,
    color 0.15s ease;
}

.suggestion-chip:hover .suggestion-chip__arrow {
  opacity: 1;
  transform: translateX(0);
  color: #7b61ff;
}
</style>
