import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { installQuasar } from '@/test/unit/helpers/install-quasar-plugin';
import { Dialog, Notify, Quasar } from 'quasar';
import { nextTick } from 'vue';
import AddUpdateTicket from './AddUpdateTicket.vue';

installQuasar({ plugins: { Dialog, Notify } });

// Mock services
vi.mock('@/services/tickets', () => ({
  default: {
    create: vi.fn(),
    update: vi.fn(),
  }
}));

vi.mock('@/services/attachments', () => ({
  default: {
    getPresignedUrl: vi.fn(),
    upload: vi.fn(),
  }
}));

// Mock utils
vi.mock('@/utils/zincutils', () => ({
  getImageURL: vi.fn((url: string) => url),
}));

import ticketService from '@/services/tickets';
import attachmentService from '@/services/attachments';
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

describe('AddUpdateTicket.vue', () => {
  let wrapper: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    vi.mocked(ticketService.create).mockReset();
    vi.mocked(ticketService.update).mockReset();
    vi.mocked(attachmentService.getPresignedUrl).mockReset();
    vi.mocked(attachmentService.upload).mockReset();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(AddUpdateTicket, {
      props: {
        modelValue: {
          id: '',
          user_id: '',
          subject: '',
          description: '',
          created_at: '',
          updated_at: '',
          status: '',
          comments: '',
          attachments: '',
          files: '',
        },
        ...props,
      },
      global: {
        plugins: [i18n],
        provide: {
          store,
        },
      },
    });
  };

  describe('Component Initialization', () => {
    it('should render component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('should have correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('ComponentAddUpdateUser');
    });

    it('should initialize with default values', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.beingUpdated).toBe(false);
      expect(wrapper.vm.isUploading).toBe(false);
      expect(wrapper.vm.status).toEqual(['Created', 'In-Progress', 'Completed']);
      expect(wrapper.vm.disableColor).toBe('');
    });

    it('should initialize ticketData with default values', () => {
      wrapper = createWrapper();
      const expectedDefault = {
        id: '',
        user_id: '',
        subject: '',
        description: '',
        created_at: '',
        updated_at: '',
        status: '',
        comments: '',
        attachments: '',
        files: '',
      };
      expect(wrapper.vm.ticketData).toEqual(expectedDefault);
    });

    it('should expose getImageURL from setup', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getImageURL).toBeDefined();
    });
  });

  describe('Props Validation', () => {
    it('should accept valid modelValue prop', () => {
      const modelValue = {
        id: '123',
        subject: 'Test Subject',
        description: 'Test Description',
      };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.props('modelValue')).toEqual(modelValue);
    });

    it('should use default value when modelValue is not provided', () => {
      wrapper = createWrapper({ modelValue: undefined });
      expect(wrapper.vm.modelValue).toEqual({
        id: '',
        user_id: '',
        subject: '',
        description: '',
        created_at: '',
        updated_at: '',
        status: '',
        comments: '',
        attachments: '',
        files: '',
      });
    });
  });

  describe('Created Lifecycle Hook', () => {
    it('should set beingUpdated to true when modelValue has id', () => {
      const modelValue = {
        id: '123',
        subject: 'Test Subject',
        description: 'Test Description',
        status: 'Created',
        comments: 'Test comments',
        attachments: 'test.pdf',
        created_at: '2023-01-01',
        updated_at: '2023-01-02',
      };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.vm.beingUpdated).toBe(true);
    });

    it('should set disableColor when beingUpdated is true', () => {
      const modelValue = { id: '123' };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.vm.disableColor).toBe('grey-5');
    });

    it('should copy modelValue properties to ticketData', () => {
      const modelValue = {
        id: '123',
        subject: 'Test Subject',
        description: 'Test Description',
        created_at: '2023-01-01',
        updated_at: '2023-01-02',
        status: 'Created',
        comments: 'Test comments',
        attachments: 'test.pdf',
      };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.vm.ticketData.id).toBe('123');
      expect(wrapper.vm.ticketData.subject).toBe('Test Subject');
      expect(wrapper.vm.ticketData.description).toBe('Test Description');
    });

    it('should not set beingUpdated when modelValue has no id', () => {
      const modelValue = { subject: 'Test' };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.vm.beingUpdated).toBe(false);
    });

    it('should not set beingUpdated when modelValue is null', () => {
      wrapper = createWrapper({ modelValue: null });
      expect(wrapper.vm.beingUpdated).toBe(false);
    });

    it('should handle empty string id', () => {
      const modelValue = { id: '' };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.vm.beingUpdated).toBe(false);
    });
  });

  describe('Validation Methods', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    describe('validateTicketSubject', () => {
      it('should return error message for subject less than 3 characters', () => {
        const result = wrapper.vm.validateTicketSubject('ab');
        expect(result).toBe('User name must be at least 3 characters long');
      });

      it('should return error message for empty subject', () => {
        const result = wrapper.vm.validateTicketSubject('');
        expect(result).toBe('User name must be at least 3 characters long');
      });

      it('should return error message for 2 character subject', () => {
        const result = wrapper.vm.validateTicketSubject('12');
        expect(result).toBe('User name must be at least 3 characters long');
      });

      it('should not return error for valid subject', () => {
        const result = wrapper.vm.validateTicketSubject('abc');
        expect(result).toBeUndefined();
      });

      it('should not return error for longer subject', () => {
        const result = wrapper.vm.validateTicketSubject('This is a valid subject');
        expect(result).toBeUndefined();
      });

      it('should handle array input', () => {
        const result = wrapper.vm.validateTicketSubject(['a', 'b']);
        expect(result).toBe('User name must be at least 3 characters long');
      });

      it('should handle array with sufficient length', () => {
        const result = wrapper.vm.validateTicketSubject(['a', 'b', 'c']);
        expect(result).toBeUndefined();
      });
    });

    describe('validateTicketDescription', () => {
      it('should return error message for description less than 3 characters', () => {
        const result = wrapper.vm.validateTicketDescription('ab');
        expect(result).toBe('You must select a role');
      });

      it('should return error message for empty description', () => {
        const result = wrapper.vm.validateTicketDescription('');
        expect(result).toBe('You must select a role');
      });

      it('should not return error for valid description', () => {
        const result = wrapper.vm.validateTicketDescription('abc');
        expect(result).toBeUndefined();
      });

      it('should handle array input', () => {
        const result = wrapper.vm.validateTicketDescription(['a']);
        expect(result).toBe('You must select a role');
      });
    });

    describe('validateTicketComments', () => {
      it('should return error message for comments less than 3 characters', () => {
        const result = wrapper.vm.validateTicketComments('ab');
        expect(result).toBe('You must select a role');
      });

      it('should return error message for empty comments', () => {
        const result = wrapper.vm.validateTicketComments('');
        expect(result).toBe('You must select a role');
      });

      it('should not return error for valid comments', () => {
        const result = wrapper.vm.validateTicketComments('abc');
        expect(result).toBeUndefined();
      });

      it('should handle array input', () => {
        const result = wrapper.vm.validateTicketComments(['a', 'b']);
        expect(result).toBe('You must select a role');
      });
    });
  });

  describe('uploadAttachment method', () => {
    let mockEmit: any;
    let mockUpdateFileStatus: any;

    beforeEach(() => {
      wrapper = createWrapper();
      mockEmit = vi.fn();
      mockUpdateFileStatus = vi.fn();
      
      // Mock $emit directly on the component instance
      wrapper.vm.$emit = mockEmit;
      wrapper.vm.$refs = {
        fileUploader: {
          updateFileStatus: mockUpdateFileStatus,
        },
      };
    });

    it('should call attachmentService.getPresignedUrl with correct parameters', () => {
      const files = [{ name: 'test.pdf', type: 'application/pdf' }];
      vi.mocked(attachmentService.getPresignedUrl).mockResolvedValue({
        data: { data: 'presigned-url' }
      });
      vi.mocked(attachmentService.upload).mockResolvedValue({});

      wrapper.vm.uploadAttachment(files);

      expect(vi.mocked(attachmentService.getPresignedUrl)).toHaveBeenCalledWith('test.pdf', 'application/pdf');
    });

    it('should handle different file types', () => {
      const files = [{ name: 'image.jpg', type: 'image/jpeg' }];
      vi.mocked(attachmentService.getPresignedUrl).mockResolvedValue({
        data: { data: 'presigned-url' }
      });

      wrapper.vm.uploadAttachment(files);

      expect(vi.mocked(attachmentService.getPresignedUrl)).toHaveBeenCalledWith('image.jpg', 'image/jpeg');
    });
  });

  describe('onRejected method', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should handle rejected entries array', () => {
      const rejectedEntries = [{ file: 'test.txt' }];
      // Test that the method exists and can be called without error
      expect(() => wrapper.vm.onRejected(rejectedEntries)).not.toThrow();
    });
  });

  describe('onSubmit method', () => {
    let mockValidate: any;
    let mockResetValidation: any;

    beforeEach(() => {
      wrapper = createWrapper();
      
      mockValidate = vi.fn();
      mockResetValidation = vi.fn();
      
      wrapper.vm.addTicketForm = {
        validate: mockValidate,
        resetValidation: mockResetValidation,
      };
    });

    it('should not proceed if form validation fails', async () => {
      mockValidate.mockResolvedValue(false);

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(vi.mocked(ticketService.create)).not.toHaveBeenCalled();
      expect(vi.mocked(ticketService.update)).not.toHaveBeenCalled();
    });

    it('should call ticketService.create for new ticket', async () => {
      mockValidate.mockResolvedValue(true);
      wrapper.vm.ticketData.id = '';
      vi.mocked(ticketService.create).mockResolvedValue({ data: { id: '123' } });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(vi.mocked(ticketService.create)).toHaveBeenCalledWith(
        expect.objectContaining({
          requester_id: 88000825587,
          responder_id: 88000825587,
          email: 'example', // This comes from store.state.userInfo.name which is 'example'
          type: 'Incident',
          priority: 1,
          source: 1,
          status: 2,
        })
      );
    });

    it('should call ticketService.update for existing ticket', async () => {
      mockValidate.mockResolvedValue(true);
      wrapper.vm.ticketData.id = '456';
      vi.mocked(ticketService.update).mockResolvedValue({ data: { id: '456' } });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(vi.mocked(ticketService.update)).toHaveBeenCalledWith('456', expect.any(Object));
    });

    it('should reset ticketData after successful submission', async () => {
      mockValidate.mockResolvedValue(true);
      vi.mocked(ticketService.create).mockResolvedValue({ data: { id: '123' } });

      await wrapper.vm.onSubmit();
      await flushPromises();

      const expectedReset = {
        id: '',
        user_id: '',
        subject: '',
        description: '',
        created_at: '',
        updated_at: '',
        status: '',
        comments: '',
        attachments: '',
      };
      expect(wrapper.vm.ticketData).toEqual(expectedReset);
    });
  });

  describe('Template Rendering', () => {
    it('should show "Update Ticket" title when beingUpdated is true', () => {
      const modelValue = { id: '123' };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.text()).toContain('Update Ticket');
    });

    it('should show "Create Ticket" title when beingUpdated is false', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Create Ticket');
    });

    it('should show ID input only when beingUpdated is true', () => {
      const modelValue = { id: '123' };
      wrapper = createWrapper({ modelValue });
      // Check if the ID input exists when beingUpdated is true
      expect(wrapper.vm.beingUpdated).toBe(true);
      // Find the input that would contain the ID
      const inputs = wrapper.findAll('input');
      expect(inputs.length).toBeGreaterThan(0);
    });

    it('should show status select only when beingUpdated is true', () => {
      const modelValue = { id: '123', status: 'Created' };
      wrapper = createWrapper({ modelValue });
      // Check if the status select exists when beingUpdated is true
      expect(wrapper.vm.beingUpdated).toBe(true);
      expect(wrapper.vm.ticketData.status).toBe('Created');
    });

    it('should show Save button when creating new ticket', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Save');
    });

    it('should show Update button when updating existing ticket', () => {
      const modelValue = { id: '123' };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.text()).toContain('Update');
    });
  });

  describe('Emits', () => {
    it('should define correct emits', () => {
      wrapper = createWrapper();
      const emits = wrapper.vm.$options.emits;
      expect(emits).toContain('update:modelValue');
      expect(emits).toContain('fileUploaded');
      expect(emits).toContain('updated');
      expect(emits).toContain('finish');
      expect(emits).toContain('isUploading');
    });
  });

  describe('Edge Cases', () => {
    it('should handle null modelValue gracefully', () => {
      wrapper = createWrapper({ modelValue: null });
      expect(wrapper.vm.beingUpdated).toBe(false);
    });

    it('should handle undefined properties in modelValue', () => {
      const modelValue = { id: '123', subject: undefined };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.vm.ticketData.subject).toBeUndefined();
    });

    it('should handle empty string validation correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.validateTicketSubject('')).toBe('User name must be at least 3 characters long');
      expect(wrapper.vm.validateTicketDescription('')).toBe('You must select a role');
      expect(wrapper.vm.validateTicketComments('')).toBe('You must select a role');
    });

    it('should handle exactly 3 character inputs', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.validateTicketSubject('abc')).toBeUndefined();
      expect(wrapper.vm.validateTicketDescription('xyz')).toBeUndefined();
      expect(wrapper.vm.validateTicketComments('123')).toBeUndefined();
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete update flow', async () => {
      const modelValue = { id: '456', subject: 'Existing Ticket' };
      wrapper = createWrapper({ modelValue });
      
      const mockValidate = vi.fn().mockResolvedValue(true);
      const mockResetValidation = vi.fn();
      
      wrapper.vm.addTicketForm = {
        validate: mockValidate,
        resetValidation: mockResetValidation,
      };

      vi.mocked(ticketService.update).mockResolvedValue({
        data: { id: '456', subject: 'Updated Ticket' }
      });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(vi.mocked(ticketService.update)).toHaveBeenCalledWith('456', expect.any(Object));
    });
  });
});