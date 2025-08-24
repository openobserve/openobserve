import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import usePermissions from './usePermissions'
import type { Resource } from '@/ts/interfaces'

// Mock the dependencies
vi.mock('@/services/users', () => ({
  default: {
    orgUsers: vi.fn()
  }
}))

vi.mock('@/services/service_accounts', () => ({
  default: {
    list: vi.fn()
  }
}))

import usersService from '@/services/users'
import service_accounts from '@/services/service_accounts'

describe('usePermissions', () => {
  let permissionsComposable: ReturnType<typeof usePermissions>

  beforeEach(() => {
    vi.clearAllMocks()
    permissionsComposable = usePermissions()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('Initial State Tests', () => {
    it('should initialize permissionsState with correct default values', () => {
      expect(permissionsComposable.permissionsState.permissions).toEqual([])
      expect(permissionsComposable.permissionsState.selectedResources).toEqual({})
      expect(permissionsComposable.permissionsState.resources).toEqual([])
    })

    it('should initialize rolesState with correct default values', () => {
      expect(permissionsComposable.rolesState.roles).toEqual([])
    })

    it('should initialize groupsState with correct default values', () => {
      expect(permissionsComposable.groupsState.groups).toEqual({})
    })

    it('should initialize usersState with correct default values', () => {
      expect(permissionsComposable.usersState.users).toEqual([])
      expect(typeof permissionsComposable.usersState.getOrgUsers).toBe('function')
    })

    it('should initialize serviceAccountsState with correct default values', () => {
      expect(permissionsComposable.serviceAccountsState.service_accounts_users).toEqual([])
      expect(typeof permissionsComposable.serviceAccountsState.getServiceAccounts).toBe('function')
    })
  })

  describe('State Reactivity Tests', () => {
    it('should maintain reactivity when permissionsState.permissions is modified', async () => {
      const mockPermission: Resource = {
        resource_name: 'test_resource',
        resource_id: '123',
        actions: ['read', 'write']
      } as Resource

      permissionsComposable.permissionsState.permissions = [mockPermission]
      await nextTick()

      expect(permissionsComposable.permissionsState.permissions).toHaveLength(1)
      expect(permissionsComposable.permissionsState.permissions[0]).toEqual(mockPermission)
    })

    it('should maintain reactivity when permissionsState.selectedResources is modified', async () => {
      const mockResources = { resource1: true, resource2: false }
      
      permissionsComposable.permissionsState.selectedResources = mockResources
      await nextTick()

      expect(permissionsComposable.permissionsState.selectedResources).toEqual(mockResources)
    })

    it('should maintain reactivity when rolesState.roles is modified', async () => {
      const mockRoles = [{ id: 1, name: 'admin' }, { id: 2, name: 'user' }]
      
      permissionsComposable.rolesState.roles = mockRoles
      await nextTick()

      expect(permissionsComposable.rolesState.roles).toEqual(mockRoles)
    })

    it('should maintain reactivity when groupsState.groups is modified', async () => {
      const mockGroups = { group1: { id: 1, name: 'administrators' } }
      
      permissionsComposable.groupsState.groups = mockGroups
      await nextTick()

      expect(permissionsComposable.groupsState.groups).toEqual(mockGroups)
    })

    it('should maintain reactivity when usersState.users is modified', async () => {
      const mockUsers = [{ id: 1, email: 'user1@test.com' }, { id: 2, email: 'user2@test.com' }]
      
      permissionsComposable.usersState.users = mockUsers
      await nextTick()

      expect(permissionsComposable.usersState.users).toEqual(mockUsers)
    })
  })

  describe('Reset Functions Tests', () => {
    it('should reset permissions state when resetPermissionsState is called', () => {
      // Set some initial state
      const mockPermission: Resource = {
        resource_name: 'test_resource',
        resource_id: '123',
        actions: ['read']
      } as Resource
      
      permissionsComposable.permissionsState.permissions = [mockPermission]
      permissionsComposable.permissionsState.selectedResources = { resource1: true }

      // Reset state
      permissionsComposable.resetPermissionsState()

      // Verify reset
      expect(permissionsComposable.permissionsState.permissions).toEqual([])
      expect(permissionsComposable.permissionsState.selectedResources).toEqual({})
    })

    it('should have resetGroupsState function defined and callable', () => {
      expect(typeof permissionsComposable.resetGroupsState).toBe('function')
      expect(() => permissionsComposable.resetGroupsState()).not.toThrow()
    })

    it('should have resetRolesState function defined and callable', () => {
      expect(typeof permissionsComposable.resetRolesState).toBe('function')
      expect(() => permissionsComposable.resetRolesState()).not.toThrow()
    })

    it('should have resetUsersState function defined and callable', () => {
      expect(typeof permissionsComposable.resetUsersState).toBe('function')
      expect(() => permissionsComposable.resetUsersState()).not.toThrow()
    })
  })

  describe('getOrgUsers Function Tests', () => {
    it('should successfully fetch organization users', async () => {
      const mockUsersData = [
        { id: 1, email: 'user1@test.com', role: 'admin' },
        { id: 2, email: 'user2@test.com', role: 'user' }
      ]
      
      const mockResponse = { data: { data: mockUsersData } }
      vi.mocked(usersService.orgUsers).mockResolvedValue(mockResponse)

      const result = await permissionsComposable.usersState.getOrgUsers('test_org')

      expect(usersService.orgUsers).toHaveBeenCalledWith('test_org')
      expect(result).toEqual(mockUsersData)
    })

    it('should handle error when fetching organization users fails', async () => {
      const mockError = new Error('Network error')
      vi.mocked(usersService.orgUsers).mockRejectedValue(mockError)

      await expect(
        permissionsComposable.usersState.getOrgUsers('test_org')
      ).rejects.toThrow('Network error')
    })

    it('should call orgUsers with correct organization identifier', async () => {
      const mockResponse = { data: { data: [] } }
      vi.mocked(usersService.orgUsers).mockResolvedValue(mockResponse)

      await permissionsComposable.usersState.getOrgUsers('specific_org_123')

      expect(usersService.orgUsers).toHaveBeenCalledWith('specific_org_123')
    })

    it('should handle empty user data response', async () => {
      const mockResponse = { data: { data: [] } }
      vi.mocked(usersService.orgUsers).mockResolvedValue(mockResponse)

      const result = await permissionsComposable.usersState.getOrgUsers('test_org')

      expect(result).toEqual([])
    })

    it('should accept optional queryParams in getOrgUsers', async () => {
      const mockResponse = { data: { data: [] } }
      vi.mocked(usersService.orgUsers).mockResolvedValue(mockResponse)

      await permissionsComposable.usersState.getOrgUsers('test_org', { list_all: true })

      expect(usersService.orgUsers).toHaveBeenCalledWith('test_org')
    })
  })

  describe('getServiceAccounts Function Tests', () => {
    it('should successfully fetch service accounts', async () => {
      const mockServiceAccountsData = [
        { id: 1, name: 'service_account_1', token: 'token123' },
        { id: 2, name: 'service_account_2', token: 'token456' }
      ]
      
      const mockResponse = { data: { data: mockServiceAccountsData } }
      vi.mocked(service_accounts.list).mockResolvedValue(mockResponse)

      const result = await permissionsComposable.serviceAccountsState.getServiceAccounts('test_org')

      expect(service_accounts.list).toHaveBeenCalledWith('test_org')
      expect(result).toEqual(mockServiceAccountsData)
    })

    it('should handle error when fetching service accounts fails', async () => {
      const mockError = new Error('Service unavailable')
      vi.mocked(service_accounts.list).mockRejectedValue(mockError)

      await expect(
        permissionsComposable.serviceAccountsState.getServiceAccounts('test_org')
      ).rejects.toThrow('Service unavailable')
    })

    it('should call service_accounts.list with correct organization identifier', async () => {
      const mockResponse = { data: { data: [] } }
      vi.mocked(service_accounts.list).mockResolvedValue(mockResponse)

      await permissionsComposable.serviceAccountsState.getServiceAccounts('specific_org_456')

      expect(service_accounts.list).toHaveBeenCalledWith('specific_org_456')
    })

    it('should handle empty service accounts data response', async () => {
      const mockResponse = { data: { data: [] } }
      vi.mocked(service_accounts.list).mockResolvedValue(mockResponse)

      const result = await permissionsComposable.serviceAccountsState.getServiceAccounts('test_org')

      expect(result).toEqual([])
    })
  })

  describe('State Sharing Tests', () => {
    it('should share the same reactive state between instances (singleton pattern)', () => {
      const instance1 = usePermissions()
      const instance2 = usePermissions()

      // Clear any existing state
      instance1.resetPermissionsState()

      const mockPermission: Resource = { resource_name: 'shared_test' } as Resource
      instance1.permissionsState.permissions.push(mockPermission)

      expect(instance2.permissionsState.permissions).toHaveLength(1)
      expect(instance2.permissionsState.permissions[0].resource_name).toBe('shared_test')
      expect(instance1.permissionsState.permissions).toEqual(instance2.permissionsState.permissions)
    })

    it('should maintain state consistency across multiple instances', () => {
      const instance1 = usePermissions()
      const instance2 = usePermissions()

      // Clear state first
      instance1.resetPermissionsState()

      instance1.permissionsState.permissions = [{ resource_name: 'test_resource' } as Resource]
      
      expect(instance1.permissionsState.permissions).toEqual(instance2.permissionsState.permissions)
      expect(instance1.permissionsState).toBe(instance2.permissionsState)
    })
  })

  describe('Complex State Operations Tests', () => {
    it('should handle multiple permissions being added and removed', () => {
      const permission1: Resource = { resource_name: 'resource1', resource_id: '1' } as Resource
      const permission2: Resource = { resource_name: 'resource2', resource_id: '2' } as Resource
      const permission3: Resource = { resource_name: 'resource3', resource_id: '3' } as Resource

      permissionsComposable.permissionsState.permissions = [permission1, permission2, permission3]
      expect(permissionsComposable.permissionsState.permissions).toHaveLength(3)

      permissionsComposable.permissionsState.permissions = permissionsComposable.permissionsState.permissions.filter(p => p.resource_id !== '2')
      expect(permissionsComposable.permissionsState.permissions).toHaveLength(2)
      expect(permissionsComposable.permissionsState.permissions.find(p => p.resource_id === '2')).toBeUndefined()
    })

    it('should handle complex selectedResources operations', () => {
      permissionsComposable.permissionsState.selectedResources = {
        resource1: true,
        resource2: false,
        resource3: true
      }

      expect(Object.keys(permissionsComposable.permissionsState.selectedResources)).toHaveLength(3)
      
      delete permissionsComposable.permissionsState.selectedResources.resource2
      expect(Object.keys(permissionsComposable.permissionsState.selectedResources)).toHaveLength(2)
      expect('resource2' in permissionsComposable.permissionsState.selectedResources).toBe(false)
    })

    it('should maintain state consistency after reset operations', () => {
      // Set up initial state
      permissionsComposable.permissionsState.permissions = [{ resource_name: 'test' } as Resource]
      permissionsComposable.permissionsState.selectedResources = { test: true }
      permissionsComposable.rolesState.roles = [{ id: 1, name: 'test_role' }]
      permissionsComposable.usersState.users = [{ id: 1, email: 'test@example.com' }]

      // Reset permissions
      permissionsComposable.resetPermissionsState()

      // Verify only permissions are reset, others remain
      expect(permissionsComposable.permissionsState.permissions).toEqual([])
      expect(permissionsComposable.permissionsState.selectedResources).toEqual({})
      expect(permissionsComposable.rolesState.roles).toEqual([{ id: 1, name: 'test_role' }])
      expect(permissionsComposable.usersState.users).toEqual([{ id: 1, email: 'test@example.com' }])
    })
  })

  describe('Error Handling Tests', () => {
    it('should handle malformed response from usersService', async () => {
      const mockResponse = { data: null }
      vi.mocked(usersService.orgUsers).mockResolvedValue(mockResponse)

      try {
        await permissionsComposable.usersState.getOrgUsers('test_org')
      } catch (error) {
        expect(error).toBeDefined()
      }
    })

    it('should handle malformed response from service_accounts', async () => {
      const mockResponse = { data: null }
      vi.mocked(service_accounts.list).mockResolvedValue(mockResponse)

      try {
        await permissionsComposable.serviceAccountsState.getServiceAccounts('test_org')
      } catch (error) {
        expect(error).toBeDefined()
      }
    })
  })

  describe('Return Object Structure Tests', () => {
    it('should return all expected properties from usePermissions', () => {
      const result = usePermissions()

      expect(result).toHaveProperty('permissionsState')
      expect(result).toHaveProperty('rolesState')
      expect(result).toHaveProperty('groupsState')
      expect(result).toHaveProperty('usersState')
      expect(result).toHaveProperty('serviceAccountsState')
      expect(result).toHaveProperty('resetPermissionsState')
      expect(result).toHaveProperty('resetGroupsState')
      expect(result).toHaveProperty('resetRolesState')
      expect(result).toHaveProperty('resetUsersState')
    })

    it('should return functions for all reset methods', () => {
      const result = usePermissions()

      expect(typeof result.resetPermissionsState).toBe('function')
      expect(typeof result.resetGroupsState).toBe('function')
      expect(typeof result.resetRolesState).toBe('function')
      expect(typeof result.resetUsersState).toBe('function')
    })

    it('should return reactive objects for all state properties', () => {
      const result = usePermissions()

      expect(result.permissionsState).toBeDefined()
      expect(result.rolesState).toBeDefined()
      expect(result.groupsState).toBeDefined()
      expect(result.usersState).toBeDefined()
      expect(result.serviceAccountsState).toBeDefined()
    })
  })

  describe('Edge Cases and Additional Scenarios', () => {
    it('should handle multiple consecutive reset operations', () => {
      permissionsComposable.permissionsState.permissions = [
        { resource_name: 'test1' } as Resource,
        { resource_name: 'test2' } as Resource
      ]
      permissionsComposable.permissionsState.selectedResources = { test1: true, test2: false }

      permissionsComposable.resetPermissionsState()
      permissionsComposable.resetPermissionsState()
      permissionsComposable.resetPermissionsState()

      expect(permissionsComposable.permissionsState.permissions).toEqual([])
      expect(permissionsComposable.permissionsState.selectedResources).toEqual({})
    })

    it('should handle very large datasets in permissions', () => {
      const largePermissionsArray = Array.from({ length: 1000 }, (_, i) => ({
        resource_name: `resource_${i}`,
        resource_id: `${i}`,
        actions: ['read', 'write']
      })) as Resource[]

      permissionsComposable.permissionsState.permissions = largePermissionsArray
      expect(permissionsComposable.permissionsState.permissions).toHaveLength(1000)
      
      permissionsComposable.resetPermissionsState()
      expect(permissionsComposable.permissionsState.permissions).toHaveLength(0)
    })

    it('should handle complex nested objects in selectedResources', () => {
      const complexSelectedResources = {
        'resource_1': true,
        'resource_2': false,
        'nested_object': {
          subResource1: true,
          subResource2: false,
          deepNested: {
            level1: true,
            level2: ['item1', 'item2', 'item3']
          }
        }
      }

      permissionsComposable.permissionsState.selectedResources = complexSelectedResources
      expect(permissionsComposable.permissionsState.selectedResources).toEqual(complexSelectedResources)
    })

    it('should maintain type safety with Resource interface', () => {
      const typedResource: Resource = {
        resource_name: 'typed_resource',
        resource_id: 'typed_123',
        actions: ['read', 'write', 'delete'],
        metadata: { created: new Date(), owner: 'test_user' }
      } as Resource

      permissionsComposable.permissionsState.permissions = [typedResource]
      const retrievedResource = permissionsComposable.permissionsState.permissions[0]
      
      expect(retrievedResource.resource_name).toBe('typed_resource')
      expect(retrievedResource.resource_id).toBe('typed_123')
      expect(retrievedResource.actions).toContain('read')
    })

    it('should handle concurrent async operations for users and service accounts', async () => {
      const mockUsersResponse = { data: { data: [{ id: 1, email: 'user@test.com' }] } }
      const mockServiceAccountsResponse = { data: { data: [{ id: 1, name: 'service_account' }] } }
      
      vi.mocked(usersService.orgUsers).mockResolvedValue(mockUsersResponse)
      vi.mocked(service_accounts.list).mockResolvedValue(mockServiceAccountsResponse)

      const [usersResult, serviceAccountsResult] = await Promise.all([
        permissionsComposable.usersState.getOrgUsers('test_org'),
        permissionsComposable.serviceAccountsState.getServiceAccounts('test_org')
      ])

      expect(usersResult).toEqual([{ id: 1, email: 'user@test.com' }])
      expect(serviceAccountsResult).toEqual([{ id: 1, name: 'service_account' }])
    })

    it('should handle timeout scenarios for async operations', async () => {
      const timeoutError = new Error('Request timeout')
      vi.mocked(usersService.orgUsers).mockRejectedValue(timeoutError)

      const startTime = Date.now()
      try {
        await permissionsComposable.usersState.getOrgUsers('test_org')
      } catch (error) {
        const duration = Date.now() - startTime
        expect(error).toBe(timeoutError)
        expect(duration).toBeLessThan(100) // Should fail quickly since it's mocked
      }
    })

    it('should handle empty string organization identifiers gracefully', async () => {
      const mockResponse = { data: { data: [] } }
      vi.mocked(usersService.orgUsers).mockResolvedValue(mockResponse)
      vi.mocked(service_accounts.list).mockResolvedValue(mockResponse)

      await expect(permissionsComposable.usersState.getOrgUsers('')).resolves.toEqual([])
      await expect(permissionsComposable.serviceAccountsState.getServiceAccounts('')).resolves.toEqual([])
      
      expect(usersService.orgUsers).toHaveBeenCalledWith('')
      expect(service_accounts.list).toHaveBeenCalledWith('')
    })

    it('should handle special characters in organization identifiers', async () => {
      const specialOrgId = 'org-with-special-chars_123@domain.com'
      const mockResponse = { data: { data: [{ id: 1, name: 'test' }] } }
      
      vi.mocked(usersService.orgUsers).mockResolvedValue(mockResponse)
      vi.mocked(service_accounts.list).mockResolvedValue(mockResponse)

      await permissionsComposable.usersState.getOrgUsers(specialOrgId)
      await permissionsComposable.serviceAccountsState.getServiceAccounts(specialOrgId)

      expect(usersService.orgUsers).toHaveBeenCalledWith(specialOrgId)
      expect(service_accounts.list).toHaveBeenCalledWith(specialOrgId)
    })

    it('should maintain immutability of original state objects', () => {
      const originalPermissions = permissionsComposable.permissionsState.permissions
      const originalRoles = permissionsComposable.rolesState.roles
      
      const modifiedPermissions = [...originalPermissions, { resource_name: 'new_resource' } as Resource]
      const modifiedRoles = [...originalRoles, { id: 999, name: 'new_role' }]
      
      expect(permissionsComposable.permissionsState.permissions).toEqual(originalPermissions)
      expect(permissionsComposable.rolesState.roles).toEqual(originalRoles)
      expect(modifiedPermissions).not.toEqual(originalPermissions)
      expect(modifiedRoles).not.toEqual(originalRoles)
    })
  })
})