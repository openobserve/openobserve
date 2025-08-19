// Copyright 2023 OpenObserve Inc.
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

import { createRouter, createMemoryHistory } from "vue-router";
import { vi } from "vitest";

// Mock location.replace for Vue Router
const mockLocation = {
  href: 'http://localhost:3000/web/',
  origin: 'http://localhost:3000',
  protocol: 'http:',
  host: 'localhost:3000',
  hostname: 'localhost',
  port: '3000',
  pathname: '/web/',
  search: '',
  hash: '',
  assign: vi.fn(),
  replace: vi.fn(),
  reload: vi.fn(),
};

// Ensure location is properly mocked for Vue Router
Object.defineProperty(globalThis, 'location', {
  value: mockLocation,
  writable: true,
});

// Create a simple test router with memory history to avoid location issues
const router = createRouter({
  history: createMemoryHistory('/web/'),
  routes: [
    {
      path: '/',
      name: 'home',
      component: { template: '<div>Home</div>' }
    },
    {
      path: '/login',
      name: 'login',
      component: { template: '<div>Login</div>' }
    },
    {
      path: '/logs',
      name: 'logs',
      component: { template: '<div>Logs</div>' }
    },
    {
      path: '/functions',
      name: 'functions',
      component: { template: '<div>Functions</div>' }
    },
    {
      path: '/alerts',
      name: 'alerts',
      component: { template: '<div>Alerts</div>' }
    },
    {
      path: '/alerts/list',
      name: 'alertList',
      component: { template: '<div>Alert List</div>' }
    },
    {
      path: '/alerts/templates',
      name: 'alertTemplates',
      component: { template: '<div>Alert Templates</div>' }
    },
    {
      path: '/alerts/destinations',
      name: 'alertDestinations',
      component: { template: '<div>Alert Destinations</div>' }
    },
    {
      path: '/dashboards',
      name: 'dashboards',
      component: { template: '<div>Dashboards</div>' }
    },
    {
      path: '/roles',
      name: 'roles',
      component: { template: '<div>Roles</div>' }
    },
    {
      path: '/roles/:role_name/edit',
      name: 'editRole',
      component: { template: '<div>Edit Role</div>' }
    },
    {
      path: '/users',
      name: 'users',
      component: { template: '<div>Users</div>' }
    },
    {
      path: '/groups',
      name: 'groups',
      component: { template: '<div>Groups</div>' }
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: { template: '<div>Not Found</div>' }
    }
  ],
});

export default router;
