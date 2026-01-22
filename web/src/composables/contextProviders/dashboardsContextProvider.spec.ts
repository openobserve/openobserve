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
import { createDashboardsContextProvider } from './dashboardsContextProvider';

describe('createDashboardsContextProvider', () => {
  it('should create context for viewing dashboard', () => {
    const route = {
      query: {
        dashboard: 'dash-123',
        tab: 'tab-1'
      }
    };

    const store = {
      state: {
        selectedOrganization: {
          identifier: 'org-456'
        }
      }
    };

    const currentDashboardData = {
      data: {
        title: 'Test Dashboard'
      }
    };

    const provider = createDashboardsContextProvider(route, store, undefined, undefined, currentDashboardData);
    const context = provider.getContext();

    expect(context.currentPage).toBe('Dashboards');
    expect(context.dashboardId).toBe('dash-123');
    expect(context.organization_identifier).toBe('org-456');
    expect(context.user_intent).toBe('view dashboard');
    expect(context.dashboardName).toBe('Test Dashboard');
    expect(context.tabId).toBe('tab-1');
  });

  it('should create context for editing panel', () => {
    const route = {
      query: {
        dashboard: 'dash-123',
        panelId: 'panel-456'
      }
    };

    const store = {
      state: {
        selectedOrganization: {
          identifier: 'org-789'
        }
      }
    };

    const dashboardPanelData = {
      data: {
        title: 'Test Panel'
      }
    };

    const provider = createDashboardsContextProvider(route, store, dashboardPanelData, true);
    const context = provider.getContext();

    expect(context.currentPage).toBe('Dashboards');
    expect(context.panelId).toBe('panel-456');
    expect(context.user_intent).toBe('edit existing panel');
    expect(context.panelName).toBe('Test Panel');
  });

  it('should create context for creating new panel', () => {
    const route = {
      query: {
        dashboard: 'dash-123'
      }
    };

    const store = {
      state: {
        selectedOrganization: {
          identifier: 'org-abc'
        }
      }
    };

    const dashboardPanelData = {
      data: {
        title: 'New Panel'
      }
    };

    const provider = createDashboardsContextProvider(route, store, dashboardPanelData, false);
    const context = provider.getContext();

    expect(context.currentPage).toBe('Dashboards');
    expect(context.user_intent).toBe('create new panel');
    expect(context.panelName).toBe('New Panel');
  });

  it('should handle missing data gracefully', () => {
    const route = { query: {} };
    const store = { state: { selectedOrganization: null } };

    const provider = createDashboardsContextProvider(route, store);
    const context = provider.getContext();

    expect(context.currentPage).toBe('Dashboards');
    expect(context.dashboardId).toBe('');
    expect(context.organization_identifier).toBe('');
    expect(context.user_intent).toBe('view dashboard');
  });
});
