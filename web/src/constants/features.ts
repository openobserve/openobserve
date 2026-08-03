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

/**
 * Feature Registry Configuration
 *
 * This file provides TypeScript types and helper functions for working with features.
 * The actual feature data is loaded from features.json for easy maintenance.
 *
 * When a new feature is added to the product:
 * 1. Add a new entry to features.json
 * 2. Add corresponding i18n translation keys to all locale files
 * 3. The feature will automatically appear in the UI
 */

import featuresData from "./features.json";
import type { I18nKey } from "@/types/i18n";

export type EditionType = "opensource" | "enterprise" | "cloud";

/**
 * `true`/`false` mark plain availability; a string is an i18n key for a
 * qualifying note (e.g. "Requires HA mode"). Typing the string arm as
 * `I18nKey` is what makes features.json participate in key checking — it is a
 * data file, so a bare `string` here leaves these keys invisible to every
 * static check and they read as dead.
 */
export interface FeatureAvailability {
  opensource: boolean | I18nKey;
  enterprise: boolean | I18nKey;
  cloud: boolean | I18nKey;
}

export interface FeatureDefinition {
  /**
   * Unique identifier for the feature
   */
  id: string;

  /**
   * i18n translation key for the feature name
   * If not provided, will default to `about.feature_{id}`
   */
  nameKey?: string;

  /**
   * Feature availability across different editions
   */
  availability: FeatureAvailability;

  /**
   * Display order priority (lower numbers appear first)
   * If not provided, features appear in the order they are defined
   */
  order?: number;

  /**
   * Category for grouping features (optional, for future enhancements)
   */
  category?: "core" | "enterprise" | "support" | "infrastructure";
}

/**
 * Central Feature Registry
 *
 * Loaded from features.json at build time.
 * To add new features, edit features.json instead of this file.
 */
export const FEATURE_REGISTRY: FeatureDefinition[] = featuresData.features as FeatureDefinition[];

/**
 * Helper function to get feature name key
 */
export function getFeatureNameKey(feature: FeatureDefinition): string {
  return feature.nameKey || `about.feature_${feature.id}`;
}

/**
 * Helper function to get features by category
 */
export function getFeaturesByCategory(category: FeatureDefinition["category"]) {
  return FEATURE_REGISTRY.filter((f) => f.category === category);
}

/**
 * Helper function to get all features sorted by order
 */
export function getSortedFeatures(): FeatureDefinition[] {
  return [...FEATURE_REGISTRY].sort((a, b) => {
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
    return orderA - orderB;
  });
}
