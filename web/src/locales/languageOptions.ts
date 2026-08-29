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

import { raw, type I18nText } from "@/types/i18n";

export interface LanguageOption {
  label: I18nText;
  code: string;
}

// Endonyms remain raw so every language stays recognizable under any active locale.
export const languageOptions: LanguageOption[] = [
  { label: raw("English"), code: "en-us" },
  { label: raw("العربية"), code: "ar" },
  { label: raw("Türkçe"), code: "tr-turk" },
  { label: raw("简体中文"), code: "zh-cn" },
  { label: raw("繁體中文"), code: "zh-tw" },
  { label: raw("Français"), code: "fr" },
  { label: raw("Español"), code: "es" },
  { label: raw("Deutsch"), code: "de" },
  { label: raw("Italiano"), code: "it" },
  { label: raw("日本語"), code: "ja" },
  { label: raw("한국어"), code: "ko" },
  { label: raw("Nederlands"), code: "nl" },
  { label: raw("Português"), code: "pt" },
  { label: raw("Русский"), code: "ru" },
  { label: raw("Polski"), code: "pl" },
  { label: raw("Tiếng Việt"), code: "vi" },
];
