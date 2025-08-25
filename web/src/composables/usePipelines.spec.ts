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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePipelines } from './usePipelines';
import pipelines from '@/services/pipelines';
import destinationService from '@/services/alert_destination';
import { useStore } from 'vuex';
import { useQuasar } from 'quasar';

// Mock the services
vi.mock('@/services/pipelines');
vi.mock('@/services/alert_destination');
vi.mock('quasar');
vi.mock('vuex');

describe('usePipelines', () => {
  let mockNotify: any;
  let mockPipelinesService: any;
  let mockDestinationService: any;
  let mockStore: any;

  beforeEach(() => {
    mockNotify = vi.fn();
    mockStore = {
      state: {
        selectedOrganization: {
          identifier: 'test-org',
          label: 'Test Organization'
        }
      }
    };
    
    // Mock the store
    vi.mocked(useStore).mockReturnValue(mockStore);
    
    // Mock quasar notify
    vi.mocked(useQuasar).mockReturnValue({
      notify: mockNotify
    });

    // Mock the services
    mockPipelinesService = vi.mocked(pipelines);
    mockDestinationService = vi.mocked(destinationService);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Composable initialization
  it('should initialize composable correctly', () => {
    const { getUsedStreamsList, getPipelineDestinations } = usePipelines();
    
    expect(getUsedStreamsList).toBeDefined();
    expect(getPipelineDestinations).toBeDefined();
    expect(typeof getUsedStreamsList).toBe('function');
    expect(typeof getPipelineDestinations).toBe('function');
  });

  // Test 2: getUsedStreamsList - successful response
  it('should fetch used streams list successfully', async () => {
    const mockResponse = {
      data: {
        list: ['stream1', 'stream2', 'stream3']
      }
    };
    
    mockPipelinesService.getPipelineStreams.mockResolvedValue(mockResponse);
    
    const { getUsedStreamsList } = usePipelines();
    const result = await getUsedStreamsList();
    
    expect(result).toEqual(['stream1', 'stream2', 'stream3']);
    expect(mockPipelinesService.getPipelineStreams).toHaveBeenCalledWith('test-org');
    expect(mockPipelinesService.getPipelineStreams).toHaveBeenCalledTimes(1);
  });

  // Test 3: getUsedStreamsList - empty list response
  it('should handle empty used streams list', async () => {
    const mockResponse = {
      data: {
        list: []
      }
    };
    
    mockPipelinesService.getPipelineStreams.mockResolvedValue(mockResponse);
    
    const { getUsedStreamsList } = usePipelines();
    const result = await getUsedStreamsList();
    
    expect(result).toEqual([]);
    expect(mockPipelinesService.getPipelineStreams).toHaveBeenCalledWith('test-org');
  });

  // Test 4: getUsedStreamsList - error handling with 403 status
  it('should handle 403 error without notification', async () => {
    const mockError = {
      response: {
        status: 403,
        data: {
          message: 'Forbidden'
        }
      }
    };
    
    mockPipelinesService.getPipelineStreams.mockRejectedValue(mockError);
    
    const { getUsedStreamsList } = usePipelines();
    const result = await getUsedStreamsList();
    
    expect(result).toEqual([]);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  // Test 5: getUsedStreamsList - error handling with non-403 status
  it('should handle non-403 error with notification', async () => {
    const mockError = {
      response: {
        status: 500,
        data: {
          message: 'Internal Server Error'
        }
      }
    };
    
    mockPipelinesService.getPipelineStreams.mockRejectedValue(mockError);
    
    const { getUsedStreamsList } = usePipelines();
    const result = await getUsedStreamsList();
    
    expect(result).toEqual([]);
    expect(mockNotify).toHaveBeenCalledWith({
      message: 'Internal Server Error',
      color: 'negative',
      position: 'bottom',
      timeout: 2000,
    });
  });

  // Test 6: getUsedStreamsList - error without response message
  it('should handle error without response message', async () => {
    const mockError = {
      response: {
        status: 500,
        data: {}
      }
    };
    
    mockPipelinesService.getPipelineStreams.mockRejectedValue(mockError);
    
    const { getUsedStreamsList } = usePipelines();
    const result = await getUsedStreamsList();
    
    expect(result).toEqual([]);
    expect(mockNotify).toHaveBeenCalledWith({
      message: 'Error fetching used streams',
      color: 'negative',
      position: 'bottom',
      timeout: 2000,
    });
  });

  // Test 7: getUsedStreamsList - error without response object
  it('should handle error without response object', async () => {
    const mockError = {
      response: {
        status: 400
      }
    };
    
    mockPipelinesService.getPipelineStreams.mockRejectedValue(mockError);
    
    const { getUsedStreamsList } = usePipelines();
    const result = await getUsedStreamsList();
    
    expect(result).toEqual([]);
    expect(mockNotify).toHaveBeenCalledWith({
      message: 'Error fetching used streams',
      color: 'negative',
      position: 'bottom',
      timeout: 2000,
    });
  });

  // Test 8: getPipelineDestinations - successful response
  it('should fetch pipeline destinations successfully', async () => {
    const mockResponse = {
      data: [
        { name: 'destination1', url: 'http://dest1.com' },
        { name: 'destination2', url: 'http://dest2.com' },
        { name: 'destination3', url: 'http://dest3.com' }
      ]
    };
    
    mockDestinationService.list.mockResolvedValue(mockResponse);
    
    const { getPipelineDestinations } = usePipelines();
    const result = await getPipelineDestinations();
    
    expect(result).toEqual(['destination1', 'destination2', 'destination3']);
    expect(mockDestinationService.list).toHaveBeenCalledWith({
      page_num: 1,
      page_size: 100000,
      sort_by: 'name',
      desc: false,
      org_identifier: 'test-org',
      module: 'pipeline',
    });
  });

  // Test 9: getPipelineDestinations - empty response
  it('should handle empty pipeline destinations response', async () => {
    const mockResponse = {
      data: []
    };
    
    mockDestinationService.list.mockResolvedValue(mockResponse);
    
    const { getPipelineDestinations } = usePipelines();
    const result = await getPipelineDestinations();
    
    expect(result).toEqual([]);
    expect(mockDestinationService.list).toHaveBeenCalledWith({
      page_num: 1,
      page_size: 100000,
      sort_by: 'name',
      desc: false,
      org_identifier: 'test-org',
      module: 'pipeline',
    });
  });

  // Test 10: getPipelineDestinations - single destination
  it('should handle single pipeline destination', async () => {
    const mockResponse = {
      data: [
        { name: 'single-destination', url: 'http://single.com' }
      ]
    };
    
    mockDestinationService.list.mockResolvedValue(mockResponse);
    
    const { getPipelineDestinations } = usePipelines();
    const result = await getPipelineDestinations();
    
    expect(result).toEqual(['single-destination']);
    expect(result.length).toBe(1);
  });

  // Test 11: Organization identifier usage
  it('should use correct organization identifier from store', async () => {
    const customStore = {
      state: {
        selectedOrganization: {
          identifier: 'custom-org-123',
          label: 'Custom Organization'
        }
      }
    };

    vi.mocked(useStore).mockReturnValue(customStore);
    
    const mockResponse = { data: { list: [] } };
    mockPipelinesService.getPipelineStreams.mockResolvedValue(mockResponse);
    
    const { getUsedStreamsList } = usePipelines();
    await getUsedStreamsList();
    
    expect(mockPipelinesService.getPipelineStreams).toHaveBeenCalledWith('custom-org-123');
  });

  // Test 12: Organization identifier usage for destinations
  it('should use correct organization identifier for destinations', async () => {
    const customStore = {
      state: {
        selectedOrganization: {
          identifier: 'custom-org-456',
          label: 'Custom Organization'
        }
      }
    };

    vi.mocked(useStore).mockReturnValue(customStore);
    
    const mockResponse = { data: [] };
    mockDestinationService.list.mockResolvedValue(mockResponse);
    
    const { getPipelineDestinations } = usePipelines();
    await getPipelineDestinations();
    
    expect(mockDestinationService.list).toHaveBeenCalledWith({
      page_num: 1,
      page_size: 100000,
      sort_by: 'name',
      desc: false,
      org_identifier: 'custom-org-456',
      module: 'pipeline',
    });
  });

  // Test 13: Quasar notification parameters
  it('should call notification with correct parameters', async () => {
    const mockError = {
      response: {
        status: 400,
        data: {
          message: 'Bad Request Error'
        }
      }
    };
    
    mockPipelinesService.getPipelineStreams.mockRejectedValue(mockError);
    
    const { getUsedStreamsList } = usePipelines();
    await getUsedStreamsList();
    
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith({
      message: 'Bad Request Error',
      color: 'negative',
      position: 'bottom',
      timeout: 2000,
    });
  });

  // Test 14: getPipelineDestinations - mapping function test
  it('should correctly map destination objects to names', async () => {
    const mockResponse = {
      data: [
        { name: 'webhook1', type: 'webhook', url: 'http://webhook1.com' },
        { name: 'email-dest', type: 'email', recipients: ['test@example.com'] },
        { name: 'slack-dest', type: 'slack', channel: '#alerts' }
      ]
    };
    
    mockDestinationService.list.mockResolvedValue(mockResponse);
    
    const { getPipelineDestinations } = usePipelines();
    const result = await getPipelineDestinations();
    
    expect(result).toEqual(['webhook1', 'email-dest', 'slack-dest']);
    expect(result.every(item => typeof item === 'string')).toBe(true);
  });

  // Test 15: Return value structure validation
  it('should return object with correct function names', () => {
    const result = usePipelines();
    
    expect(result).toHaveProperty('getUsedStreamsList');
    expect(result).toHaveProperty('getPipelineDestinations');
    expect(Object.keys(result)).toEqual(['getUsedStreamsList', 'getPipelineDestinations']);
  });

  // Test 16: Async function behavior
  it('should handle async operations correctly', async () => {
    const mockStreamResponse = { data: { list: ['async-stream'] } };
    const mockDestResponse = { data: [{ name: 'async-dest' }] };
    
    mockPipelinesService.getPipelineStreams.mockResolvedValue(mockStreamResponse);
    mockDestinationService.list.mockResolvedValue(mockDestResponse);
    
    const { getUsedStreamsList, getPipelineDestinations } = usePipelines();
    
    const [streams, destinations] = await Promise.all([
      getUsedStreamsList(),
      getPipelineDestinations()
    ]);
    
    expect(streams).toEqual(['async-stream']);
    expect(destinations).toEqual(['async-dest']);
  });

  // Test 17: Error boundary testing
  it('should handle network errors gracefully', async () => {
    const networkError = new Error('Network Error');
    networkError.response = {
      status: 0,
      data: { message: 'Network failure' }
    };
    
    mockPipelinesService.getPipelineStreams.mockRejectedValue(networkError);
    
    const { getUsedStreamsList } = usePipelines();
    const result = await getUsedStreamsList();
    
    expect(result).toEqual([]);
  });

  // Test 18: Service method call verification
  it('should call pipeline service with exact parameters', async () => {
    const mockResponse = { data: { list: [] } };
    mockPipelinesService.getPipelineStreams.mockResolvedValue(mockResponse);
    
    const { getUsedStreamsList } = usePipelines();
    await getUsedStreamsList();
    
    expect(mockPipelinesService.getPipelineStreams).toHaveBeenCalledWith('test-org');
    expect(mockPipelinesService.getPipelineStreams).toHaveBeenCalledTimes(1);
  });

  // Test 19: Destination service parameters validation
  it('should call destination service with exact parameters', async () => {
    const mockResponse = { data: [] };
    mockDestinationService.list.mockResolvedValue(mockResponse);
    
    const { getPipelineDestinations } = usePipelines();
    await getPipelineDestinations();
    
    const expectedParams = {
      page_num: 1,
      page_size: 100000,
      sort_by: 'name',
      desc: false,
      org_identifier: 'test-org',
      module: 'pipeline',
    };
    
    expect(mockDestinationService.list).toHaveBeenCalledWith(expectedParams);
    expect(mockDestinationService.list).toHaveBeenCalledTimes(1);
  });

  // Test 20: Multiple function calls isolation
  it('should handle multiple function calls independently', async () => {
    const streamResponse = { data: { list: ['stream1'] } };
    const destResponse = { data: [{ name: 'dest1' }] };
    
    mockPipelinesService.getPipelineStreams.mockResolvedValue(streamResponse);
    mockDestinationService.list.mockResolvedValue(destResponse);
    
    const { getUsedStreamsList, getPipelineDestinations } = usePipelines();
    
    const streams1 = await getUsedStreamsList();
    const dest1 = await getPipelineDestinations();
    const streams2 = await getUsedStreamsList();
    
    expect(streams1).toEqual(['stream1']);
    expect(dest1).toEqual(['dest1']);
    expect(streams2).toEqual(['stream1']);
    expect(mockPipelinesService.getPipelineStreams).toHaveBeenCalledTimes(2);
    expect(mockDestinationService.list).toHaveBeenCalledTimes(1);
  });

  // Test 21: Type safety validation
  it('should handle non-standard response structures', async () => {
    const mockResponse = {
      data: [
        { name: 123 }, // Non-string name
        { name: null }, // Null name
        { name: undefined }, // Undefined name
        { name: 'valid-name' }, // Valid name
        {} // Missing name property
      ]
    };
    
    mockDestinationService.list.mockResolvedValue(mockResponse);
    
    const { getPipelineDestinations } = usePipelines();
    const result = await getPipelineDestinations();
    
    // Should include all mapped values, even non-string ones
    expect(result).toEqual([123, null, undefined, 'valid-name', undefined]);
    expect(result.length).toBe(5);
  });

  // Test 22: Error status code boundary testing
  it('should handle exactly 403 status code correctly', async () => {
    const mockError = {
      response: {
        status: 403,
        data: {
          message: 'Forbidden access'
        }
      }
    };
    
    mockPipelinesService.getPipelineStreams.mockRejectedValue(mockError);
    
    const { getUsedStreamsList } = usePipelines();
    const result = await getUsedStreamsList();
    
    expect(result).toEqual([]);
    expect(mockNotify).not.toHaveBeenCalled();
    
    // Test 402 (should trigger notification)
    mockError.response.status = 402;
    mockPipelinesService.getPipelineStreams.mockRejectedValue(mockError);
    
    await getUsedStreamsList();
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  // Test 23: Composable reusability
  it('should create independent instances', () => {
    const instance1 = usePipelines();
    const instance2 = usePipelines();
    
    expect(instance1).not.toBe(instance2);
    expect(instance1.getUsedStreamsList).not.toBe(instance2.getUsedStreamsList);
    expect(instance1.getPipelineDestinations).not.toBe(instance2.getPipelineDestinations);
  });

  // Test 24: Store integration validation
  it('should access store state correctly', async () => {
    const { getUsedStreamsList } = usePipelines();
    
    expect(useStore).toHaveBeenCalled();
    
    const mockResponse = { data: { list: [] } };
    mockPipelinesService.getPipelineStreams.mockResolvedValue(mockResponse);
    
    await getUsedStreamsList();
    
    expect(mockPipelinesService.getPipelineStreams).toHaveBeenCalledWith('test-org');
  });

  // Test 25: Complete error response structure test
  it('should handle complete error response structure', async () => {
    const completeError = {
      response: {
        status: 422,
        statusText: 'Unprocessable Entity',
        data: {
          message: 'Validation failed',
          errors: ['Field is required']
        },
        headers: {
          'content-type': 'application/json'
        }
      }
    };
    
    mockPipelinesService.getPipelineStreams.mockRejectedValue(completeError);
    
    const { getUsedStreamsList } = usePipelines();
    const result = await getUsedStreamsList();
    
    expect(result).toEqual([]);
    expect(mockNotify).toHaveBeenCalledWith({
      message: 'Validation failed',
      color: 'negative',
      position: 'bottom',
      timeout: 2000,
    });
  });
});