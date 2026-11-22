// LLM Insights: the Top errors panel, the AI data health strip and the empty state's integration guides.
export class LlmInsightsPage {
    constructor(page) {
        this.page = page;
        this.topErrorsPanel = page.locator('[data-test="llm-top-errors"]').first();
        this.dataHealthStrip = page.locator('[data-test="llm-data-health-strip"]');
        this.dataHealthError = page.locator('[data-test="llm-data-health-error"]');
        this.dataHealthDrawer = page.locator('[data-test="llm-data-health-drawer"]');
        this.emptyState = page.locator('[data-test="llm-insights-empty"]');
        this.anySuggestedGuide = page.locator('[data-test^="o2-empty-state-action-suggested-"]');
        this.allIntegrationsAction = page.locator('[data-test="o2-empty-state-action-all-integrations"]');
    }

    async goto({ org, stream, period, referer } = {}) {
        const params = new URLSearchParams({ org_identifier: org });
        if (stream) {
            params.set('type', 'stream');
            params.set('stream', stream);
        }
        if (period) params.set('period', period);
        await this.page.goto(
            `${process.env.ZO_BASE_URL.replace(/\/$/, '')}/web/ai/llm-insights?${params.toString()}`,
            referer ? { referer } : undefined,
        );
    }

    dataHealthChip(key) {
        return this.page.locator(`[data-test="llm-data-health-chip-${key}"]`);
    }

    async openDataHealthChip(key) {
        await this.dataHealthChip(key).click();
    }

    suggestedGuide(slug) {
        return this.page.locator(`[data-test="o2-empty-state-action-suggested-${slug}"]`);
    }

    integrationChip(slug) {
        return this.page.locator(`[data-test="o2-empty-state-action-integration-${slug}"]`);
    }
}

export default LlmInsightsPage;
