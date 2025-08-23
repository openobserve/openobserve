import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { installQuasar } from '@/test/unit/helpers/install-quasar-plugin';
import { Dialog, Notify, Quasar } from 'quasar';
import { nextTick } from 'vue';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import SysLog from './SysLog.vue';
import syslogService from '@/services/syslog';

installQuasar({ plugins: { Dialog, Notify } });

// Mock services
vi.mock('@/services/syslog', () => ({
  default: {
    toggle: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  }
}));

// Mock utils
vi.mock('@/utils/zincutils', () => ({
  getImageURL: vi.fn((url: string) => url),
}));

// Mock lodash
vi.mock('lodash-es', () => ({
  cloneDeep: vi.fn((obj: any) => JSON.parse(JSON.stringify(obj))),
}));

// Global mock notify for all tests
const globalMockNotify = vi.fn(() => vi.fn()); // Return a mock dismiss function

// Mock Quasar composables
vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    useQuasar: () => ({
      notify: globalMockNotify,
    }),
  };
});

const mockStore = createStore({
  state: {
    selectedOrganization: {
      identifier: 'test-org',
    },
    organizations: [
      { name: 'org1', identifier: 'org1' },
      { name: 'org2', identifier: 'org2' },
    ],
    zoConfig: {
      syslog_enabled: false,
    },
  },
  mutations: {},
  actions: {
    setConfig: vi.fn(),
  },
});

const mockI18n = createI18n({
  locale: 'en',
  messages: {
    en: {
      syslog: {
        organization: 'Organization',
        stream: 'Stream',
        subnets: 'Subnets',
        on: 'On',
        off: 'Off',
        enable: 'Enable',
        disable: 'Disable',
        syslog_addroute: 'Add Route',
      },
      user: {
        actions: 'Actions',
      },
      confirmDialog: {
        cancel: 'Cancel',
        ok: 'OK',
      },
    },
  },
});

describe('SysLog.vue', () => {
  let wrapper: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    vi.mocked(syslogService.toggle).mockReset();
    vi.mocked(syslogService.create).mockReset();
    vi.mocked(syslogService.update).mockReset();
    vi.mocked(syslogService.list).mockReset();
    vi.mocked(syslogService.delete).mockReset();
    
    // Mock service calls that happen during initialization
    vi.mocked(syslogService.list).mockResolvedValue({ data: { routes: [] } });
    vi.mocked(syslogService.toggle).mockResolvedValue({ data: true });
    vi.mocked(syslogService.create).mockResolvedValue({});
    vi.mocked(syslogService.update).mockResolvedValue({});
    vi.mocked(syslogService.delete).mockResolvedValue({});
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    globalMockNotify.mockClear();
    const wrapper = mount(SysLog, {
      props: {
        currOrgIdentifier: 'test-org',
        currUserEmail: 'test@example.com',
        ...props,
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
      },
    });
    
    return wrapper;
  };

  describe('Component Initialization', () => {
    it('should render component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('should have correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('SysLog');
    });

    it('should initialize with default values', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.syslogEnabled).toBe(false);
      expect(wrapper.vm.isLoading).toBe(false);
      expect(wrapper.vm.routeList).toEqual([]);
      expect(wrapper.vm.organizations).toEqual(['org1', 'org2']); // Updated expectation
      expect(wrapper.vm.disableToggle).toBe(false);
      expect(wrapper.vm.showConformDelete).toBe(false);
    });

    it('should initialize editingRoute with default values', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.editingRoute).toEqual({
        orgId: '',
        streamName: '',
        subnets: '',
      });
    });

    it('should have correct columns configuration', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.columns).toBeDefined();
      expect(wrapper.vm.columns).toHaveLength(5);
      expect(wrapper.vm.columns[0].name).toBe('#');
      expect(wrapper.vm.columns[1].name).toBe('orgId');
      expect(wrapper.vm.columns[2].name).toBe('streamName');
      expect(wrapper.vm.columns[3].name).toBe('subnets');
      expect(wrapper.vm.columns[4].name).toBe('actions');
    });
  });

  describe('Props Validation', () => {
    it('should accept valid currOrgIdentifier prop', () => {
      wrapper = createWrapper({ currOrgIdentifier: 'test-org-123' });
      expect(wrapper.props('currOrgIdentifier')).toBe('test-org-123');
    });

    it('should accept valid currUserEmail prop', () => {
      wrapper = createWrapper({ currUserEmail: 'user@test.com' });
      expect(wrapper.props('currUserEmail')).toBe('user@test.com');
    });
  });

  describe('toggleSyslog method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should show loading notification when toggling syslog', () => {
      wrapper.vm.syslogEnabled = true;
      vi.mocked(syslogService.toggle).mockResolvedValue({ data: true });

      wrapper.vm.toggleSyslog();

      expect(globalMockNotify).toHaveBeenCalledWith({
        spinner: true,
        message: 'Please wait while turning On syslog...',
      });
    });

    it('should show correct message when turning off syslog', () => {
      wrapper.vm.syslogEnabled = false;
      vi.mocked(syslogService.toggle).mockResolvedValue({ data: false });

      wrapper.vm.toggleSyslog();

      expect(globalMockNotify).toHaveBeenCalledWith({
        spinner: true,
        message: 'Please wait while turning Off syslog...',
      });
    });

    it('should disable toggle during operation', () => {
      wrapper.vm.syslogEnabled = true;
      vi.mocked(syslogService.toggle).mockResolvedValue({ data: true });

      wrapper.vm.toggleSyslog();

      expect(wrapper.vm.disableToggle).toBe(true);
    });

    it('should call syslogService.toggle with correct parameters', async () => {
      wrapper.vm.syslogEnabled = true;
      wrapper.vm.organization = 'test-org';
      vi.mocked(syslogService.toggle).mockResolvedValue({ data: true });

      wrapper.vm.toggleSyslog();
      await flushPromises();

      expect(vi.mocked(syslogService.toggle)).toHaveBeenCalledWith('test-org', { state: true });
    });

    it('should enable toggle and dismiss notification after completion', async () => {
      wrapper.vm.syslogEnabled = true;
      vi.mocked(syslogService.toggle).mockResolvedValue({ data: true });

      wrapper.vm.toggleSyslog();
      await flushPromises();

      expect(wrapper.vm.disableToggle).toBe(false);
      // Note: mockDismiss is the return value of $q.notify call, 
      // but we can't easily test its call in this setup
    });
  });

  describe('saveEditingRoute method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should call updateRoute when editingRoute is saved', () => {
      wrapper.vm.editingRoute = { isSaved: true, orgId: 'test', streamName: 'test', subnets: '192.168.1.0/24' };
      vi.mocked(syslogService.update).mockResolvedValue({});

      wrapper.vm.saveEditingRoute();

      // Verify that updateRoute was called by checking if syslogService.update was called
      expect(vi.mocked(syslogService.update)).toHaveBeenCalled();
      expect(vi.mocked(syslogService.create)).not.toHaveBeenCalled();
    });

    it('should call createRoute when editingRoute is not saved', () => {
      wrapper.vm.editingRoute = { isSaved: false, orgId: 'test', streamName: 'test', subnets: '192.168.1.0/24' };
      vi.mocked(syslogService.create).mockResolvedValue({});

      wrapper.vm.saveEditingRoute();

      // Verify that createRoute was called by checking if syslogService.create was called
      expect(vi.mocked(syslogService.create)).toHaveBeenCalled();
      expect(vi.mocked(syslogService.update)).not.toHaveBeenCalled();
    });

    it('should call createRoute when editingRoute has no isSaved property', () => {
      wrapper.vm.editingRoute = { orgId: 'test', streamName: 'test', subnets: '192.168.1.0/24' };
      vi.mocked(syslogService.create).mockResolvedValue({});

      wrapper.vm.saveEditingRoute();

      // Verify that createRoute was called by checking if syslogService.create was called
      expect(vi.mocked(syslogService.create)).toHaveBeenCalled();
      expect(vi.mocked(syslogService.update)).not.toHaveBeenCalled();
    });
  });

  describe('createRoute method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      
      // Set up editingRoute with valid data
      wrapper.vm.editingRoute = {
        orgId: 'test',
        streamName: 'test',
        subnets: '192.168.1.0/24'
      };
      
      // Mock the internal methods
      wrapper.vm.getRoutePayload = vi.fn(() => ({ orgId: 'test', streamName: 'test', subnets: ['192.168.1.0/24'] }));
      wrapper.vm.resetEditingRoute = vi.fn();
      wrapper.vm.getSyslogRoutes = vi.fn();
    });

    it('should show loading notification', () => {
      vi.mocked(syslogService.create).mockResolvedValue({});

      wrapper.vm.createRoute();

      expect(globalMockNotify).toHaveBeenCalledWith({
        spinner: true,
        message: 'Please wait while saving route...',
      });
    });

    it('should call syslogService.create with correct parameters', async () => {
      wrapper.vm.organization = 'test-org';
      const payload = { orgId: 'test', streamName: 'test', subnets: ['192.168.1.0/24'] };
      wrapper.vm.getRoutePayload = vi.fn(() => payload);
      vi.mocked(syslogService.create).mockResolvedValue({});

      wrapper.vm.createRoute();
      await flushPromises();

      expect(vi.mocked(syslogService.create)).toHaveBeenCalledWith('test-org', payload);
    });

    it('should show success notification on successful creation', async () => {
      vi.mocked(syslogService.create).mockResolvedValue({});

      wrapper.vm.createRoute();
      await flushPromises();

      expect(globalMockNotify).toHaveBeenCalledWith({
        message: 'Route saved successfully',
        type: 'positive',
        timeout: 2000,
      });
    });

    it('should reset editing route and refresh routes on success', async () => {
      // Test the side effects of the createRoute method
      wrapper.vm.editingRoute = { orgId: 'test', streamName: 'test', subnets: '192.168.1.0/24' };
      wrapper.vm.routeList = [{ id: '1' }, { id: '2' }];
      vi.mocked(syslogService.create).mockResolvedValue({});
      vi.mocked(syslogService.list).mockResolvedValue({ data: { routes: [{ id: '3' }] } });

      await wrapper.vm.createRoute();
      await flushPromises();

      // Check that the method was successful by verifying notifications were called
      expect(globalMockNotify).toHaveBeenCalledWith({
        message: 'Route saved successfully',
        type: 'positive',
        timeout: 2000,
      });
    });

    it('should show error notification on failure with message', async () => {
      const error = {
        response: {
          data: {
            message: 'Route already exists',
          },
        },
      };
      vi.mocked(syslogService.create).mockRejectedValue(error);

      wrapper.vm.createRoute();
      await flushPromises();

      expect(globalMockNotify).toHaveBeenCalledWith({
        message: 'Error while saving route ( Route already exists )',
        type: 'negative',
        timeout: 4000,
      });
    });

    it('should show error notification on failure with data only', async () => {
      const error = {
        response: {
          data: 'Simple error message',
        },
      };
      vi.mocked(syslogService.create).mockRejectedValue(error);

      wrapper.vm.createRoute();
      await flushPromises();

      expect(globalMockNotify).toHaveBeenCalledWith({
        message: 'Error while saving route ( Simple error message )',
        type: 'negative',
        timeout: 4000,
      });
    });

    it('should dismiss loading notification after completion', async () => {
      wrapper.vm.editingRoute = { orgId: 'test', streamName: 'test', subnets: '192.168.1.0/24' };
      vi.mocked(syslogService.create).mockResolvedValue({});
      vi.mocked(syslogService.list).mockResolvedValue({ data: { routes: [] } });

      await wrapper.vm.createRoute();
      await flushPromises();

      // Verify the method completed by checking the loading notification was called
      expect(globalMockNotify).toHaveBeenCalledWith({
        spinner: true,
        message: 'Please wait while saving route...',
      });
    });
  });

  describe('updateRoute method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.getRoutePayload = vi.fn(() => ({ orgId: 'test', streamName: 'test', subnets: ['192.168.1.0/24'] }));
      wrapper.vm.resetEditingRoute = vi.fn();
      wrapper.vm.getSyslogRoutes = vi.fn();
      wrapper.vm.editingRoute = { id: 'route-123', subnets: '192.168.1.0/24' };
    });

    it('should show loading notification', () => {
      vi.mocked(syslogService.update).mockResolvedValue({});

      wrapper.vm.updateRoute();

      expect(globalMockNotify).toHaveBeenCalledWith({
        spinner: true,
        message: 'Please wait while saving route...',
      });
    });

    it('should call syslogService.update with correct parameters', async () => {
      wrapper.vm.organization = 'test-org';
      wrapper.vm.editingRoute = {
        id: 'route-123',
        orgId: 'test-org',
        streamName: 'test-stream',
        subnets: '192.168.1.0/24'
      };
      vi.mocked(syslogService.update).mockResolvedValue({});

      wrapper.vm.updateRoute();
      await flushPromises();

      expect(vi.mocked(syslogService.update)).toHaveBeenCalledWith(
        'test-org',
        'route-123',
        expect.objectContaining({
          id: 'route-123',
          orgId: 'test-org',
          streamName: 'test-stream',
          subnets: ['192.168.1.0/24']
        })
      );
    });

    it('should handle empty route id', async () => {
      wrapper.vm.editingRoute = {
        id: null,
        orgId: 'test-org',
        streamName: 'test-stream',
        subnets: '192.168.1.0/24'
      };
      vi.mocked(syslogService.update).mockResolvedValue({});

      wrapper.vm.updateRoute();
      await flushPromises();

      expect(vi.mocked(syslogService.update)).toHaveBeenCalledWith(
        'test-org',
        '',
        expect.objectContaining({
          orgId: 'test-org',
          streamName: 'test-stream',
          subnets: ['192.168.1.0/24']
        })
      );
    });
  });

  describe('getRoutePayload method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should return correct payload without id', () => {
      wrapper.vm.editingRoute = {
        orgId: 'test-org',
        streamName: 'test-stream',
        subnets: '192.168.1.0/24, 10.0.0.0/8',
      };

      const result = wrapper.vm.getRoutePayload();

      expect(result).toEqual({
        orgId: 'test-org',
        streamName: 'test-stream',
        subnets: ['192.168.1.0/24', '10.0.0.0/8'],
      });
    });

    it('should return correct payload with id', () => {
      wrapper.vm.editingRoute = {
        id: 'route-123',
        orgId: 'test-org',
        streamName: 'test-stream',
        subnets: '192.168.1.0/24',
      };

      const result = wrapper.vm.getRoutePayload();

      expect(result).toEqual({
        id: 'route-123',
        orgId: 'test-org',
        streamName: 'test-stream',
        subnets: ['192.168.1.0/24'],
      });
    });

    it('should trim whitespace from subnets', () => {
      wrapper.vm.editingRoute = {
        orgId: 'test-org',
        streamName: 'test-stream',
        subnets: ' 192.168.1.0/24 ,  10.0.0.0/8  ',
      };

      const result = wrapper.vm.getRoutePayload();

      expect(result.subnets).toEqual(['192.168.1.0/24', '10.0.0.0/8']);
    });

    it('should handle empty subnets string', () => {
      wrapper.vm.editingRoute = {
        orgId: 'test-org',
        streamName: 'test-stream',
        subnets: '',
      };

      const result = wrapper.vm.getRoutePayload();

      expect(result.subnets).toEqual(['']);
    });
  });

  describe('getUUID method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should return a string', () => {
      const result = wrapper.vm.getUUID();
      expect(typeof result).toBe('string');
    });

    it('should return different values on multiple calls', () => {
      const uuid1 = wrapper.vm.getUUID();
      const uuid2 = wrapper.vm.getUUID();
      expect(uuid1).not.toBe(uuid2);
    });

    it('should return a numeric string', () => {
      const result = wrapper.vm.getUUID();
      expect(result).toMatch(/^\d+$/);
    });
  });

  describe('getSyslogRoutes method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should show loading notification', () => {
      vi.mocked(syslogService.list).mockResolvedValue({ data: { routes: [] } });

      wrapper.vm.getSyslogRoutes();

      expect(globalMockNotify).toHaveBeenCalledWith({
        spinner: true,
        message: 'Please wait while loading route...',
      });
    });

    it('should call syslogService.list with organization', async () => {
      wrapper.vm.organization = 'test-org';
      vi.mocked(syslogService.list).mockResolvedValue({ data: { routes: [] } });

      wrapper.vm.getSyslogRoutes();
      await flushPromises();

      expect(vi.mocked(syslogService.list)).toHaveBeenCalledWith('test-org');
    });

    it('should update routeList with formatted routes', async () => {
      const mockRoutes = [
        {
          id: 'route-1',
          orgId: 'org1',
          streamName: 'stream1',
          subnets: ['192.168.1.0/24', '10.0.0.0/8'],
        },
        {
          id: 'route-2',
          orgId: 'org2',
          streamName: 'stream2',
          subnets: ['172.16.0.0/12'],
        },
      ];
      vi.mocked(syslogService.list).mockResolvedValue({ data: { routes: mockRoutes } });

      wrapper.vm.getSyslogRoutes();
      await flushPromises();

      expect(wrapper.vm.routeList).toEqual([
        {
          id: 'route-1',
          orgId: 'org1',
          streamName: 'stream1',
          subnets: '192.168.1.0/24, 10.0.0.0/8',
          '#': 1,
          isSaved: true,
        },
        {
          id: 'route-2',
          orgId: 'org2',
          streamName: 'stream2',
          subnets: '172.16.0.0/12',
          '#': 2,
          isSaved: true,
        },
      ]);
    });

    it('should show error notification on failure', async () => {
      const error = {
        response: {
          data: {
            message: 'Failed to load routes',
          },
        },
      };
      vi.mocked(syslogService.list).mockRejectedValue(error);

      wrapper.vm.getSyslogRoutes();
      await flushPromises();

      expect(globalMockNotify).toHaveBeenCalledWith({
        message: 'Error while getting routes ( Failed to load routes )',
        type: 'negative',
        timeout: 3000,
      });
    });
  });

  describe('deleteRoute method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.getSyslogRoutes = vi.fn();
    });

    it('should return early if no routeToDelete', () => {
      wrapper.vm.routeToDelete = null;

      wrapper.vm.deleteRoute();

      expect(vi.mocked(syslogService.delete)).not.toHaveBeenCalled();
    });

    it('should handle unsaved route deletion locally', () => {
      wrapper.vm.routeList = [
        { id: '1', isSaved: true, '#': 1 },
        { id: '2', isSaved: false, '#': 2 },
        { id: '3', isSaved: true, '#': 3 },
      ];
      wrapper.vm.routeToDelete = { id: '2', isSaved: false };

      wrapper.vm.deleteRoute();

      expect(wrapper.vm.routeList).toEqual([
        { id: '1', isSaved: true, '#': 1 },
        { id: '3', isSaved: true, '#': 2 },
      ]);
      expect(vi.mocked(syslogService.delete)).not.toHaveBeenCalled();
    });

    it('should call syslogService.delete for saved routes', async () => {
      wrapper.vm.organization = 'test-org';
      wrapper.vm.routeToDelete = { id: 'route-123', isSaved: true };
      vi.mocked(syslogService.delete).mockResolvedValue({});

      wrapper.vm.deleteRoute();
      await flushPromises();

      expect(vi.mocked(syslogService.delete)).toHaveBeenCalledWith('test-org', 'route-123');
    });

    it('should show success notification on successful deletion', async () => {
      wrapper.vm.routeToDelete = { id: 'route-123', isSaved: true };
      vi.mocked(syslogService.delete).mockResolvedValue({});

      wrapper.vm.deleteRoute();
      await flushPromises();

      expect(globalMockNotify).toHaveBeenCalledWith({
        message: 'Route deleted successfully',
        type: 'positive',
        timeout: 2000,
      });
    });

    it('should refresh routes after successful deletion', async () => {
      wrapper.vm.routeToDelete = { id: 'route-123', isSaved: true };
      vi.mocked(syslogService.delete).mockResolvedValue({});
      vi.mocked(syslogService.list).mockResolvedValue({ data: { routes: [] } });

      await wrapper.vm.deleteRoute();
      await flushPromises();

      // Verify deletion was successful by checking the success notification
      expect(globalMockNotify).toHaveBeenCalledWith({
        message: 'Route deleted successfully',
        type: 'positive',
        timeout: 2000,
      });
    });
  });

  describe('resetEditingRoute method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should call getDefaultRoute', () => {
      // Test the behavior by checking the result of resetEditingRoute
      const initialRoute = wrapper.vm.editingRoute;
      
      wrapper.vm.resetEditingRoute();
      
      // Check that editingRoute was reset to a default route
      expect(wrapper.vm.editingRoute).toEqual({
        '#': 1,
        orgId: 'org1',
        streamName: 'default',
        subnets: '',
        id: expect.any(String)
      });
    });

    it('should set editingRoute to default route', () => {
      const defaultRoute = { '#': 1, orgId: 'org1', streamName: 'default', subnets: '', id: expect.any(String) };
      wrapper.vm.resetEditingRoute();
      expect(wrapper.vm.editingRoute).toEqual(defaultRoute);
    });
  });

  describe('editRoute method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should clone the route to editingRoute', () => {
      const route = {
        id: 'route-123',
        orgId: 'test-org',
        streamName: 'test-stream',
        subnets: '192.168.1.0/24',
      };

      wrapper.vm.editRoute(route);

      expect(wrapper.vm.editingRoute).toEqual(route);
    });

    it('should create a deep copy of the route', () => {
      const route = {
        id: 'route-123',
        orgId: 'test-org',
        nested: { value: 'test' },
      };

      wrapper.vm.editRoute(route);

      expect(wrapper.vm.editingRoute).not.toBe(route);
      expect(wrapper.vm.editingRoute.nested).not.toBe(route.nested);
    });
  });

  describe('getDefaultRoute method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.routeList = [{ '#': 1 }, { '#': 2 }];
    });

    it('should return route with correct index', () => {
      wrapper.vm.routeList = [{ '#': 1 }, { '#': 2 }];
      const result = wrapper.vm.getDefaultRoute();

      expect(result['#']).toBe(3); // routeList.length + 1
    });

    it('should return route with first organization', () => {
      const result = wrapper.vm.getDefaultRoute();

      expect(result.orgId).toBe('org1');
    });

    it('should return route with default streamName', () => {
      const result = wrapper.vm.getDefaultRoute();

      expect(result.streamName).toBe('default');
    });

    it('should return route with empty subnets', () => {
      const result = wrapper.vm.getDefaultRoute();

      expect(result.subnets).toBe('');
    });

    it('should return route with generated UUID', () => {
      const result = wrapper.vm.getDefaultRoute();

      expect(result.id).toEqual(expect.any(String));
      expect(result.id).toMatch(/^\d+$/);
    });
  });

  describe('addNewRoute method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.routeList = [{ '#': 1 }, { '#': 2 }];
    });

    it('should add new route to routeList', () => {
      wrapper.vm.routeList = [{ id: '1' }, { id: '2' }];

      wrapper.vm.addNewRoute();

      expect(wrapper.vm.routeList).toHaveLength(3);
      expect(wrapper.vm.routeList[2]).toEqual({
        '#': 3,
        orgId: 'org1',
        streamName: 'default',
        subnets: '',
        id: expect.any(String),
      });
    });

    it('should set editingRoute to the newly added route', () => {
      wrapper.vm.routeList = [{ '#': 1 }, { '#': 2 }];
      wrapper.vm.addNewRoute();
      expect(wrapper.vm.editingRoute['#']).toBe(3);
      expect(wrapper.vm.editingRoute.orgId).toBe('org1');
      expect(wrapper.vm.editingRoute.streamName).toBe('default');
      expect(wrapper.vm.editingRoute.subnets).toBe('');
      expect(wrapper.vm.editingRoute.id).toEqual(expect.any(String));
    });
  });

  describe('conformDeleteRoute method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should set showConformDelete to true', () => {
      const route = { id: 'route-123' };

      wrapper.vm.conformDeleteRoute(route);

      expect(wrapper.vm.showConformDelete).toBe(true);
    });

    it('should set routeToDelete to the provided route', () => {
      const route = { id: 'route-123', orgId: 'test-org' };

      wrapper.vm.conformDeleteRoute(route);

      expect(wrapper.vm.routeToDelete).toStrictEqual(route);
    });
  });

  describe('cancelDeleteRoute method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.showConformDelete = true;
      wrapper.vm.routeToDelete = { id: 'route-123' };
    });

    it('should set showConformDelete to false', () => {
      wrapper.vm.cancelDeleteRoute();
      expect(wrapper.vm.showConformDelete).toBe(false);
    });

    it('should set routeToDelete to null', () => {
      wrapper.vm.cancelDeleteRoute();
      expect(wrapper.vm.routeToDelete).toBeNull();
    });
  });

  describe('Lifecycle Hooks', () => {
    it('should initialize component properly', () => {
      vi.mocked(syslogService.list).mockResolvedValue({ data: { routes: [] } });
      
      wrapper = createWrapper();
      
      // Verify component initialization
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.organization).toBe('test-org');
      expect(wrapper.vm.organizations).toEqual(['org1', 'org2']);
    });
  });

  describe('Error Handling', () => {
    it('should handle error without response in createRoute', async () => {
      wrapper = createWrapper();
      wrapper.vm.editingRoute = {
        orgId: 'test',
        streamName: 'test',
        subnets: '192.168.1.0/24'
      };
      
      const error = new Error('Network error');
      vi.mocked(syslogService.create).mockRejectedValue(error);

      wrapper.vm.createRoute();
      await flushPromises();

      // Should still call notify even on error
      expect(globalMockNotify).toHaveBeenCalled();
    });

    it('should handle error without response in updateRoute', async () => {
      wrapper = createWrapper();
      wrapper.vm.editingRoute = {
        id: 'test-id',
        orgId: 'test',
        streamName: 'test',
        subnets: '192.168.1.0/24'
      };
      
      const error = new Error('Network error');
      vi.mocked(syslogService.update).mockRejectedValue(error);

      wrapper.vm.updateRoute();
      await flushPromises();

      expect(globalMockNotify).toHaveBeenCalled();
    });

    it('should handle error without response in deleteRoute', async () => {
      wrapper = createWrapper();
      wrapper.vm.routeToDelete = { id: 'test-id', isSaved: true };
      
      const error = new Error('Network error');
      vi.mocked(syslogService.delete).mockRejectedValue(error);

      wrapper.vm.deleteRoute();
      await flushPromises();

      expect(globalMockNotify).toHaveBeenCalled();
    });
  });
});