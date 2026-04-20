// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { filterDimensionsForCorrelation } from './telemetryCorrelation';
import type { ServiceIdentityConfig } from '@/services/service_streams';

describe('telemetryCorrelation', () => {
  let consoleLogSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('filterDimensionsForCorrelation', () => {
    it('should union distinguish_by fields from all identity sets', () => {
      // Test data representing a typical config with AWS, Azure, and Kubernetes sets
      const identityConfig: ServiceIdentityConfig = {
        sets: [
          {
            id: 'aws',
            label: 'AWS',
            distinguish_by: ['aws-ecs-cluster', 'availability-zone', 'faas-name']
          },
          {
            id: 'azure',
            label: 'Azure',
            distinguish_by: ['azure-resource-group', 'azure-function-name']
          },
          {
            id: 'k8s',
            label: 'Kubernetes',
            distinguish_by: ['k8s-cluster', 'k8s-namespace', 'k8s-deployment']
          }
        ],
        tracked_alias_ids: []
      };

      const allDimensions = {
        'service': 'my-service',
        'aws-ecs-cluster': 'prod-cluster',
        'availability-zone': 'us-west-2a',
        'azure-resource-group': 'my-rg',
        'k8s-cluster': 'prod-k8s',
        'k8s-namespace': 'default',
        'some-other-field': 'should-be-filtered-out'
      };

      const result = filterDimensionsForCorrelation(allDimensions, identityConfig);

      // Should include service + all distinguish_by fields from all sets
      expect(result).toEqual({
        'service': 'my-service',
        'aws-ecs-cluster': 'prod-cluster',
        'availability-zone': 'us-west-2a',
        'azure-resource-group': 'my-rg',
        'k8s-cluster': 'prod-k8s',
        'k8s-namespace': 'default'
      });

      // Should not include fields not in any distinguish_by
      expect(result).not.toHaveProperty('some-other-field');
      expect(result).not.toHaveProperty('faas-name'); // AWS field not present in input
      expect(result).not.toHaveProperty('azure-function-name'); // Azure field not present in input
      expect(result).not.toHaveProperty('k8s-deployment'); // K8s field not present in input
    });

    it('should handle duplicate fields across identity sets', () => {
      const identityConfig: ServiceIdentityConfig = {
        sets: [
          {
            id: 'aws',
            label: 'AWS',
            distinguish_by: ['region', 'service-name']
          },
          {
            id: 'gcp',
            label: 'GCP',
            distinguish_by: ['region', 'project-id'] // 'region' appears in both
          }
        ],
        tracked_alias_ids: []
      };

      const allDimensions = {
        'service': 'my-service',
        'region': 'us-west-2',
        'service-name': 'api-service',
        'project-id': 'my-gcp-project'
      };

      const result = filterDimensionsForCorrelation(allDimensions, identityConfig);

      expect(result).toEqual({
        'service': 'my-service',
        'region': 'us-west-2',
        'service-name': 'api-service',
        'project-id': 'my-gcp-project'
      });
    });

    it('should fallback to tracked_alias_ids when no sets available', () => {
      const identityConfig: ServiceIdentityConfig = {
        sets: [],
        tracked_alias_ids: ['fallback-field-1', 'fallback-field-2']
      };

      const allDimensions = {
        'service': 'my-service',
        'fallback-field-1': 'value1',
        'fallback-field-2': 'value2',
        'other-field': 'should-be-filtered'
      };

      const result = filterDimensionsForCorrelation(allDimensions, identityConfig);

      expect(result).toEqual({
        'service': 'my-service',
        'fallback-field-1': 'value1',
        'fallback-field-2': 'value2'
      });
    });

    it('should return all dimensions when no config available', () => {
      const identityConfig: ServiceIdentityConfig = {
        sets: [],
        tracked_alias_ids: []
      };

      const allDimensions = {
        'service': 'my-service',
        'field1': 'value1',
        'field2': 'value2'
      };

      const result = filterDimensionsForCorrelation(allDimensions, identityConfig);

      expect(result).toEqual(allDimensions);
    });

    it('should handle empty distinguish_by arrays gracefully', () => {
      const identityConfig: ServiceIdentityConfig = {
        sets: [
          {
            id: 'aws',
            label: 'AWS',
            distinguish_by: [] // Empty array
          },
          {
            id: 'k8s',
            label: 'Kubernetes',
            distinguish_by: ['k8s-cluster']
          }
        ],
        tracked_alias_ids: []
      };

      const allDimensions = {
        'service': 'my-service',
        'k8s-cluster': 'prod-cluster',
        'other-field': 'value'
      };

      const result = filterDimensionsForCorrelation(allDimensions, identityConfig);

      expect(result).toEqual({
        'service': 'my-service',
        'k8s-cluster': 'prod-cluster'
      });
    });

    it('should handle undefined distinguish_by gracefully', () => {
      const identityConfig: ServiceIdentityConfig = {
        sets: [
          {
            id: 'aws',
            label: 'AWS',
            distinguish_by: undefined as any // Undefined
          },
          {
            id: 'k8s',
            label: 'Kubernetes',
            distinguish_by: ['k8s-cluster']
          }
        ],
        tracked_alias_ids: []
      };

      const allDimensions = {
        'service': 'my-service',
        'k8s-cluster': 'prod-cluster',
        'other-field': 'value'
      };

      const result = filterDimensionsForCorrelation(allDimensions, identityConfig);

      expect(result).toEqual({
        'service': 'my-service',
        'k8s-cluster': 'prod-cluster'
      });
    });
  });
});