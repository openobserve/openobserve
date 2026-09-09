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
 * The base URL each built-in LLM provider type resolves to when the user
 * leaves the Base URL field blank. Shared between the provider create/edit
 * form and the providers list (which had drifted into two separate,
 * inconsistent copies of this table).
 */
export const DEFAULT_PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  deepseek: "https://api.deepseek.com",
  vllm: "http://localhost:8000/v1",
  ollama: "http://localhost:11434",
};

/**
 * Providers with no working default — every deployment is host- or
 * resource-specific, so this is an example shape to guide the user, not a
 * value that would function as-is.
 */
export const SUGGESTED_PROVIDER_BASE_URLS: Record<string, string> = {
  openai_compatible: "https://your-host/v1",
};
