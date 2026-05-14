<template>
  <div>
    <div class="d-flex align-center mb-4">
      <span class="text-h6">Danh sách đội nhóm</span>
      <v-spacer />
      <v-btn v-if="authStore.canManageOrganization" color="primary" prepend-icon="mdi-plus" @click="openCreate">
        Thêm đội nhóm
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable @click:close="error = ''">
      {{ error }}
    </v-alert>

    <v-progress-linear v-if="loading" indeterminate color="cyan" class="mb-2" />

    <div v-if="teams.length === 0 && !loading" class="text-center py-8 text-medium-emphasis">
      Chưa có đội nhóm nào
    </div>

    <v-expansion-panels v-model="expandedPanel" variant="accordion">
      <v-expansion-panel v-for="team in teams" :key="team.id" @click="onPanelClick(team.id)">
        <v-expansion-panel-title>
          <div class="d-flex align-center w-100">
            <v-icon class="mr-2" color="cyan">mdi-account-group</v-icon>
            <span class="font-weight-medium">{{ team.name }}</span>
            <v-chip size="x-small" color="cyan" class="ml-2" variant="flat" v-if="team.leader">
              Lead: {{ team.leader.fullName }}
            </v-chip>
            <v-chip size="x-small" class="ml-2" variant="tonal">
              {{ memberMap[team.id]?.length ?? team.users?.length ?? 0 }} thành viên
            </v-chip>
            <v-spacer />
            <template v-if="authStore.canManageOrganization">
              <v-btn icon size="x-small" variant="text" class="mr-1" @click.stop="openEdit(team)" title="Sửa">
                <v-icon>mdi-pencil</v-icon>
              </v-btn>
              <v-btn icon size="x-small" variant="text" color="error" @click.stop="openDelete(team)" title="Xóa">
                <v-icon>mdi-delete</v-icon>
              </v-btn>
            </template>
          </div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="d-flex flex-wrap gap-2 mb-3">
            <v-chip
              v-for="m in memberMap[team.id] ?? team.users ?? []"
              :key="m.id"
              :color="m.role === 'leader' ? 'cyan' : 'default'"
              :variant="m.role === 'leader' ? 'flat' : 'tonal'"
              :closable="authStore.canManageOrganization && m.role !== 'leader'"
              @click:close="confirmRemoveMember(team, m)"
            >
              <v-avatar start v-if="m.role === 'leader'">
                <v-icon>mdi-account-star</v-icon>
              </v-avatar>
              <v-avatar start v-else>
                <v-icon>mdi-account</v-icon>
              </v-avatar>
              <span :class="{ 'font-weight-bold': m.role === 'leader' }">{{ m.fullName }}</span>
              <v-tooltip activator="parent" location="top" v-if="m.role !== 'leader' && authStore.canManageOrganization">
                <v-btn size="x-small" variant="text" color="cyan" icon @click.stop="handlePromoteLeader(team.id, m.id)">
                  <v-icon>mdi-star-plus</v-icon>
                </v-btn>
                Chỉ định Lead
              </v-tooltip>
            </v-chip>
            <span v-if="!(memberMap[team.id] ?? team.users)?.length" class="text-medium-emphasis text-body-2">
              Chưa có thành viên
            </span>
          </div>
          <v-btn v-if="authStore.canManageOrganization" size="small" variant="tonal" prepend-icon="mdi-account-plus" @click="openAddMember(team)">
            Thêm thành viên
          </v-btn>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <!-- Create team dialog -->
    <v-dialog v-model="showCreate" max-width="400">
      <v-card>
        <v-card-title>Thêm đội nhóm</v-card-title>
        <v-card-text>
          <v-text-field v-model="teamName" label="Tên đội nhóm *" autofocus @keyup.enter="handleCreate" />
          <v-select
            v-model="leaderId"
            :items="leaderUsers"
            item-title="fullName"
            item-value="id"
            label="Chỉ định Leader"
            placeholder="Chọn leader (tùy chọn)"
            clearable
          />
          <v-alert v-if="dialogError" type="error" density="compact" class="mt-2">{{ dialogError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showCreate = false">Hủy</v-btn>
          <v-btn color="primary" :loading="saving" @click="handleCreate">Tạo</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Edit team dialog -->
    <v-dialog v-model="showEdit" max-width="400">
      <v-card>
        <v-card-title>Sửa đội nhóm</v-card-title>
        <v-card-text>
          <v-text-field v-model="teamName" label="Tên đội nhóm *" autofocus @keyup.enter="handleUpdate" />
          <v-select
            v-model="leaderId"
            :items="leaderUsers"
            item-title="fullName"
            item-value="id"
            label="Thay đổi Leader"
            placeholder="Chọn leader mới"
            clearable
          />
          <v-alert v-if="dialogError" type="error" density="compact" class="mt-2">{{ dialogError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showEdit = false">Hủy</v-btn>
          <v-btn color="primary" :loading="saving" @click="handleUpdate">Lưu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete confirm dialog -->
    <v-dialog v-model="showDelete" max-width="400">
      <v-card>
        <v-card-title>Xác nhận xóa</v-card-title>
        <v-card-text>Bạn có chắc muốn xóa đội nhóm "{{ selectedTeam?.name }}"?</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showDelete = false">Hủy</v-btn>
          <v-btn color="error" :loading="saving" @click="handleDelete">Xóa</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Add member dialog -->
    <v-dialog v-model="showAddMember" max-width="420">
      <v-card>
        <v-card-title>Thêm thành viên</v-card-title>
        <v-card-text>
          <v-select
            v-model="selectedUserId"
            :items="availableUsers"
            item-title="fullName"
            item-value="id"
            label="Chọn nhân viên"
            no-data-text="Không có nhân viên để thêm"
          />
          <v-alert v-if="dialogError" type="error" density="compact" class="mt-2">{{ dialogError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showAddMember = false">Hủy</v-btn>
          <v-btn color="primary" :loading="saving" @click="handleAddMember">Thêm</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Premium Confirm Member Removal Dialog -->
    <v-dialog v-model="showConfirmRemove" max-width="440" transition="dialog-bottom-transition">
      <v-card class="premium-card overflow-hidden">
        <div class="gradient-header py-4 px-6 d-flex align-center">
          <v-icon color="white" class="mr-3">mdi-account-remove-outline</v-icon>
          <span class="text-h6 font-weight-bold text-white">Xác nhận gỡ thành viên</span>
        </div>
        
        <v-card-text class="pt-6 pb-4">
          <p class="text-body-1 mb-2">
            Bạn có chắc chắn muốn gỡ nhân sự 
            <span class="font-weight-bold text-primary">{{ memberToRemove?.fullName }}</span> 
            khỏi nhóm <span class="font-weight-bold">{{ selectedTeam?.name }}</span>?
          </p>
          <p class="text-caption text-medium-emphasis">
            Hành động này sẽ không xóa tài khoản nhân sự, chỉ gỡ họ ra khỏi danh sách nhóm này.
          </p>
        </v-card-text>

        <v-divider />

        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" color="default" @click="showConfirmRemove = false" class="px-6 rounded-lg">
            Hủy bỏ
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            :loading="saving"
            class="px-6 rounded-lg ml-2"
            prepend-icon="mdi-check"
            @click="executeRemoveMember"
          >
            Xác nhận gỡ
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Premium Success Snackbar -->
    <v-snackbar v-model="showSnackbar" :color="snackbarColor" timeout="3000" class="rounded-xl overflow-hidden shadow-lg">
      <div class="d-flex align-center">
        <v-icon class="mr-3" color="white">{{ snackbarIcon }}</v-icon>
        <span class="font-weight-medium">{{ snackbarText }}</span>
      </div>
      <template v-slot:actions>
        <v-btn variant="text" @click="showSnackbar = false">Đóng</v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useTeams, type Team, type TeamMember } from '@/composables/use-teams';
import { useUsers } from '@/composables/use-users';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api/index';

const { teams, loading, error, fetchTeams, createTeam, updateTeam, deleteTeam, fetchMembers, addMember, removeMember } = useTeams();
const { users, fetchUsers } = useUsers();
const authStore = useAuthStore();

const expandedPanel = ref<number | null>(null);
const memberMap = ref<Record<string, TeamMember[]>>({});

const showCreate = ref(false);
const showEdit = ref(false);
const showDelete = ref(false);
const showAddMember = ref(false);
const showConfirmRemove = ref(false);
const showSnackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');
const snackbarIcon = ref('mdi-check-circle');

const saving = ref(false);
const dialogError = ref('');
const teamName = ref('');
const leaderId = ref<string | null>(null);
const selectedTeam = ref<Team | null>(null);
const memberToRemove = ref<TeamMember | null>(null);
const selectedUserId = ref<string>('');



// Only users with 'leader' role
const leaderUsers = computed(() => {
  return users.value.filter((u) => u.role === 'leader');
});

// Users not already in the selected team
const availableUsers = computed(() => {
  if (!selectedTeam.value) return users.value;
  const memberIds = new Set((memberMap.value[selectedTeam.value.id] ?? []).map((m) => m.id));
  return users.value.filter((u) => !memberIds.has(u.id));
});

async function onPanelClick(teamId: string) {
  if (!memberMap.value[teamId]) {
    const rawMembers = await fetchMembers(teamId);
    memberMap.value[teamId] = sortMembers(rawMembers);
  }
}

function sortMembers(members: TeamMember[]) {
  return [...members].sort((a, b) => {
    if (a.role === 'leader') return -1;
    if (b.role === 'leader') return 1;
    return a.fullName.localeCompare(b.fullName);
  });
}

function openCreate() {
  teamName.value = '';
  leaderId.value = null;
  dialogError.value = '';
  showCreate.value = true;
}

function openEdit(team: Team) {
  selectedTeam.value = team;
  teamName.value = team.name;
  leaderId.value = team.leaderId || null;
  dialogError.value = '';
  showEdit.value = true;
}

function openDelete(team: Team) {
  selectedTeam.value = team;
  showDelete.value = true;
}

function openAddMember(team: Team) {
  selectedTeam.value = team;
  selectedUserId.value = '';
  dialogError.value = '';
  showAddMember.value = true;
}

async function handleCreate() {
  if (!teamName.value.trim()) return;
  saving.value = true;
  dialogError.value = '';
  const res = await createTeam(teamName.value.trim(), leaderId.value || undefined);
  saving.value = false;
  if (res.ok) { showCreate.value = false; } else { dialogError.value = res.error || ''; }
}

async function handleUpdate() {
  if (!selectedTeam.value || !teamName.value.trim()) return;
  saving.value = true;
  dialogError.value = '';
  const res = await updateTeam(selectedTeam.value.id, teamName.value.trim(), leaderId.value);
  saving.value = false;
  if (res.ok) { showEdit.value = false; } else { dialogError.value = res.error || ''; }
}

async function handleDelete() {
  if (!selectedTeam.value) return;
  saving.value = true;
  const res = await deleteTeam(selectedTeam.value.id);
  saving.value = false;
  if (res.ok) {
    showDelete.value = false;
    delete memberMap.value[selectedTeam.value.id];
  }
}

async function handleAddMember() {
  if (!selectedTeam.value || !selectedUserId.value) return;
  saving.value = true;
  dialogError.value = '';
  const res = await addMember(selectedTeam.value.id, selectedUserId.value);
  saving.value = false;
  if (res.ok) {
    const rawMembers = await fetchMembers(selectedTeam.value.id);
    memberMap.value[selectedTeam.value.id] = sortMembers(rawMembers);
    showAddMember.value = false;
  } else {
    dialogError.value = res.error || '';
  }
}

function confirmRemoveMember(team: Team, member: TeamMember) {
  selectedTeam.value = team;
  memberToRemove.value = member;
  showConfirmRemove.value = true;
}

async function executeRemoveMember() {
  if (!selectedTeam.value || !memberToRemove.value) return;
  
  saving.value = true;
  const res = await removeMember(selectedTeam.value.id, memberToRemove.value.id);
  saving.value = false;
  
  if (res.ok) {
    const rawMembers = await fetchMembers(selectedTeam.value.id);
    memberMap.value[selectedTeam.value.id] = sortMembers(rawMembers);
    showConfirmRemove.value = false;
    showNotify('Đã gỡ thành viên thành công', 'success', 'mdi-check-circle');
  } else {
    error.value = res.error || 'Lỗi khi gỡ thành viên';
    showConfirmRemove.value = false;
  }
}

function showNotify(text: string, color = 'success', icon = 'mdi-check-circle') {
  snackbarText.value = text;
  snackbarColor.value = color;
  snackbarIcon.value = icon;
  showSnackbar.value = true;
}

async function handlePromoteLeader(teamId: string, userId: string) {
  if (!confirm('Bạn có chắc muốn chỉ định nhân sự này làm Leader của nhóm?')) return;
  
  saving.value = true;
  try {
    // 1. Ensure user has leader role
    await api.put(`/users/${userId}`, { role: 'leader' });
    
    // 2. Assign to team leaderId
    await updateTeam(teamId, undefined as any, userId);
    
    // Refresh
    await fetchTeams();
    const rawMembers = await fetchMembers(teamId);
    memberMap.value[teamId] = sortMembers(rawMembers);
  } catch (err: any) {
    error.value = 'Lỗi khi gán Leader: ' + (err.response?.data?.error || err.message);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await Promise.all([fetchTeams(), fetchUsers()]);
});

defineExpose({
  refresh: async () => {
    await Promise.all([fetchTeams(), fetchUsers()]);
    // Clear member map to force refresh on next panel click or refresh current one
    memberMap.value = {};
    if (expandedPanel.value !== null) {
      // Find the currently expanded team
      const teamId = teams.value[expandedPanel.value as any]?.id;
      if (teamId) {
        const rawMembers = await fetchMembers(teamId);
        memberMap.value[teamId] = sortMembers(rawMembers);
      }
    }
  }
});
</script>

<style scoped>
.premium-card {
  border-radius: 16px !important;
  box-shadow: 0 12px 40px rgba(0,0,0,0.2) !important;
}

.gradient-header {
  background: linear-gradient(135deg, #3B82F6, #1D4ED8);
}

.premium-card.overflow-hidden {
  border: 1px solid rgba(255, 255, 255, 0.1);
}
</style>
