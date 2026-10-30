// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { configQuery } from "@/services/config.queries";
import { queryClient } from "@/composables/query/queryClient";

// Chrome, Firefox and Safari word a failed dynamic import differently; Vite adds its own CSS preload error.
const CHUNK_LOAD_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (CSS )?chunk \S+ failed/i;

/**
 * Approach:
 * 1. When app loads, config API is called (by main.ts) and stored in Vuex store
 * 2. We store the initial commit hash from that config in sessionStorage (per tab)
 * 3. On chunk/resource errors, fetch config API again to check if commit hash changed
 * 4. Cache config responses to avoid excessive API calls
 * 5. Only treat as stale build if commit hash actually changed
 */

class BuildVersionChecker {
  private readonly STORAGE_KEY = "o2_initial_commit_hash";
  private isChecking = false;
  private lastCheckTime = 0;
  private cacheDuration = 5 * 60 * 1000; // Cache for 5 minutes
  private cachedConfig: any = null;

  private initialVersion: string | null = null;

  /**
   * Get this tab's baseline version, or null if not set
   */
  private getStoredVersion(): string | null {
    if (this.initialVersion) return this.initialVersion;
    try {
      return sessionStorage.getItem(this.STORAGE_KEY);
    } catch {
      return null;
    }
  }

  /**
   * Record the build this tab loaded; called from main.ts on every page load.
   */
  public setInitialVersion(commitHash: string): void {
    this.initialVersion = commitHash;
    try {
      sessionStorage.setItem(this.STORAGE_KEY, commitHash);
      // The baseline must stay per tab; a shared one hides staleness from older tabs.
      localStorage.removeItem(this.STORAGE_KEY);
    } catch {
      // Storage can be blocked; the in-memory baseline still works for this tab.
    }
  }

  /**
   * Fetch commit hash from config API
   */
  async fetchCommitHash(): Promise<string> {
    const now = Date.now();

    // Return cached version if still fresh
    if (this.cachedConfig && now - this.lastCheckTime < this.cacheDuration) {
      return this.cachedConfig.commit_hash;
    }

    const options = configQuery();
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: "none",
    });
    this.cachedConfig = await queryClient.fetchQuery(options);
    this.lastCheckTime = now;

    return this.cachedConfig.commit_hash;
  }

  /**
   * Check if a new version is available
   */
  async checkForNewVersion(): Promise<boolean> {
    if (this.isChecking) return false;

    const initialVersion = this.getStoredVersion();

    // Skip version check if we don't have an initial version
    if (!initialVersion) {
      return false;
    }

    this.isChecking = true;
    try {
      const currentServerHash = await this.fetchCommitHash();

      // Compare short hashes (first 7 chars)
      const initialShort = initialVersion.substring(0, 7);
      const currentShort = currentServerHash.substring(0, 7);

      return currentShort !== initialShort;
    } catch (error) {
      return false;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Shared helper: Check if current build is stale
   * Returns false if version check fails (network/backend error)
   */
  private async checkIfVersionIsStale(): Promise<boolean> {
    try {
      return await this.checkForNewVersion();
    } catch (error) {
      // Config API failed - this is a true network/backend error
      return false;
    }
  }

  /**
   * Helper: Extract error message from Error or ErrorEvent
   * Uses type guards to safely extract message without unsafe type assertions
   */
  private getErrorMessage(error: Error | ErrorEvent): string {
    if (error instanceof Error) {
      return error.message;
    }
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
    return "";
  }

  /**
   * Smart detection: Check if chunk load error is due to stale build
   * This distinguishes between stale build (404) and network errors
   */
  async isStaleChunkError(error: Error | ErrorEvent): Promise<boolean> {
    const errorMessage = this.getErrorMessage(error);

    // Check if it's a chunk load error
    if (!CHUNK_LOAD_ERROR_PATTERN.test(errorMessage)) {
      return false;
    }

    return this.checkIfVersionIsStale();
  }

  /**
   * Check if resource load error (script/link tag) is due to stale build
   */
  async isStaleResourceError(): Promise<boolean> {
    return this.checkIfVersionIsStale();
  }
}

// Export singleton instance
export const buildVersionChecker = new BuildVersionChecker();

/** True when the error is a failed code-split chunk or CSS preload. */
export function isChunkLoadError(error: unknown): boolean {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" && CHUNK_LOAD_ERROR_PATTERN.test(message);
}
