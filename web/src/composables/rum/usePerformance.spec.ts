// Copyright 2026 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect } from 'vitest';
import usePerformance from './usePerformance';

describe('usePerformance', () => {
  it('should return performanceState and resetSessionState function', () => {
    const { performanceState, resetSessionState } = usePerformance();

    expect(performanceState).toBeDefined();
    expect(resetSessionState).toBeInstanceOf(Function);
  });

  it('should have default performance state structure', () => {
    const { performanceState } = usePerformance();

    expect(performanceState).toHaveProperty('data');
    expect(performanceState.data).toHaveProperty('datetime');
    expect(performanceState.data).toHaveProperty('streams');
  });

  it('should have datetime with expected default values', () => {
    const { performanceState } = usePerformance();

    expect(performanceState.data.datetime.startTime).toBe(0);
    expect(performanceState.data.datetime.endTime).toBe(0);
    expect(performanceState.data.datetime.relativeTimePeriod).toBe('15m');
    expect(performanceState.data.datetime.valueType).toBe('relative');
  });

  it('should have streams object', () => {
    const { performanceState } = usePerformance();

    expect(typeof performanceState.data.streams).toBe('object');
  });

  it('should call resetSessionState without errors', () => {
    const { resetSessionState } = usePerformance();

    // Should execute without throwing errors
    expect(() => resetSessionState()).not.toThrow();
  });
});
