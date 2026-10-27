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

import type { OnboardingChoiceId } from "../onboardingChoices";

/** The page a screenshot beside onboarding shows: one per option, plus the coding agent and synthetics. */
export type OnboardingExampleKind = OnboardingChoiceId | "agent" | "synthetics";

/** `<choice>-<row id>` pairs with a screenshot of their own (`images/onboarding/rows/`); other rows show the choice's. */
export const ROW_SHOTS: ReadonlySet<string> = new Set<string>([
  "infrastructure-linux-windows-or-macos-host",
  "infrastructure-cloud-account",
  "infrastructure-databases",
  "infrastructure-something-else",
  "backend-kubernetes-workloads-no-code-changes",
  "backend-any-language-with-opentelemetry",
  "frontend-react-native",
  "frontend-android",
  "frontend-ios",
  "logs-over-http-with-curl",
  "logs-from-opentelemetry",
  "logs-something-else",
  "llm-openai",
  "llm-anthropic",
  "llm-langchain-or-langgraph",
  "llm-something-else",
]);

/** `<choice>-<row id>` pairs with no screenshot: the choice's would show a page the row does not fill. */
export const NO_SHOT_ROWS: ReadonlySet<string> = new Set<string>(["backend-continuous-profiling"]);
