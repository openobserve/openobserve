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

/** Default base URL per provider type when the field is blank; one table shared by the form and the list. */
export const DEFAULT_PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  deepseek: "https://api.deepseek.com",
  vllm: "http://localhost:8000/v1",
  ollama: "http://localhost:11434",
};

/** Providers with no default: a placeholder to guide the user; the field must still be filled in. */
export const SUGGESTED_PROVIDER_BASE_URLS: Record<string, string> = {
  openai_compatible: "https://your-host/v1",
  // Served at `/v1/systemone` on TypeSafe and OpenRouter; `/alpha/decisions` also works as a full URL.
  systemone: "https://openrouter.ai/api/v1",
};
