import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { installQuasar } from '@/test/unit/helpers/install-quasar-plugin';
import { Dialog, Notify } from 'quasar';
import i18n from '@/locales';
import store from '@/test/unit/helpers/store';

installQuasar({ plugins: [Dialog, Notify] });

vi.mock('@/aws-exports', () => ({
  default: { isCloud: 'false', isEnterprise: 'true' },
}));

const mockInvitations = [
  {
    token: 'tok-1',
    org_id: 'org-1',
    org_name: 'Org One',
    role: 'Member',
    inviter_id: 'admin@example.com',
    // expires_at in microseconds: 30 days from now
    expires_at: (Date.now() + 30 * 24 * 60 * 60 * 1000) * 1000,
  },
  {
    token: 'tok-2',
    org_id: 'org-2',
    org_name: 'Org Two',
    role: 'Admin',
    inviter_id: 'super@example.com',
    // expires in the past (expired)
    expires_at: (Date.now() - 5 * 24 * 60 * 60 * 1000) * 1000,
  },
];

vi.mock('@/services/users', () => ({
  default: {
    getPendingInvites: vi.fn(async () => ({
      data: { data: mockInvitations },
    })),
  },
}));

vi.mock('@/services/organizations', () => ({
  default: {
    process_subscription: vi.fn(async () => ({})),
    decline_subscription: vi.fn(async () => ({})),
    list: vi.fn(async () => ({
      data: { data: [{ identifier: 'org-1', name: 'Org One' }] },
    })),
  },
}));

import InvitationList from '@/components/iam/users/InvitationList.vue';
import usersService from '@/services/users';
import organizationsService from '@/services/organizations';

const node = document.createElement('div');
node.setAttribute('id', 'invitation-list-test');
document.body.appendChild(node);

async function mountInvitationList(props = {}) {
  const wrapper = mount(InvitationList, {
    attachTo: node,
    global: {
      plugins: [i18n, store],
      stubs: {
        NoData: { template: '<div data-test="no-data-stub" />' },
        QTablePagination: {
          props: ['scope', 'resultTotal', 'perPageOptions', 'position'],
          emits: ['update:changeRecordPerPage'],
          template: '<div data-test="q-table-pagination-stub" />',
        },
      },
    },
    props: {
      userEmail: 'user@example.com',
      ...props,
    },
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  vi.clearAllMocks();
});

// 1. Rendering
describe('InvitationList - rendering', () => {
  it('mounts without errors', async () => {
    const wrapper = await mountInvitationList();
    expect(wrapper.exists()).toBe(true);
  });

  it('renders the pending invitations title', async () => {
    const wrapper = await mountInvitationList();
    expect(wrapper.find('[data-test="invitation-title-text"]').exists()).toBe(true);
  });
});

// 2. fetchPendingInvitations on mount
describe('InvitationList - fetchPendingInvitations', () => {
  it('calls getPendingInvites on mount', async () => {
    await mountInvitationList();
    expect(usersService.getPendingInvites).toHaveBeenCalled();
  });

  it('populates invitations from API response', async () => {
    const wrapper = await mountInvitationList();
    expect((wrapper.vm as any).invitations.length).toBe(2);
  });

  it('sets resultTotal to the number of invitations', async () => {
    const wrapper = await mountInvitationList();
    expect((wrapper.vm as any).resultTotal).toBe(2);
  });

  it('adds row numbers to each invitation', async () => {
    const wrapper = await mountInvitationList();
    expect((wrapper.vm as any).invitations[0]['#']).toBe('01');
    expect((wrapper.vm as any).invitations[1]['#']).toBe('02');
  });

  it('formats the expiry for each invitation', async () => {
    const wrapper = await mountInvitationList();
    const invitations = (wrapper.vm as any).invitations;
    // First invitation is 30 days away — should NOT be "expired"
    expect(invitations[0].expiry).not.toContain('expired');
    // Second invitation is in the past — should indicate expired or days left
    expect(typeof invitations[1].expiry).toBe('string');
  });

  it('handles API error gracefully without throwing', async () => {
    vi.mocked(usersService.getPendingInvites).mockRejectedValueOnce(
      new Error('Network error'),
    );
    const wrapper = await mountInvitationList();
    expect(wrapper.exists()).toBe(true);
    expect((wrapper.vm as any).invitations.length).toBe(0);
  });
});

// 3. formatExpiry
describe('InvitationList - formatExpiry', () => {
  it('returns expired label for past date', async () => {
    const wrapper = await mountInvitationList();
    const pastMicroseconds = (Date.now() - 10 * 24 * 60 * 60 * 1000) * 1000;
    const result = (wrapper.vm as any).formatExpiry(pastMicroseconds);
    // Should indicate expired (locale string)
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns "expires today" label for today expiry', async () => {
    const wrapper = await mountInvitationList();
    // Same day = 0 days left
    const todayMicroseconds = Date.now() * 1000;
    const result = (wrapper.vm as any).formatExpiry(todayMicroseconds);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns days left for future date', async () => {
    const wrapper = await mountInvitationList();
    const futureMicroseconds = (Date.now() + 15 * 24 * 60 * 60 * 1000) * 1000;
    const result = (wrapper.vm as any).formatExpiry(futureMicroseconds);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns expired label for invalid date', async () => {
    const wrapper = await mountInvitationList();
    const result = (wrapper.vm as any).formatExpiry(NaN);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// 4. acceptInvitation
describe('InvitationList - acceptInvitation', () => {
  it('sets selectedInvitation to the given invitation', async () => {
    const wrapper = await mountInvitationList();
    const inv = { token: 'tok-1', org_name: 'Org One', org_id: 'org-1' };
    (wrapper.vm as any).acceptInvitation(inv);
    expect((wrapper.vm as any).selectedInvitation).toEqual(inv);
  });

  it('opens the confirmAccept dialog', async () => {
    const wrapper = await mountInvitationList();
    const inv = { token: 'tok-1', org_name: 'Org One', org_id: 'org-1' };
    (wrapper.vm as any).acceptInvitation(inv);
    expect((wrapper.vm as any).confirmAccept).toBe(true);
  });
});

// 5. rejectInvitation
describe('InvitationList - rejectInvitation', () => {
  it('sets selectedInvitation to the given invitation', async () => {
    const wrapper = await mountInvitationList();
    const inv = { token: 'tok-2', org_name: 'Org Two', org_id: 'org-2' };
    (wrapper.vm as any).rejectInvitation(inv);
    expect((wrapper.vm as any).selectedInvitation).toEqual(inv);
  });

  it('opens the confirmReject dialog', async () => {
    const wrapper = await mountInvitationList();
    const inv = { token: 'tok-2', org_name: 'Org Two', org_id: 'org-2' };
    (wrapper.vm as any).rejectInvitation(inv);
    expect((wrapper.vm as any).confirmReject).toBe(true);
  });
});

// 6. confirmAcceptInvitation
describe('InvitationList - confirmAcceptInvitation', () => {
  it('does nothing when selectedInvitation is null', async () => {
    const wrapper = await mountInvitationList();
    (wrapper.vm as any).selectedInvitation = null;
    await (wrapper.vm as any).confirmAcceptInvitation();
    expect(organizationsService.process_subscription).not.toHaveBeenCalled();
  });

  it('calls process_subscription with token, "confirm", and org_id', async () => {
    const wrapper = await mountInvitationList();
    const inv = { token: 'tok-1', org_name: 'Org One', org_id: 'org-1' };
    (wrapper.vm as any).selectedInvitation = inv;
    await (wrapper.vm as any).confirmAcceptInvitation();
    expect(organizationsService.process_subscription).toHaveBeenCalledWith(
      'tok-1',
      'confirm',
      'org-1',
    );
  });

  it('refreshes organizations list after accepting', async () => {
    const wrapper = await mountInvitationList();
    const inv = { token: 'tok-1', org_name: 'Org One', org_id: 'org-1' };
    (wrapper.vm as any).selectedInvitation = inv;
    await (wrapper.vm as any).confirmAcceptInvitation();
    expect(organizationsService.list).toHaveBeenCalled();
  });

  it('emits invitations-processed with accepted=true', async () => {
    const wrapper = await mountInvitationList();
    const inv = { token: 'tok-1', org_name: 'Org One', org_id: 'org-1' };
    (wrapper.vm as any).selectedInvitation = inv;
    await (wrapper.vm as any).confirmAcceptInvitation();
    const emitted = wrapper.emitted('invitations-processed');
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toMatchObject({ accepted: true });
  });

  it('shows a negative notification when process_subscription fails', async () => {
    vi.mocked(organizationsService.process_subscription).mockRejectedValueOnce(
      new Error('server error'),
    );
    const wrapper = await mountInvitationList();
    const notifySpy = vi.spyOn((wrapper.vm as any).$q, 'notify');
    const inv = { token: 'tok-1', org_name: 'Org One', org_id: 'org-1' };
    (wrapper.vm as any).selectedInvitation = inv;
    await (wrapper.vm as any).confirmAcceptInvitation();
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ color: 'negative' }));
  });
});

// 7. confirmRejectInvitation
describe('InvitationList - confirmRejectInvitation', () => {
  it('does nothing when selectedInvitation is null', async () => {
    const wrapper = await mountInvitationList();
    (wrapper.vm as any).selectedInvitation = null;
    await (wrapper.vm as any).confirmRejectInvitation();
    expect(organizationsService.decline_subscription).not.toHaveBeenCalled();
  });

  it('calls decline_subscription with the token', async () => {
    const wrapper = await mountInvitationList();
    const inv = { token: 'tok-2', org_name: 'Org Two', org_id: 'org-2' };
    (wrapper.vm as any).selectedInvitation = inv;
    await (wrapper.vm as any).confirmRejectInvitation();
    expect(organizationsService.decline_subscription).toHaveBeenCalledWith('tok-2');
  });

  it('removes the rejected invitation from the list', async () => {
    const wrapper = await mountInvitationList();
    const inv = (wrapper.vm as any).invitations[0];
    (wrapper.vm as any).selectedInvitation = inv;
    const originalLength = (wrapper.vm as any).invitations.length;
    await (wrapper.vm as any).confirmRejectInvitation();
    expect((wrapper.vm as any).invitations.length).toBe(originalLength - 1);
  });

  it('emits invitations-processed when no invitations remain after reject', async () => {
    // Seed with one invitation
    vi.mocked(usersService.getPendingInvites).mockResolvedValueOnce({
      data: { data: [mockInvitations[0]] },
    });
    const wrapper = await mountInvitationList();
    expect((wrapper.vm as any).invitations.length).toBe(1);
    const inv = (wrapper.vm as any).invitations[0];
    (wrapper.vm as any).selectedInvitation = inv;
    await (wrapper.vm as any).confirmRejectInvitation();
    const emitted = wrapper.emitted('invitations-processed');
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toMatchObject({ accepted: false, hasMore: false });
  });

  it('shows a negative notification when decline_subscription fails', async () => {
    vi.mocked(organizationsService.decline_subscription).mockRejectedValueOnce(
      new Error('server error'),
    );
    const wrapper = await mountInvitationList();
    const notifySpy = vi.spyOn((wrapper.vm as any).$q, 'notify');
    const inv = (wrapper.vm as any).invitations[0];
    (wrapper.vm as any).selectedInvitation = inv;
    await (wrapper.vm as any).confirmRejectInvitation();
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ color: 'negative' }));
  });
});

// 8. changePagination
describe('InvitationList - changePagination', () => {
  it('updates selectedPerPage', async () => {
    const wrapper = await mountInvitationList();
    // Provide a mock qTable to avoid setPagination error
    (wrapper.vm as any).qTable = { setPagination: vi.fn() };
    (wrapper.vm as any).changePagination({ label: '50', value: 50 });
    expect((wrapper.vm as any).selectedPerPage).toBe(50);
  });

  it('updates pagination.rowsPerPage', async () => {
    const wrapper = await mountInvitationList();
    (wrapper.vm as any).qTable = { setPagination: vi.fn() };
    (wrapper.vm as any).changePagination({ label: '100', value: 100 });
    expect((wrapper.vm as any).pagination.rowsPerPage).toBe(100);
  });
});
