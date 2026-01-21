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
import { createAlertsContextProvider } from './alertsContextProvider';

describe('createAlertsContextProvider', () => {
  it('should create a context provider for creating new alert', () => {
    const formData = {
      value: {
        id: 'alert-123',
        name: 'Test Alert',
        type: 'scheduled'
      }
    };

    const store = {
      state: {
        selectedOrganization: {
          identifier: 'org-456'
        }
      }
    };

    const provider = createAlertsContextProvider(formData, store, false);
    const context = provider.getContext();

    expect(context.currentPage).toBe('Alerts');
    expect(context.alertId).toBe('alert-123');
    expect(context.alertName).toBe('Test Alert');
    expect(context.isRealTime).toBe(false);
    expect(context.organization_identifier).toBe('org-456');
    expect(context.user_intent).toBe('create new alert');
  });

  it('should create a context provider for editing existing alert', () => {
    const formData = {
      value: {
        id: 'alert-789',
        name: 'Updated Alert',
        type: 'realtime'
      }
    };

    const store = {
      state: {
        selectedOrganization: {
          identifier: 'org-123'
        }
      }
    };

    const provider = createAlertsContextProvider(formData, store, true);
    const context = provider.getContext();

    expect(context.currentPage).toBe('Alerts');
    expect(context.alertId).toBe('alert-789');
    expect(context.alertName).toBe('Updated Alert');
    expect(context.isRealTime).toBe(true);
    expect(context.organization_identifier).toBe('org-123');
    expect(context.user_intent).toBe('edit existing alert');
  });

  it('should handle missing form data gracefully', () => {
    const formData = { value: null };
    const store = { state: { selectedOrganization: null } };

    const provider = createAlertsContextProvider(formData, store, false);
    const context = provider.getContext();

    expect(context.currentPage).toBe('Alerts');
    expect(context.alertId).toBe('');
    expect(context.alertName).toBe('');
    expect(context.isRealTime).toBe(false);
    expect(context.organization_identifier).toBe('');
  });
});
