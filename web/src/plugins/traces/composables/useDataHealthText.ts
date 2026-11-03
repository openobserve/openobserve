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

import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { DataHealthCheck, DataHealthCheckId } from "@/services/gen-ai-data-health.service";
import { formatTokens } from "@/utils/llmUtils";
import { unpricedTotals } from "../llmDataTrust.utils";

/** Share of the checked spans a check flags, e.g. "12%" or "0.4%". */
export function affectedPct(check: DataHealthCheck): string {
  if (!check.total) return "0%";
  const p = (check.affected / check.total) * 100;
  return `${p < 1 && p > 0 ? p.toFixed(1) : Math.round(p)}%`;
}

/** Shared by LLM Insights and the coding-agent tab so both describe a check the same way. */
export function useDataHealthText() {
  const { t } = useI18nTyped();

  function label(id: DataHealthCheckId): I18nText {
    switch (id) {
      case "unpriced_models":
        return t("llmDataTrust.health.checks.unpriced_models.label");
      case "missing_agent_identity":
        return t("llmDataTrust.health.checks.missing_agent_identity.label");
      case "zero_duration_spans":
        return t("llmDataTrust.health.checks.zero_duration_spans.label");
      case "missing_session_id":
        return t("llmDataTrust.health.checks.missing_session_id.label");
    }
  }

  function detail(check: DataHealthCheck): I18nText {
    if (check.status === "pass") {
      switch (check.id) {
        case "unpriced_models":
          return t("llmDataTrust.health.checks.unpriced_models.pass");
        case "missing_agent_identity":
          return t("llmDataTrust.health.checks.missing_agent_identity.pass");
        case "zero_duration_spans":
          return t("llmDataTrust.health.checks.zero_duration_spans.pass");
        case "missing_session_id":
          return t("llmDataTrust.health.checks.missing_session_id.pass");
      }
    }
    const params = {
      affected: check.affected.toLocaleString(),
      total: check.total.toLocaleString(),
      pct: affectedPct(check),
    };
    switch (check.id) {
      case "unpriced_models": {
        const { modelCount, tokens } = unpricedTotals(check);
        return t(
          "llmDataTrust.health.checks.unpriced_models.detail",
          {
            count: modelCount.toLocaleString(),
            spans: check.affected.toLocaleString(),
            tokens: formatTokens(tokens),
          },
          modelCount,
        );
      }
      case "missing_agent_identity":
        return t("llmDataTrust.health.checks.missing_agent_identity.detail", params);
      case "zero_duration_spans":
        return t("llmDataTrust.health.checks.zero_duration_spans.detail", params);
      case "missing_session_id":
        return t("llmDataTrust.health.checks.missing_session_id.detail", params);
    }
  }

  /** "Top 20 of 25 by tokens" when the server lists only part of the unpriced models. */
  function truncatedNote(check: DataHealthCheck): I18nText | null {
    const { truncated, models, modelCount } = unpricedTotals(check);
    if (!truncated) return null;
    return t("llmDataTrust.health.checks.unpriced_models.truncated", {
      shown: models.length,
      total: modelCount.toLocaleString(),
    });
  }

  function fixLabel(id: DataHealthCheckId): I18nText {
    switch (id) {
      case "unpriced_models":
        return t("llmDataTrust.health.checks.unpriced_models.fix");
      case "missing_agent_identity":
        return t("llmDataTrust.health.checks.missing_agent_identity.fix");
      case "zero_duration_spans":
        return t("llmDataTrust.health.checks.zero_duration_spans.fix");
      case "missing_session_id":
        return t("llmDataTrust.health.checks.missing_session_id.fix");
    }
  }

  function statusLabel(status: DataHealthCheck["status"]): I18nText {
    if (status === "error") return t("llmDataTrust.health.status.error");
    if (status === "warning") return t("llmDataTrust.health.status.warning");
    return t("llmDataTrust.health.status.pass");
  }

  return { label, detail, truncatedNote, fixLabel, statusLabel };
}
