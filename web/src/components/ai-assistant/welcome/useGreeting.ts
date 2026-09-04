import { computed } from "vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";

/**
 * Builds a time-of-day greeting using the user's local timezone.
 * Only the user's email is captured server-side, so we derive a display
 * name from the local part of the email.
 */
export function useGreeting(email: () => string | undefined) {
  const { t } = useI18nTyped();

  const displayName = computed(() => {
    const raw = (email() ?? "").trim();
    if (!raw) return "";
    const local = raw.split("@")[0] ?? "";
    const first = local.split(/[._\-+]/).filter(Boolean)[0] ?? local;
    if (!first) return "";
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  });

  const period = computed<"morning" | "afternoon" | "evening" | "night">(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "morning";
    if (hour >= 12 && hour < 17) return "afternoon";
    if (hour >= 17 && hour < 21) return "evening";
    return "night";
  });

  const greeting = computed(() => {
    // Annotated so TS checks the built key against I18nKey: `period` is a literal
    // union, so renaming or dropping any of the four keys fails the build.
    // Two complete keys per period rather than appending ", {name}" to the
    // translated phrase — the name's position in the sentence is per-language.
    if (displayName.value) {
      const namedKey: I18nKey = `aiAssistant.greetingNamed.${period.value}`;
      return t(namedKey, { name: displayName.value });
    }
    const key: I18nKey = `aiAssistant.greeting.${period.value}`;
    return t(key);
  });

  return { displayName, period, greeting };
}
