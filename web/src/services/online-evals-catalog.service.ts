// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import type { ScoreDataType, ScorerType } from "@/services/online-evals.service";

export const ONLINE_EVALS_CATALOG_URL =
  "https://raw.githubusercontent.com/openobserve/sdr_patterns/main/score_configs_and_scorers.json";

export interface CatalogScoreConfig {
  displayName: string;
  category: string;
  level: "span";
  name: string;
  dataType: ScoreDataType;
  description?: string | null;
  numericRange?: any;
  categories?: any;
}

export interface CatalogScorer {
  displayName: string;
  category: string;
  level: "span";
  requiredScoreConfigName: string;
  name: string;
  description?: string | null;
  scorer: {
    type: ScorerType;
    template: string;
    params: Record<string, any>;
  };
}

export interface OnlineEvalsCatalog {
  scoreConfigs: CatalogScoreConfig[];
  scorers: CatalogScorer[];
}

export async function fetchOnlineEvalsCatalog(): Promise<OnlineEvalsCatalog> {
  const response = await fetch(ONLINE_EVALS_CATALOG_URL, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`Failed to fetch catalog (${response.status})`);
  }

  const catalog = await response.json();
  return {
    scoreConfigs: Array.isArray(catalog?.scoreConfigs) ? catalog.scoreConfigs : [],
    scorers: Array.isArray(catalog?.scorers) ? catalog.scorers : [],
  };
}
