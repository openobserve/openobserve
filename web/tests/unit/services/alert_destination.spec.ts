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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import destination from '@/services/alert_destination';

// Mock http module
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockGet = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/services/http', () => ({
  default: () => ({
    post: mockPost,
    put: mockPut,
    get: mockGet,
    delete: mockDelete
  })
}));

describe('alert_destination service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('calls POST with correct URL and data', () => {
      const params = {
        org_identifier: 'test-org',
        destination_name: 'test-dest',
        data: { name: 'Test Destination', type: 'http' }
      };

      destination.create(params);

      expect(mockPost).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations',
        params.data
      );
    });

    it('includes module parameter in URL when provided', () => {
      const params = {
        org_identifier: 'test-org',
        destination_name: 'test-dest',
        data: { name: 'Test Destination' },
        module: 'alerts'
      };

      destination.create(params);

      expect(mockPost).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations?module=alerts',
        params.data
      );
    });

    it('does not include module parameter when not provided', () => {
      const params = {
        org_identifier: 'test-org',
        destination_name: 'test-dest',
        data: { name: 'Test Destination' }
      };

      destination.create(params);

      expect(mockPost).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations',
        params.data
      );
    });
  });

  describe('update', () => {
    it('calls PUT with correct URL and data', () => {
      const params = {
        org_identifier: 'test-org',
        destination_name: 'test-dest',
        data: { name: 'Updated Destination' }
      };

      destination.update(params);

      expect(mockPut).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations/test-dest',
        params.data
      );
    });

    it('URL encodes destination name', () => {
      const params = {
        org_identifier: 'test-org',
        destination_name: 'test dest with spaces',
        data: { name: 'Updated' }
      };

      destination.update(params);

      expect(mockPut).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations/test%20dest%20with%20spaces',
        params.data
      );
    });

    it('includes module parameter in URL when provided', () => {
      const params = {
        org_identifier: 'test-org',
        destination_name: 'test-dest',
        data: { name: 'Updated' },
        module: 'alerts'
      };

      destination.update(params);

      expect(mockPut).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations/test-dest?module=alerts',
        params.data
      );
    });
  });

  describe('list', () => {
    it('calls GET with correct URL and query parameters', () => {
      const params = {
        org_identifier: 'test-org',
        page_num: 1,
        page_size: 10,
        desc: true,
        sort_by: 'name'
      };

      destination.list(params);

      expect(mockGet).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations?page_num=1&page_size=10&sort_by=name&desc=true'
      );
    });

    it('includes module parameter when provided', () => {
      const params = {
        org_identifier: 'test-org',
        page_num: 1,
        page_size: 10,
        desc: false,
        sort_by: 'created_at',
        module: 'alerts'
      };

      destination.list(params);

      expect(mockGet).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations?page_num=1&page_size=10&sort_by=created_at&desc=false&module=alerts'
      );
    });

    it('does not include module parameter when not provided', () => {
      const params = {
        org_identifier: 'test-org',
        page_num: 0,
        page_size: 25,
        desc: true,
        sort_by: 'updated_at'
      };

      destination.list(params);

      expect(mockGet).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations?page_num=0&page_size=25&sort_by=updated_at&desc=true'
      );
    });
  });

  describe('get_by_name', () => {
    it('calls GET with correct URL', () => {
      const params = {
        org_identifier: 'test-org',
        destination_name: 'test-dest'
      };

      destination.get_by_name(params);

      expect(mockGet).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations/test-dest'
      );
    });

    it('URL encodes destination name', () => {
      const params = {
        org_identifier: 'test-org',
        destination_name: 'dest/with/slashes'
      };

      destination.get_by_name(params);

      expect(mockGet).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations/dest%2Fwith%2Fslashes'
      );
    });

    it('handles special characters in destination name', () => {
      const params = {
        org_identifier: 'test-org',
        destination_name: 'dest@#$%'
      };

      destination.get_by_name(params);

      expect(mockGet).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations/dest%40%23%24%25'
      );
    });
  });

  describe('delete', () => {
    it('calls DELETE with correct URL', () => {
      const params = {
        org_identifier: 'test-org',
        destination_name: 'test-dest'
      };

      destination.delete(params);

      expect(mockDelete).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations/test-dest'
      );
    });

    it('URL encodes destination name', () => {
      const params = {
        org_identifier: 'test-org',
        destination_name: 'dest with spaces'
      };

      destination.delete(params);

      expect(mockDelete).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations/dest%20with%20spaces'
      );
    });
  });

  describe('bulkDelete', () => {
    it('calls DELETE with correct URL and data', () => {
      const orgId = 'test-org';
      const data = {
        names: ['dest1', 'dest2', 'dest3']
      };

      destination.bulkDelete(orgId, data);

      expect(mockDelete).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations/bulk',
        { data }
      );
    });

    it('handles empty array of destinations', () => {
      const orgId = 'test-org';
      const data = { names: [] };

      destination.bulkDelete(orgId, data);

      expect(mockDelete).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations/bulk',
        { data }
      );
    });
  });

  describe('test', () => {
    it('calls POST with correct URL and data', () => {
      const params = {
        org_identifier: 'test-org',
        data: {
          name: 'test-dest',
          type: 'http',
          url: 'https://example.com/webhook'
        }
      };

      destination.test(params);

      expect(mockPost).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations/test',
        params.data
      );
    });

    it('handles complex destination configuration', () => {
      const params = {
        org_identifier: 'test-org',
        data: {
          name: 'slack-dest',
          type: 'http',
          url: 'https://hooks.slack.com/services/xxx',
          method: 'post',
          headers: {
            'Content-Type': 'application/json'
          },
          template: '{"text": "Alert fired"}'
        }
      };

      destination.test(params);

      expect(mockPost).toHaveBeenCalledWith(
        '/api/test-org/alerts/destinations/test',
        params.data
      );
    });
  });
});
