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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

const SUMMARY_MAX = 120;

/** The error with any HTML body cut away, so it is safe to show as text. */
export const plainAlertError = (error: string): string => {
  const htmlAt = error.search(/<\s*(!doctype|html|head|body|div|p|h1)\b/i);
  const text = htmlAt >= 0 ? error.slice(0, htmlAt) : error;
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[,;:\s]+(err)?[,;:\s]*$/i, "")
    .trim();
};

/** One line for a failed delivery or evaluation: "405 Method Not Allowed from <destination>". */
export const summarizeAlertError = (error: string | null | undefined, t: TranslateFn): I18nText => {
  if (!error) return raw("—");
  const plain = plainAlertError(error);
  const status = /status:?\s*(\d{3}(?:\s+[A-Za-z ]+?)?)(?:[,;]|$)/.exec(plain)?.[1]?.trim();
  const destination = /destination\s+(\S+)/i.exec(plain)?.[1];
  if (status && destination) return t("alerts.historyTable.errorFrom", { status, destination });
  if (status) return raw(status);
  const body = plain.replace(/^error sending notification for alert:\s*/i, "");
  return raw(body.length > SUMMARY_MAX ? `${body.slice(0, SUMMARY_MAX)}…` : body);
};
