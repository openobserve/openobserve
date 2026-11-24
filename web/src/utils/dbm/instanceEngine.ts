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

import type { DbmScopeFilter } from "@/utils/dbm/scopeFilter";
import type { DbmInstanceHit } from "@/services/db_monitoring";
import { raw, type I18nText } from "@/types/i18n";

/** Display-only: locks the Engine filter to the instance's engine when all its hits agree; never touches models or the URL. */
export const applyInstanceEngine = (
  filters: DbmScopeFilter[],
  hits: DbmInstanceHit[],
  reason: I18nText,
): DbmScopeFilter[] => {
  const instance = filters.find((f) => f.key === "instance")?.value;
  const engines = new Set(hits.filter((h) => h.db_instance === instance).map((h) => h.db_system));
  const engine = instance && engines.size === 1 ? [...engines][0] : undefined;
  if (!engine) return filters;
  return filters.map((f) =>
    f.key === "system"
      ? {
          ...f,
          value: engine,
          options: f.options.some((o) => o.value === engine)
            ? f.options
            : [...f.options, { value: engine, label: raw(engine) }],
          disabled: true,
          disabledReason: reason,
        }
      : f,
  );
};
