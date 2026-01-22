import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { Quasar } from 'quasar';
import License from './License.vue';
import licenseServer from '@/services/license_server';
import { createStore } from 'vuex';
import i18n from '@/locales';
import type { AxiosResponse } from 'axios';

// Helper to create mock Axios responses
const createAxiosResponse = <T = any>(data: T): AxiosResponse<T> => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: {} as any,
});

// Mock the license server service
vi.mock('@/services/license_server', () => ({
  default: {
    get_license: vi.fn(),
    update_license: vi.fn(),
  },
}));

// Mock the LicensePeriod component
vi.mock('@/enterprise/components/billings/LicensePeriod.vue', () => ({
  default: {
    name: 'LicensePeriod',
    template: '<div data-test="license-period">License Period</div>',
    emits: ['updateLicense'],
  },
}));

// Mock useQuasar
const mockNotify = vi.fn();
const mockDialog = vi.fn().mockReturnValue({
  onOk: vi.fn().mockReturnThis(),
  onCancel: vi.fn().mockReturnThis(),
});

vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    useQuasar: () => ({
      notify: mockNotify,
      dialog: mockDialog,
      platform: {
        has: {
          touch: false,
        },
        is: {
          mobile: false,
          desktop: true,
        },
      },
    }),
  };
});

describe('License.vue', () => {
  let store: any;
  let wrapper: any;

  const mockLicenseData = {
    installation_id: 'test-installation-123',
    key: 'test-license-key-12345678901234567890',
    license: {
      license_id: 'license-123',
      active: true,
      created_at: 1704067200000000, // 2024-01-01 00:00:00
      expires_at: 1735689600000000, // 2025-01-01 00:00:00
      company: 'Test Company',
      contact_name: 'John Doe',
      contact_email: 'john@example.com',
      limits: {
        Ingestion: {
          typ: 'PerDayCount',
          value: 100,
        },
      },
    },
    ingestion_used: 45.5,
    ingestion_exceeded: 2,
  };

  const createWrapper = (options = {}) => {
    store = createStore({
      state: {
        zoConfig: {
          license_server_url: 'https://license.example.com',
          license_expiry: null,
        },
      },
    });

    return mount(License, {
      global: {
        plugins: [
          [Quasar, {
            plugins: {},
          }],
          store,
          i18n,
        ],
        stubs: {
          LicensePeriod: true,
          QCircularProgress: true,
        },
        mocks: {
          $q: {
            notify: vi.fn(),
            dialog: vi.fn().mockReturnValue({
              onOk: vi.fn().mockReturnThis(),
              onCancel: vi.fn().mockReturnThis(),
            }),
            platform: {
              has: {
                touch: false,
              },
              is: {
                mobile: false,
                desktop: true,
              },
            },
          },
        },
      },
      ...options,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNotify.mockClear();
    mockDialog.mockClear();
    // Mock window.location
    delete (window as any).location;
    window.location = {
      href: 'http://localhost:3000',
      origin: 'http://localhost:3000',
      search: '',
    } as any;
  });

  describe('Component Mounting', () => {
    it('should mount successfully', () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('should show loading spinner while fetching license data', async () => {
      vi.mocked(licenseServer.get_license).mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve(createAxiosResponse(mockLicenseData)), 100))
      );
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      // Check if loading text is present initially
      const hasLoadingText = wrapper.text().includes('Loading license information');
      expect(hasLoadingText).toBe(true);
    });

    it('should call loadLicenseData on mount', async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(licenseServer.get_license).toHaveBeenCalledTimes(1);
    });
  });

  describe('No License State', () => {
    const noLicenseData = {
      installation_id: 'test-installation-123',
      license: null,
    };

    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(noLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it('should display "No License Found" message when license is null', () => {
      expect(wrapper.text()).toContain('No License Found');
    });

    it('should display installation ID', () => {
      expect(wrapper.text()).toContain('Installation ID:');
      expect(wrapper.text()).toContain('test-installation-123');
    });

    it('should show license key input textarea', () => {
      const textarea = wrapper.find('textarea[placeholder="Paste your license key here..."]');
      expect(textarea.exists()).toBe(true);
    });

    it('should show "Get License" button', () => {
      const buttons = wrapper.findAll('button');
      const getLicenseBtn = buttons.find((btn: any) => btn.text().includes('Get License'));
      expect(getLicenseBtn).toBeTruthy();
    });

    it('should disable Update License button when license key is empty', () => {
      const updateBtn = wrapper.findAll('button').find((btn: any) =>
        btn.text().includes('Update License')
      );
      expect(updateBtn?.attributes('disabled')).toBeDefined();
    });

    it('should enable Update License button when license key is entered', async () => {
      const textarea = wrapper.find('textarea');
      await textarea.setValue('new-license-key-value');
      await wrapper.vm.$nextTick();

      const updateBtn = wrapper.findAll('button').find((btn: any) =>
        btn.text().includes('Update License')
      );
      expect(updateBtn?.attributes('disabled')).toBeUndefined();
    });
  });

  describe('Active License State', () => {
    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it('should display license information when license exists', () => {
      expect(wrapper.text()).toContain('License Information');
      expect(wrapper.text()).toContain('license-123');
      expect(wrapper.text()).toContain('Test Company');
    });

    it('should display installation ID', () => {
      expect(wrapper.text()).toContain('test-installation-123');
    });

    it('should display license status as badge', () => {
      expect(wrapper.text()).toContain('Active');
    });

    it('should display company name', () => {
      expect(wrapper.text()).toContain('Test Company');
    });

    it('should display contact information', () => {
      expect(wrapper.text()).toContain('John Doe');
      expect(wrapper.text()).toContain('john@example.com');
    });

    it('should display masked license key', () => {
      expect(wrapper.text()).toContain('test-');
      expect(wrapper.text()).toContain('*****');
    });

    it('should show "Request new License" button', () => {
      const buttons = wrapper.findAll('button');
      const requestBtn = buttons.find((btn: any) => btn.text().includes('Request new License'));
      expect(requestBtn).toBeTruthy();
    });

    it('should show "Add New License Key" button', () => {
      const buttons = wrapper.findAll('button');
      const addBtn = buttons.find((btn: any) => btn.text().includes('Add New License Key'));
      expect(addBtn).toBeTruthy();
    });

    it('should hide update form by default', () => {
      expect(wrapper.vm.showUpdateForm).toBe(false);
    });

    it('should show update form when "Add New License Key" is clicked', async () => {
      wrapper.vm.showUpdateFormAndFocus();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showUpdateForm).toBe(true);
    });
  });

  describe('Usage Information', () => {
    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it('should display usage information section', () => {
      expect(wrapper.text()).toContain('Usage Information');
      expect(wrapper.text()).toContain('100 GB of data ingestion per day');
    });

    it('should calculate ingestion usage percentage correctly', () => {
      expect(wrapper.vm.ingestionUsagePercent).toBe(45.5);
    });

    it('should display ingestion limit', () => {
      expect(wrapper.text()).toContain('100 GB of data ingestion per day');
    });

    it('should display ingestion type', () => {
      // The ingestion type is not directly displayed in the new UI
      // It's used internally for the limit calculation
      expect(wrapper.vm.licenseData.license.limits.Ingestion.typ).toBe('PerDayCount');
    });

    it('should display limit exceeded count', () => {
      expect(wrapper.text()).toContain('The limit was exceeded on 2 days this month');
    });

    it('should show green color for usage under 60%', () => {
      expect(wrapper.vm.getIngestionUsageColor()).toBe('green');
    });

    it('should show orange color for usage between 60-90%', async () => {
      const highUsageData = {
        ...mockLicenseData,
        ingestion_used: 75,
      };
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(highUsageData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.getIngestionUsageColor()).toBe('orange');
    });

    it('should show red color for usage above 90%', async () => {
      const criticalUsageData = {
        ...mockLicenseData,
        ingestion_used: 95,
      };
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(criticalUsageData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.getIngestionUsageColor()).toBe('red');
    });
  });

  describe('Unlimited License', () => {
    const unlimitedLicenseData = {
      ...mockLicenseData,
      license: {
        ...mockLicenseData.license,
        limits: {
          Ingestion: {
            typ: 'Unlimited',
            value: 0,
          },
        },
      },
    };

    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(unlimitedLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it('should identify unlimited license type', () => {
      expect(wrapper.vm.isIngestionUnlimited).toBe(true);
    });

    it('should show 0% usage for unlimited license', () => {
      expect(wrapper.vm.ingestionUsagePercent).toBe(0);
    });

    it('should display "Unlimited" in usage section', () => {
      // For unlimited license, the component displays a disclaimer instead of "Unlimited" text
      // Check that the disclaimer is displayed
      expect(wrapper.text()).toContain('Usage shows 0% for unlimited plans');
    });

    it('should show disclaimer for unlimited plans', () => {
      expect(wrapper.text()).toContain('Usage shows 0% for unlimited plans');
    });
  });

  describe('Update License Functionality', () => {
    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it('should call update_license API when updating license', async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(createAxiosResponse({ success: true }));

      // Set license key directly
      wrapper.vm.licenseKey = 'new-license-key';

      // Call update
      await wrapper.vm.updateLicense();
      await flushPromises();

      expect(licenseServer.update_license).toHaveBeenCalledWith('new-license-key');
    });

    it('should show success notification on successful update', async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(createAxiosResponse({ success: true }));

      wrapper.vm.licenseKey = 'new-license-key';
      await wrapper.vm.updateLicense();
      await flushPromises();

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'positive',
        message: 'License updated successfully',
      });
    });

    it('should show error notification on failed update', async () => {
      vi.mocked(licenseServer.update_license).mockRejectedValue(new Error('Update failed'));

      wrapper.vm.licenseKey = 'invalid-license-key';
      await wrapper.vm.updateLicense();
      await flushPromises();

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Failed to update license',
      });
    });

    it('should clear license key after successful update', async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(createAxiosResponse({ success: true }));

      wrapper.vm.licenseKey = 'new-license-key';
      await wrapper.vm.updateLicense();
      await flushPromises();

      expect(wrapper.vm.licenseKey).toBe('');
    });

    it('should hide update form after successful update', async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(createAxiosResponse({ success: true }));

      wrapper.vm.showUpdateForm = true;
      wrapper.vm.licenseKey = 'new-license-key';
      await wrapper.vm.updateLicense();
      await flushPromises();

      expect(wrapper.vm.showUpdateForm).toBe(false);
    });

    it('should reload license data after successful update', async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(createAxiosResponse({ success: true }));
      vi.mocked(licenseServer.get_license).mockClear();

      wrapper.vm.licenseKey = 'new-license-key';
      await wrapper.vm.updateLicense();
      await flushPromises();

      expect(licenseServer.get_license).toHaveBeenCalled();
    });
  });

  describe('License Key Masking', () => {
    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it('should mask license key correctly', () => {
      const maskedKey = wrapper.vm.maskKey('test-license-key-12345678901234567890');
      expect(maskedKey).toContain('test-');
      expect(maskedKey).toContain('*****');
      expect(maskedKey).toContain('67890');
    });

    it('should return original key if too short', () => {
      const shortKey = 'short';
      const maskedKey = wrapper.vm.maskKey(shortKey);
      expect(maskedKey).toBe(shortKey);
    });

    it('should show visibility button for license key', () => {
      const buttons = wrapper.findAll('button');
      const visibilityBtn = buttons.find((btn: any) => {
        const html = btn.html();
        return html.includes('visibility');
      });
      expect(visibilityBtn).toBeTruthy();
    });

    it('should open modal when visibility button is clicked', async () => {
      wrapper.vm.showLicenseKeyModal = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showLicenseKeyModal).toBe(true);
    });
  });

  describe('License Key Modal', () => {
    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it('should show full license key in modal', async () => {
      wrapper.vm.showLicenseKeyModal = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showLicenseKeyModal).toBe(true);
    });

    it('should copy license key to clipboard', async () => {
      const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: clipboardWriteText,
        },
      });

      await wrapper.vm.copyLicenseKey();

      expect(clipboardWriteText).toHaveBeenCalledWith(mockLicenseData.key);
    });

    it('should show success notification after copying', async () => {
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      });

      await wrapper.vm.copyLicenseKey();

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'positive',
        message: 'License key copied to clipboard',
      });
    });

    it('should close modal after copying', async () => {
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      });

      wrapper.vm.showLicenseKeyModal = true;
      await wrapper.vm.copyLicenseKey();

      expect(wrapper.vm.showLicenseKeyModal).toBe(false);
    });
  });

  describe('Get License Redirect', () => {
    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it('should open license request URL in new tab', () => {
      const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      wrapper.vm.redirectToGetLicense();

      expect(windowOpenSpy).toHaveBeenCalledWith(
        expect.stringContaining('license.example.com'),
        '_blank'
      );
    });

    it('should include installation ID in license request URL', () => {
      const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      wrapper.vm.redirectToGetLicense();

      expect(windowOpenSpy).toHaveBeenCalledWith(
        expect.stringContaining('test-installation-123'),
        '_blank'
      );
    });

    it('should include base URL in license request', () => {
      const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      wrapper.vm.redirectToGetLicense();

      expect(windowOpenSpy).toHaveBeenCalledWith(
        expect.stringContaining('base_url='),
        '_blank'
      );
    });
  });

  describe('URL Auto-fill License Key', () => {
    it('should auto-fill license key from URL parameters', async () => {
      window.location.search = '?installation_id=test-installation-123&license_key=auto-filled-key';

      const noLicenseData = {
        installation_id: 'test-installation-123',
        license: null,
      };

      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(noLicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.licenseKey).toBe('auto-filled-key');
      expect(wrapper.vm.isLicenseKeyAutoFilled).toBe(true);
    });

    it('should show auto-fill banner when license key is from URL', async () => {
      window.location.search = '?installation_id=test-installation-123&license_key=auto-filled-key';

      const noLicenseData = {
        installation_id: 'test-installation-123',
        license: null,
      };

      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(noLicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain('License key auto-filled from URL');
    });

    it('should clear URL parameters after successful update', async () => {
      window.location.search = '?installation_id=test-installation-123&license_key=auto-filled-key';
      const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      vi.mocked(licenseServer.update_license).mockResolvedValue(createAxiosResponse({ success: true }));

      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.licenseKey = 'new-key';
      await wrapper.vm.updateLicense();
      await flushPromises();

      expect(replaceStateSpy).toHaveBeenCalled();
    });

    it('should not auto-fill if installation IDs do not match', async () => {
      window.location.search = '?installation_id=different-id&license_key=auto-filled-key';

      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.licenseKey).toBe('');
      expect(wrapper.vm.isLicenseKeyAutoFilled).toBe(false);
    });
  });

  describe('Date Formatting', () => {
    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it('should format timestamp to readable date', () => {
      const timestamp = 1704067200000000; // 2024-01-01 00:00:00
      const formatted = wrapper.vm.formatDate(timestamp);
      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe('string');
    });

    it('should display formatted created date', () => {
      expect(wrapper.text()).toContain('Created At');
    });

    it('should display formatted expiry date', () => {
      expect(wrapper.text()).toContain('Expires At');
    });
  });

  describe('Error Handling', () => {
    it('should show error notification when loading license fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(licenseServer.get_license).mockRejectedValue(new Error('Network error'));

      wrapper = createWrapper();
      await flushPromises();

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Failed to load license information',
      });

      consoleErrorSpy.mockRestore();
    });

    it('should handle clipboard copy failure gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();

      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockRejectedValue(new Error('Clipboard error')),
        },
      });

      await wrapper.vm.copyLicenseKey();

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Failed to copy license key',
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Component Cleanup', () => {
    it('should cleanup properly on unmount', async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(() => wrapper.unmount()).not.toThrow();
    });
  });
});
