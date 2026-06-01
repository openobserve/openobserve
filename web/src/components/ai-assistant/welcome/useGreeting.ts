import { computed } from "vue";
import { useI18n } from "vue-i18n";

/**
 * Builds a time-of-day greeting using the user's local timezone.
 * Only the user's email is captured server-side, so we derive a display
 * name from the local part of the email.
 */
export function useGreeting(email: () => string | undefined) {
  const { t } = useI18n();

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
    const key = `aiAssistant.greeting.${period.value}`;
    const phrase = t(key);
    return displayName.value ? `${phrase}, ${displayName.value}` : phrase;
  });

  return { displayName, period, greeting };
}
