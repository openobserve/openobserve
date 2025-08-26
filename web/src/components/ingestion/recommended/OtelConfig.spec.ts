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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import { installQuasar } from '@/test/unit/helpers'
import { Quasar } from 'quasar'
import store from '@/test/unit/helpers/store'
import OtelConfig from './OtelConfig.vue'

installQuasar()

// Mock the zincutils functions
vi.mock('@/utils/zincutils', () => ({
  getIngestionURL: vi.fn(),
  getEndPoint: vi.fn(),
  b64EncodeStandard: vi.fn(),
}))

// Mock ContentCopy component
vi.mock('@/components/CopyContent.vue', () => ({
  default: {
    name: 'ContentCopy',
    template: '<div class="content-copy-mock" :data-content="content">{{content}}</div>',
    props: ['content'],
  }
}))

// Import the actual module to get the mocked functions
import * as zincutils from '@/utils/zincutils'
const mockGetIngestionURL = vi.mocked(zincutils.getIngestionURL)
const mockGetEndPoint = vi.mocked(zincutils.getEndPoint)  
const mockB64EncodeStandard = vi.mocked(zincutils.b64EncodeStandard)

describe('OtelConfig.vue', () => {
  let wrapper: VueWrapper<any>
  
  const defaultProps = {
    currOrgIdentifier: 'test-org',
    currUserEmail: 'test@example.com'
  }

  const mockEndpoint = {
    url: 'https://localhost:5080',
    host: 'localhost',
    port: '5080',
    protocol: 'https',
    tls: 'On'
  }

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()
    
    // Reset store state
    store.state.organizationData.organizationPasscode = ''
    
    // Setup default mock returns
    mockGetIngestionURL.mockReturnValue('https://localhost:5080')
    mockGetEndPoint.mockReturnValue(mockEndpoint)
    mockB64EncodeStandard.mockReturnValue('dGVzdEBleGFtcGxlLmNvbTpwYXNzY29kZQ==')
  })

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount()
    }
  })

  const createWrapper = (props = {}) => {
    return mount(OtelConfig, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [
          [Quasar, {}],
          [store]
        ],
        provide: {
          store: store
        }
      }
    })
  }

  describe('Component Initialization', () => {
    it('should mount successfully', () => {
      wrapper = createWrapper()
      expect(wrapper.exists()).toBe(true)
    })

    it('should render OTLP HTTP and gRPC sections', () => {
      wrapper = createWrapper()
      
      const subtitleElements = wrapper.findAll('.text-subtitle1')
      expect(subtitleElements.length).toBeGreaterThanOrEqual(2)
      
      // Check that OTLP sections exist in the rendered content
      const html = wrapper.html()
      expect(html).toContain('OTLP HTTP')
      expect(html).toContain('OTLP gRPC')
    })

    it('should render ContentCopy components', () => {
      wrapper = createWrapper()
      
      const contentCopyComponents = wrapper.findAllComponents({ name: 'ContentCopy' })
      expect(contentCopyComponents).toHaveLength(2)
    })
  })

  describe('Props Handling', () => {
    it('should accept currOrgIdentifier prop', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'custom-org' })
      expect(wrapper.props().currOrgIdentifier).toBe('custom-org')
    })

    it('should accept currUserEmail prop', () => {
      wrapper = createWrapper({ currUserEmail: 'custom@example.com' })
      expect(wrapper.props().currUserEmail).toBe('custom@example.com')
    })

    it('should handle undefined props gracefully', () => {
      wrapper = createWrapper({ 
        currOrgIdentifier: undefined, 
        currUserEmail: undefined 
      })
      expect(wrapper.props().currOrgIdentifier).toBeUndefined()
      expect(wrapper.props().currUserEmail).toBeUndefined()
    })

    it('should handle empty string props', () => {
      wrapper = createWrapper({ 
        currOrgIdentifier: '', 
        currUserEmail: '' 
      })
      expect(wrapper.props().currOrgIdentifier).toBe('')
      expect(wrapper.props().currUserEmail).toBe('')
    })
  })

  describe('Store Integration', () => {
    it('should access Vuex store correctly', () => {
      wrapper = createWrapper()
      const vm = wrapper.vm
      
      expect(vm.store).toBeDefined()
      expect(vm.store.state).toBeDefined()
      expect(vm.store.state.organizationData).toBeDefined()
    })

    it('should use organization passcode from store', () => {
      store.state.organizationData.organizationPasscode = 'test-passcode'
      wrapper = createWrapper()
      
      // Access the computed property to trigger the function call
      const vm = wrapper.vm
      const accessKey = vm.accessKey
      
      // Verify that b64EncodeStandard is called with correct parameters
      expect(mockB64EncodeStandard).toHaveBeenCalledWith(
        'test@example.com:test-passcode'
      )
    })
  })

  describe('Utility Functions Integration', () => {
    it('should call getIngestionURL on mount', () => {
      wrapper = createWrapper()
      expect(mockGetIngestionURL).toHaveBeenCalled()
    })

    it('should call getEndPoint with ingestion URL', () => {
      wrapper = createWrapper()
      expect(mockGetEndPoint).toHaveBeenCalledWith('https://localhost:5080')
    })

    it('should handle different ingestion URLs', () => {
      mockGetIngestionURL.mockReturnValue('https://api.openobserve.ai')
      mockGetEndPoint.mockReturnValue({
        url: 'https://api.openobserve.ai',
        host: 'api.openobserve.ai',
        port: '443',
        protocol: 'https',
        tls: 'On'
      })
      
      wrapper = createWrapper()
      expect(mockGetEndPoint).toHaveBeenCalledWith('https://api.openobserve.ai')
    })
  })

  describe('Endpoint Reference', () => {
    it('should initialize endpoint ref with default values', () => {
      wrapper = createWrapper()
      const vm = wrapper.vm
      
      expect(vm.endpoint).toBeDefined()
      expect(vm.endpoint.url).toBe(mockEndpoint.url)
      expect(vm.endpoint.host).toBe(mockEndpoint.host)
      expect(vm.endpoint.port).toBe(mockEndpoint.port)
      expect(vm.endpoint.protocol).toBe(mockEndpoint.protocol)
      expect(vm.endpoint.tls).toBe(mockEndpoint.tls)
    })

    it('should update endpoint when getEndPoint returns different values', () => {
      const customEndpoint = {
        url: 'http://custom:8080',
        host: 'custom',
        port: '8080',
        protocol: 'http',
        tls: 'Off'
      }
      
      mockGetEndPoint.mockReturnValue(customEndpoint)
      wrapper = createWrapper()
      const vm = wrapper.vm
      
      expect(vm.endpoint.host).toBe('custom')
      expect(vm.endpoint.port).toBe('8080')
      expect(vm.endpoint.protocol).toBe('http')
    })
  })

  describe('Access Key Computed Property', () => {
    it('should compute access key correctly', () => {
      store.state.organizationData.organizationPasscode = 'test-passcode'
      wrapper = createWrapper()
      const vm = wrapper.vm
      
      expect(vm.accessKey).toBe('dGVzdEBleGFtcGxlLmNvbTpwYXNzY29kZQ==')
    })

    it('should update when user email changes', async () => {
      // Ensure passcode is empty for this test
      store.state.organizationData.organizationPasscode = ''
      wrapper = createWrapper({ currUserEmail: 'new-user@example.com' })
      
      // Access the computed property to trigger the function call
      const vm = wrapper.vm
      const accessKey = vm.accessKey
      
      expect(mockB64EncodeStandard).toHaveBeenCalledWith(
        'new-user@example.com:'
      )
    })

    it('should update when organization passcode changes', async () => {
      wrapper = createWrapper()
      
      // Clear previous mock calls
      mockB64EncodeStandard.mockClear()
      
      // Change store state
      store.state.organizationData.organizationPasscode = 'new-passcode'
      await wrapper.vm.$nextTick()
      
      // Access the computed property to trigger recalculation
      const vm = wrapper.vm
      const accessKey = vm.accessKey
      
      // Verify that b64EncodeStandard is called with the updated passcode
      expect(mockB64EncodeStandard).toHaveBeenCalledWith(
        'test@example.com:new-passcode'
      )
    })

    it('should handle empty passcode', () => {
      store.state.organizationData.organizationPasscode = ''
      wrapper = createWrapper()
      
      // Access the computed property to trigger the function call
      const vm = wrapper.vm
      const accessKey = vm.accessKey
      
      expect(mockB64EncodeStandard).toHaveBeenCalledWith('test@example.com:')
    })
  })

  describe('OTLP gRPC Configuration', () => {
    it('should generate correct gRPC config format', () => {
      store.state.organizationData.organizationPasscode = 'test-pass'
      wrapper = createWrapper({ currOrgIdentifier: 'my-org' })
      const vm = wrapper.vm
      
      const expectedConfig = `exporters:
  otlp/openobserve:
      endpoint: ${mockEndpoint.host}:5081
      headers:
        Authorization: "Basic [BASIC_PASSCODE]"
        organization: my-org
        stream-name: default
      tls:
        insecure: true`
      
      expect(vm.getOtelGrpcConfig).toBe(expectedConfig)
    })

    it('should use correct endpoint host for gRPC', () => {
      mockGetEndPoint.mockReturnValue({
        ...mockEndpoint,
        host: 'grpc-host.example.com'
      })
      
      wrapper = createWrapper()
      const vm = wrapper.vm
      
      expect(vm.getOtelGrpcConfig).toContain('grpc-host.example.com:5081')
    })

    it('should include organization identifier in gRPC config', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'test-organization' })
      const vm = wrapper.vm
      
      expect(vm.getOtelGrpcConfig).toContain('organization: test-organization')
    })

    it('should always use port 5081 for gRPC', () => {
      wrapper = createWrapper()
      const vm = wrapper.vm
      
      expect(vm.getOtelGrpcConfig).toContain(':5081')
    })

    it('should always set tls insecure to true', () => {
      wrapper = createWrapper()
      const vm = wrapper.vm
      
      expect(vm.getOtelGrpcConfig).toContain('insecure: true')
    })

    it('should use default stream-name', () => {
      wrapper = createWrapper()
      const vm = wrapper.vm
      
      expect(vm.getOtelGrpcConfig).toContain('stream-name: default')
    })
  })

  describe('OTLP HTTP Configuration', () => {
    it('should generate correct HTTP config format', () => {
      store.state.organizationData.organizationPasscode = 'test-pass'
      wrapper = createWrapper({ currOrgIdentifier: 'my-org' })
      const vm = wrapper.vm
      
      const expectedConfig = `exporters:
  otlphttp/openobserve:
    endpoint: ${mockEndpoint.url}/api/my-org
    headers:
      Authorization: Basic [BASIC_PASSCODE]
      stream-name: default`
      
      expect(vm.getOtelHttpConfig).toBe(expectedConfig)
    })

    it('should use full endpoint URL for HTTP', () => {
      mockGetEndPoint.mockReturnValue({
        ...mockEndpoint,
        url: 'https://api.example.com:8080'
      })
      
      wrapper = createWrapper({ currOrgIdentifier: 'test-org' })
      const vm = wrapper.vm
      
      expect(vm.getOtelHttpConfig).toContain('https://api.example.com:8080/api/test-org')
    })

    it('should include organization identifier in HTTP endpoint', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'http-org' })
      const vm = wrapper.vm
      
      expect(vm.getOtelHttpConfig).toContain('/api/http-org')
    })

    it('should use Basic auth format for HTTP (without quotes)', () => {
      wrapper = createWrapper()
      const vm = wrapper.vm
      
      expect(vm.getOtelHttpConfig).toContain('Authorization: Basic [BASIC_PASSCODE]')
      expect(vm.getOtelHttpConfig).not.toContain('"Basic [BASIC_PASSCODE]"')
    })

    it('should use default stream-name for HTTP', () => {
      wrapper = createWrapper()
      const vm = wrapper.vm
      
      expect(vm.getOtelHttpConfig).toContain('stream-name: default')
    })
  })

  describe('Content Copy Integration', () => {
    it('should pass HTTP config to first ContentCopy component', () => {
      wrapper = createWrapper()
      const contentCopyComponents = wrapper.findAllComponents({ name: 'ContentCopy' })
      
      const httpContentCopy = contentCopyComponents[0]
      expect(httpContentCopy.props().content).toContain('otlphttp/openobserve')
    })

    it('should pass gRPC config to second ContentCopy component', () => {
      wrapper = createWrapper()
      const contentCopyComponents = wrapper.findAllComponents({ name: 'ContentCopy' })
      
      const grpcContentCopy = contentCopyComponents[1]
      expect(grpcContentCopy.props().content).toContain('otlp/openobserve')
    })
  })

  describe('Reactive Updates', () => {
    it('should update configs when organization identifier changes', async () => {
      wrapper = createWrapper({ currOrgIdentifier: 'initial-org' })
      
      await wrapper.setProps({ currOrgIdentifier: 'updated-org' })
      const vm = wrapper.vm
      
      expect(vm.getOtelHttpConfig).toContain('/api/updated-org')
      expect(vm.getOtelGrpcConfig).toContain('organization: updated-org')
    })

    it('should update access key when user email changes', async () => {
      // Ensure passcode is empty for this test
      store.state.organizationData.organizationPasscode = ''
      wrapper = createWrapper({ currUserEmail: 'initial@example.com' })
      
      await wrapper.setProps({ currUserEmail: 'updated@example.com' })
      
      // Access the computed property to trigger the function call
      const vm = wrapper.vm
      const accessKey = vm.accessKey
      
      expect(mockB64EncodeStandard).toHaveBeenCalledWith('updated@example.com:')
    })
  })

  describe('Edge Cases', () => {
    it('should handle null organization identifier', () => {
      wrapper = createWrapper({ currOrgIdentifier: null })
      const vm = wrapper.vm
      
      expect(vm.getOtelHttpConfig).toContain('/api/null')
      expect(vm.getOtelGrpcConfig).toContain('organization: null')
    })

    it('should handle null user email', () => {
      // Ensure passcode is empty for this test
      store.state.organizationData.organizationPasscode = ''
      wrapper = createWrapper({ currUserEmail: null })
      
      // Access the computed property to trigger the function call
      const vm = wrapper.vm
      const accessKey = vm.accessKey
      
      expect(mockB64EncodeStandard).toHaveBeenCalledWith('null:')
    })

    it('should handle special characters in organization identifier', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'org-with-special@chars#123' })
      const vm = wrapper.vm
      
      expect(vm.getOtelHttpConfig).toContain('/api/org-with-special@chars#123')
      expect(vm.getOtelGrpcConfig).toContain('organization: org-with-special@chars#123')
    })

    it('should handle special characters in user email', () => {
      // Ensure passcode is empty for this test
      store.state.organizationData.organizationPasscode = ''
      wrapper = createWrapper({ currUserEmail: 'user+test@example-domain.com' })
      
      // Access the computed property to trigger the function call
      const vm = wrapper.vm
      const accessKey = vm.accessKey
      
      expect(mockB64EncodeStandard).toHaveBeenCalledWith('user+test@example-domain.com:')
    })
  })

  describe('Component Cleanup', () => {
    it('should unmount cleanly without errors', () => {
      wrapper = createWrapper()
      
      expect(() => wrapper.unmount()).not.toThrow()
    })
  })

  describe('defineExpose Integration', () => {
    it('should expose endpoint ref', () => {
      wrapper = createWrapper()
      const exposedData = wrapper.vm
      
      expect(exposedData.endpoint).toBeDefined()
      expect(exposedData.endpoint.url).toBe(mockEndpoint.url)
    })

    it('should expose ingestionURL', () => {
      wrapper = createWrapper()
      const exposedData = wrapper.vm
      
      expect(exposedData.ingestionURL).toBe('https://localhost:5080')
    })

    it('should expose accessKey computed', () => {
      wrapper = createWrapper()
      const exposedData = wrapper.vm
      
      expect(exposedData.accessKey).toBe('dGVzdEBleGFtcGxlLmNvbTpwYXNzY29kZQ==')
    })

    it('should expose getOtelGrpcConfig computed', () => {
      wrapper = createWrapper()
      const exposedData = wrapper.vm
      
      expect(exposedData.getOtelGrpcConfig).toBeDefined()
      expect(typeof exposedData.getOtelGrpcConfig).toBe('string')
      expect(exposedData.getOtelGrpcConfig).toContain('otlp/openobserve')
    })

    it('should expose getOtelHttpConfig computed', () => {
      wrapper = createWrapper()
      const exposedData = wrapper.vm
      
      expect(exposedData.getOtelHttpConfig).toBeDefined()
      expect(typeof exposedData.getOtelHttpConfig).toBe('string')
      expect(exposedData.getOtelHttpConfig).toContain('otlphttp/openobserve')
    })
  })
})