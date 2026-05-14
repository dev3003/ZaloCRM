/**
 * Composable for ChatContactPanel state and actions:
 * - Form population from contact
 * - Save contact info
 * - Fetch appointments for contact
 */
import { ref, watch, reactive } from 'vue';
import { useContacts, type Contact } from '@/composables/use-contacts';
import { api } from '@/api/index';
import { zaloFriendsApi } from '@/api/zalo-friends';
import type { Appointment } from '@/types/appointment';

export function useChatContactPanel(
  getContactId: () => string | null,
  getContact: () => Contact | null,
  getAccountId: () => string | null | undefined,
  onSaved?: (contact: Contact) => void,
) {
  const { updateContact, fetchContact } = useContacts();

  // Global listener for friend events to update UI in real-time
  const onFriendEvent = (e: any) => {
    const data = e.detail;
    const contact = getContact();
    // Check if the event is related to the current contact
    const fromUid = data.fromUid || data.data?.fromUid;
    if (contact?.zaloUid && (fromUid === contact.zaloUid || data.data === contact.zaloUid)) {
      console.log('[panel] refreshing friend status due to event:', data.type);
      fetchFriendStatus();
    }
  };

  window.addEventListener('zalo:friend-event', onFriendEvent);

  const saving = ref(false);
  const saveSuccess = ref(false);
  const saveError = ref(false);
  const contactAppointments = ref<Appointment[]>([]);

  const friendStatus = ref<{
    is_friend: number;
    is_requested: number;
    is_requesting: number;
  } | null>(null);
  const loadingFriendStatus = ref(false);

  const form = reactive({
    fullName: '',
    phone: '',
    email: '',
    source: null as string | null,
    status: null as string | null,
    nextAppointmentDate: '',
    firstContactDate: '',
    tags: [] as string[],
    notes: '',
    adminCustomerId: '' as string | null,
  });

  function populateForm(c: Contact) {
    form.fullName = c.fullName ?? '';
    form.phone = c.phone ?? '';
    form.email = c.email ?? '';
    form.adminCustomerId = c.adminCustomerId || c.crm_name || '';
    form.source = c.source ?? null;
    form.status = c.status ?? null;
    form.nextAppointmentDate = c.nextAppointment
      ? new Date(c.nextAppointment).toISOString().split('T')[0]
      : '';
    form.firstContactDate = c.firstContactDate
      ? new Date(c.firstContactDate).toISOString().split('T')[0]
      : '';
    form.tags = Array.isArray(c.tags) ? [...c.tags] : [];
    form.notes = c.notes ?? '';
  }

  async function fetchContactExtras(contactId: string) {
    try {
      const res = await api.get(`/contacts/${contactId}/appointments`);
      contactAppointments.value = res.data.appointments ?? [];
    } catch (err) {
      console.error('fetchContactExtras error:', err);
    }
  }

  async function reloadAppointments() {
    const id = getContactId();
    if (!id) return;
    try {
      const res = await api.get(`/contacts/${id}/appointments`);
      contactAppointments.value = res.data.appointments ?? [];
    } catch (err) {
      console.error('reloadAppointments error:', err);
    }
  }

  watch(getContact, (c) => {
    if (!c) return;
    populateForm(c);
    fetchContactExtras(c.id);
    fetchFriendStatus();
  }, { immediate: true, deep: true });

  async function fetchFriendStatus() {
    const contact = getContact();
    const accountId = getAccountId();
    if (!contact?.zaloUid || !accountId) {
      friendStatus.value = null;
      return;
    }

    loadingFriendStatus.value = true;
    try {
      const res = await zaloFriendsApi.getStatus(accountId, contact.zaloUid);
      friendStatus.value = res.data;
    } catch (err) {
      console.error('fetchFriendStatus error:', err);
    } finally {
      loadingFriendStatus.value = false;
    }
  }

  async function sendFriendRequest() {
    const contact = getContact();
    const accountId = getAccountId();
    if (!contact?.zaloUid || !accountId) return;

    try {
      await zaloFriendsApi.sendRequest(accountId, contact.zaloUid);
      await fetchFriendStatus();
    } catch (err) {
      console.error('sendFriendRequest error:', err);
    }
  }

  async function acceptFriendRequest() {
    const contact = getContact();
    const accountId = getAccountId();
    if (!contact?.zaloUid || !accountId) return;

    try {
      await zaloFriendsApi.acceptRequest(accountId, contact.zaloUid);
      await fetchFriendStatus();
    } catch (err) {
      console.error('acceptFriendRequest error:', err);
    }
  }

  async function rejectFriendRequest() {
    const contact = getContact();
    const accountId = getAccountId();
    if (!contact?.zaloUid || !accountId) return;

    try {
      await zaloFriendsApi.rejectRequest(accountId, contact.zaloUid);
      await fetchFriendStatus();
    } catch (err) {
      console.error('rejectFriendRequest error:', err);
    }
  }

  async function saveContact() {
    const contactId = getContactId();
    if (!contactId) return;
    saving.value = true;
    saveSuccess.value = false;
    saveError.value = false;

    const result = await updateContact(contactId, {
      fullName: form.fullName || null,
      phone: form.phone || null,
      email: form.email || null,
      source: form.source || null,
      status: form.status || null,
      nextAppointment: form.nextAppointmentDate
        ? new Date(form.nextAppointmentDate + 'T00:00:00').toISOString()
        : null,
      firstContactDate: form.firstContactDate
        ? new Date(form.firstContactDate + 'T00:00:00').toISOString()
        : null,
      tags: form.tags,
      notes: form.notes || null,
      adminCustomerId: form.adminCustomerId || null,
    });

    saving.value = false;
    if (result) {
      const fresh = await fetchContact(contactId);
      if (fresh) populateForm(fresh);
      saveSuccess.value = true;
      onSaved?.(result);
      setTimeout(() => { saveSuccess.value = false; }, 2500);
    } else {
      saveError.value = true;
    }
  }

  function cleanup() {
    window.removeEventListener('zalo:friend-event', onFriendEvent);
  }

  return {
    form,
    saving, saveSuccess, saveError,
    contactAppointments,
    friendStatus, loadingFriendStatus,
    saveContact, reloadAppointments,
    sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
    cleanup,
  };
}
