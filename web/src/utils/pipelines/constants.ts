import type { I18nKey } from "@/types/i18n";

/**
 * Resolved once, at module load. Both consumers (Stream.vue, CustomNode.vue)
 * read it as a plain value, so it cannot be lazy without changing their call
 * shape. Switching language reloads the page (MainLayout `changeLanguage`), so
 * the only exposure is a locale chunk that has not landed yet at import time —
 * in which case this falls back to en-US, exactly what the literal did before.
 */
export const defaultDestinationNodeWarningKey: I18nKey = "pipeline.defaultDestinationNodeWarning";
