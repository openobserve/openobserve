import { expect } from '@playwright/test';

// The rrweb faults a replay that lost track of a tab's DOM raises, and VideoPlayer's own "Session replay:" decode faults; other rrweb warnings are benign.
const PLAYER_FAULT = /^\[replayer\] (Node with id '[^']*' not found|Exception in mutation|parent could not remove child|Found unresolved missing node map)|^\[replayer\].*(appendChild|insertBefore|removeChild|detached)|^Session replay:/;

export class RumReplayPlayerPage {
    constructor(page) {
        this.page = page;
        this.playerTime = page.locator('[data-test="video-player-time"]');
        this.playerDuration = page.locator('[data-test="video-player-duration"]');
        // The replay surface carries no data-test; its id is the stable hook, and a click on it toggles playback.
        this.playerSurface = page.locator('#player');
        this.replayFrameBody = page.frameLocator('#player iframe').locator('body');
        // The speed select carries no data-test either; it is the only combobox whose value reads like "4x".
        this.speedSelect = page.getByRole('combobox').filter({ hasText: /^\d+(\.\d+)?x$/ });
        this.normalSpeedOption = page.getByRole('option', { name: '1x', exact: true });
    }

    /** Starts collecting uncaught page errors and the player's DOM-replay faults; returns the live list. */
    watchPlayerFaults() {
        const faults = [];
        this.page.on('pageerror', (error) => faults.push(`pageerror: ${error.message}`));
        this.page.on('console', (msg) => {
            if (['error', 'warning'].includes(msg.type()) && PLAYER_FAULT.test(msg.text())) {
                faults.push(`${msg.type()}: ${msg.text()}`);
            }
        });
        return faults;
    }

    async playedSeconds() {
        const text = ((await this.playerTime.textContent()) || '').trim();
        return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
    }

    async durationText() {
        return ((await this.playerDuration.textContent()) || '').trim();
    }

    async frameText() {
        return this.replayFrameBody.innerText({ timeout: 1000 }).catch(() => '');
    }

    // A tab can be on screen for only a few seconds and a read blocks while the frame swaps, so the frame is sampled every 100 ms.
    async expectFrameShows(text, timeoutMs = 30000) {
        await expect
            .poll(() => this.frameText(), { timeout: timeoutMs, intervals: [100], message: `replay frame must show "${text}"` })
            .toContain(text);
    }

    async expectFrameDoesNotShow(text) {
        await expect(this.replayFrameBody).not.toContainText(text);
    }

    /** Switches the player from its default 4x to real-time speed, so a short-lived tab stays on screen long enough to read. */
    async playAtNormalSpeed() {
        await this.speedSelect.click();
        await this.normalSpeedOption.click();
        await expect(this.speedSelect).toHaveText('1x');
    }

    async startPlayback() {
        await expect(this.playerTime).toHaveText(/^0+:00$/);
        await this.playerSurface.click();
        await expect
            .poll(() => this.playedSeconds(), { timeout: 15000, message: 'playback must start after clicking the replay' })
            .toBeGreaterThan(0);
    }

    /** Faults are cumulative, so one raised before the target fails the poll and is printed beside the time playback reached. */
    async expectPlaybackReachesWithoutFaults(seconds, faults, timeoutMs = 60000) {
        const progress = async () => ({ playedTo: Math.min(await this.playedSeconds(), seconds), faults: [...faults] });
        await expect
            .poll(progress, {
                timeout: timeoutMs,
                intervals: [500],
                message: `playback must reach ${seconds}s with no player fault`,
            })
            .toEqual({ playedTo: seconds, faults: [] });
    }
}
