// Copyright 2023 OpenObserve Inc.
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

import configService from "@/services/config";

/**
 *
 * Approach:
 * 1. Commit hash is injected at build time via Vite's define option
 * 2. On chunk errors, fetch config API to check if commit_hash changed
 * 3. Cache config responses to avoid excessive API calls
 * 4. Only treat as stale build if commit hash actually changed
 * 5. test message 
 */


class BuildVersionChecker {
  private currentVersion: string;
  private isChecking = false;
  private lastCheckTime = 0;
  private cacheDuration = 5 * 60 * 1000; // Cache for 5 minutes
  private cachedConfig: any = null;

  constructor() {
    // Get current version from build-time injected constant
    this.currentVersion = __COMMIT_HASH__;
  }

  /**
   * Fetch commit hash from config API
   */
  async fetchCommitHash(): Promise<string> {
    const now = Date.now();

    // Return cached version if still fresh
    if (this.cachedConfig && (now - this.lastCheckTime) < this.cacheDuration) {
      return this.cachedConfig.commit_hash;
    }

    const response = await configService.get_config();
    this.cachedConfig = response.data;
    this.lastCheckTime = now;

    return this.cachedConfig.commit_hash;
  }

  /**
   * Check if a new version is available
   */
  async checkForNewVersion(): Promise<boolean> {
    if (this.isChecking) return false;

    // Skip version check if commit hash is unknown
    if (this.currentVersion === "unknown") {
      return false;
    }

    this.isChecking = true;
    try {
      const serverCommitHash = await this.fetchCommitHash();

      // Compare short hashes (first 7 chars) since build uses short hash
      const currentShort = this.currentVersion.substring(0, 7);
      const serverShort = serverCommitHash.substring(0, 7);

      return serverShort !== currentShort;
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
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
    return '';
  }

  /**
   * Smart detection: Check if chunk load error is due to stale build
   * This distinguishes between stale build (404) and network errors
   */
  async isStaleChunkError(error: Error | ErrorEvent): Promise<boolean> {
    const errorMessage = this.getErrorMessage(error);

    // Check if it's a chunk load error
    const isChunkError = /Loading chunk|Failed to fetch dynamically imported module/i.test(errorMessage);

    if (!isChunkError) {
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
