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

import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { SCENARIOS, type Scenario } from "./facts";

export const useScenario = () => {
  const route = useRoute();
  const router = useRouter();

  const scenario = computed<Scenario>(() => {
    const value = route.query.scenario;
    return SCENARIOS.includes(value as Scenario) ? (value as Scenario) : "demo";
  });

  const setScenario = (next: Scenario) =>
    router.replace({ query: { ...route.query, scenario: next } });

  return { scenario, setScenario };
};
