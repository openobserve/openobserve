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
import useSession from './useSessionReplay';

describe('useSessionReplay', () => {
  it('should return sessionState and resetSessionState function', () => {
    const { sessionState, resetSessionState } = useSession();

    expect(sessionState).toBeDefined();
    expect(resetSessionState).toBeInstanceOf(Function);
  });

  it('should have default session state structure', () => {
    const { sessionState } = useSession();

    expect(sessionState).toHaveProperty('loading');
    expect(sessionState).toHaveProperty('config');
    expect(sessionState).toHaveProperty('meta');
    expect(sessionState).toHaveProperty('data');
    expect(Array.isArray(sessionState.loading)).toBe(true);
  });

  it('should have config with expected properties', () => {
    const { sessionState } = useSession();

    expect(sessionState.config).toHaveProperty('splitterModel');
    expect(sessionState.config).toHaveProperty('refreshTimes');
    expect(Array.isArray(sessionState.config.refreshTimes)).toBe(true);
  });

  it('should have data with stream and datetime properties', () => {
    const { sessionState } = useSession();

    expect(sessionState.data).toHaveProperty('stream');
    expect(sessionState.data).toHaveProperty('datetime');
    expect(sessionState.data).toHaveProperty('sessions');
    expect(sessionState.data.stream).toHaveProperty('logStream');
    expect(sessionState.data.stream).toHaveProperty('sessionStream');
  });

  it('should call resetSessionState without errors', () => {
    const { resetSessionState } = useSession();

    // Should execute without throwing errors
    expect(() => resetSessionState()).not.toThrow();
  });
});
