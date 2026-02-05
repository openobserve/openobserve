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
import licenseServer from './license_server';
import http from './http';

vi.mock('./http', () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn()
  }))
}));

describe('license_server service', () => {
  let mockHttp: any;

  beforeEach(() => {
    mockHttp = {
      get: vi.fn().mockResolvedValue({ data: { license: 'test-license' } }),
      post: vi.fn().mockResolvedValue({ data: { success: true } })
    };
    (http as any).mockReturnValue(mockHttp);
  });

  describe('get_license', () => {
    it('should get license from API', async () => {
      await licenseServer.get_license();

      expect(mockHttp.get).toHaveBeenCalledWith('/api/license');
    });
  });

  describe('update_license', () => {
    it('should update license via API', async () => {
      const licenseKey = 'new-license-key-12345';

      await licenseServer.update_license(licenseKey);

      expect(mockHttp.post).toHaveBeenCalledWith('/api/license', { key: licenseKey });
    });
  });
});
