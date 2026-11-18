// Page object for Infrastructure > Kubernetes (web/src/views/Infrastructure/kubernetes2).

import { expect } from '@playwright/test';

export class KubernetesPage {
  constructor(page) {
    this.page = page;
    this.shell = page.locator('[data-test="k8s2-shell"]');
    this.eventsTable = page.locator('[data-test="k8s2-table-events"]');
    this.clusterPickerTrigger = page.locator('[data-test="k8s2-cluster-picker-trigger"]');
    this.dateTimeBtn = page.locator('[data-test="k8s2-date-time"]');
    this.dateTimeMenu = page.locator('#date-time-menu');
  }

  /** Holds the org's search and PromQL responses until release(), so the page stays in its loading state. */
  async holdQueries(org) {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const held = [];
    const pattern = new RegExp(`/api/${org}/(_search|_search_stream|prometheus/)`);
    await this.page.route(pattern, async (route) => {
      held.push(route.request().url());
      await gate;
      await route.continue().catch(() => {});
    });
    return {
      held,
      release: async () => {
        release();
        await this.page.unroute(pattern);
      },
    };
  }

  /** Captures the [start_time, end_time] window of every search the page sends. */
  trackSearchWindows() {
    const windows = [];
    this.page.on('request', (req) => {
      if (req.method() !== 'POST' || !/\/_search(_stream)?(\?|$)/.test(req.url())) return;
      try {
        const body = JSON.parse(req.postData() || '{}');
        const q = body.query || body;
        if (q.start_time && q.end_time) windows.push({ start: Number(q.start_time), end: Number(q.end_time) });
      } catch {
        /* not a JSON search body */
      }
    });
    return windows;
  }

  async expectClusterPickerLoading(loadingText) {
    await expect(this.clusterPickerTrigger).toBeVisible({ timeout: 15000 });
    await expect(this.clusterPickerTrigger).toContainText(loadingText);
    await expect(this.clusterPickerTrigger).toBeDisabled();
  }

  async expectClusterPickerShows(cluster) {
    await expect(this.clusterPickerTrigger).toBeEnabled({ timeout: 30000 });
    await expect(this.clusterPickerTrigger).toContainText(cluster, { timeout: 30000 });
  }

  async pickRelativePreset(suffix) {
    await this.dateTimeBtn.click();
    await expect(this.dateTimeMenu).toBeVisible({ timeout: 10000 });
    await this.page.locator(`[data-test="date-time-relative-${suffix}-btn"]`).click();
  }

  async expectDateMenuClosed() {
    await expect(this.dateTimeMenu).toBeHidden({ timeout: 10000 });
  }

  async open({ org, query = {} }) {
    const base = (process.env.ZO_BASE_URL || '').replace(/\/+$/, '');
    const params = new URLSearchParams({ org_identifier: org, ...query });
    await this.page.goto(`${base}/web/infra/kubernetes?${params.toString()}`);
    await expect(this.shell).toBeVisible({ timeout: 30000 });
  }

  async expectView(view) {
    await expect.poll(() => new URL(this.page.url()).searchParams.get('view'), { timeout: 15000 }).toBe(view);
  }

  async expectEventsTableContains(text) {
    await expect(this.eventsTable).toBeVisible({ timeout: 30000 });
    await expect(this.eventsTable).toContainText(text, { timeout: 30000 });
  }
}
