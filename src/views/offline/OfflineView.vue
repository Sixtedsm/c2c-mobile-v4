<template>
  <div class="offline-view container is-fluid">
    <header class="offline-header">
      <h1 class="title is-3">
        <fa-icon icon="download" class="has-text-primary" />
        {{ $gettext('My offline topos') | uppercaseFirstLetter }}
      </h1>
      <div class="offline-status">
        <span :class="$offline.online ? 'tag is-success is-light' : 'tag is-warning'">
          <fa-icon :icon="$offline.online ? 'cloud' : 'plug'" />
          &nbsp;{{ $offline.online ? $gettext('Online') : $gettext('Offline') }}
        </span>
        <span v-if="storageLabel" class="storage-info is-size-7 has-text-grey">{{ storageLabel }}</span>
      </div>
    </header>

    <!-- V4 — two sub-tabs : Sauvegardés (the C2C docs the user pinned)
         and Mes plans (user-authored treks). Saved docs link into the
         new OfflineTopoExperience; plans open the PlanEditor or their
         own experience. -->
    <nav class="offline-tabs">
      <button
        type="button"
        :class="{ 'is-active': tab === 'saved' }"
        @click="tab = 'saved'"
      >
        <fa-icon icon="bookmark" />
        &nbsp;{{ $gettext('Sauvegardés') }}
        <span class="tag is-light">{{ $offline.savedDocs.length }}</span>
      </button>
      <button
        type="button"
        :class="{ 'is-active': tab === 'plans' }"
        @click="tab = 'plans'"
      >
        <fa-icon icon="route" />
        &nbsp;{{ $gettext('Mes plans') }}
        <span class="tag is-light">{{ $offline.plans.length }}</span>
      </button>
    </nav>

    <!-- ── PLANS tab ──────────────────────────────────────────── -->
    <section v-if="tab === 'plans'" class="plans-section">
      <div class="plans-toolbar">
        <router-link :to="{ name: 'plan-new' }" class="button is-primary">
          <fa-icon icon="plus" />&nbsp;{{ $gettext('Nouveau plan') }}
        </router-link>
      </div>

      <div v-if="!$offline.plans.length" class="empty-state has-text-centered">
        <fa-icon icon="route" size="4x" class="has-text-grey-lighter" />
        <p class="title is-5 mt-4">
          {{ $gettext('Aucun plan pour l\'instant.') }}
        </p>
        <p class="subtitle is-6 has-text-grey">
          {{ $gettext('Créez un nouveau plan pour préparer un trek, un raid à ski, un week-end alpinisme — avec tracé sur carte, étapes, notes terrain.') }}
        </p>
      </div>

      <div v-else class="plans-list">
        <article v-for="plan in plansDesc" :key="plan.document_id" class="plan-card">
          <router-link
            :to="{ name: 'offline-topo', params: { type: 'plan', id: plan.document_id, lang: '__' } }"
            class="plan-card-body"
          >
            <div class="plan-card-icon">
              <fa-icon :icon="planIcon(plan)" size="lg" />
            </div>
            <div class="plan-card-content">
              <h3 class="plan-card-title">{{ plan.title || $gettext('Plan sans titre') }}</h3>
              <div class="plan-card-meta">
                <span v-if="plan.discipline" class="tag is-light">{{ $gettext(plan.discipline, 'discipline') }}</span>
                <span v-if="plan.days" class="tag is-light">{{ plan.days }} {{ plan.days > 1 ? $gettext('jours') : $gettext('jour') }}</span>
                <span class="has-text-grey is-size-7">{{ formatDate(plan.updatedAt || plan.savedAt) }}</span>
              </div>
            </div>
          </router-link>
          <div class="plan-card-actions">
            <router-link
              :to="{ name: 'plan-edit', params: { id: plan.document_id } }"
              class="button is-text is-small"
              :title="$gettext('Modifier')"
            >
              <fa-icon icon="edit" />
            </router-link>
            <button
              class="button is-text is-small"
              :title="$gettext('Supprimer')"
              @click="removePlan(plan)"
            >
              <fa-icon icon="trash" />
            </button>
          </div>
        </article>
      </div>
    </section>

    <!-- ── SAVED docs tab ─────────────────────────────────────── -->
    <template v-else>

    <div class="saved-toolbar">
      <button class="button is-small is-primary" @click="openCreateFolderModal">
        <fa-icon icon="plus" />&nbsp;{{ $gettext('New folder') }}
      </button>
    </div>

    <section v-if="$offline.pendingOutings.length" class="pending-outings">
      <header class="pending-outings-header">
        <fa-icon icon="upload" />
        <span class="pending-outings-title">
          {{ $offline.pendingOutings.length }}
          {{ $gettext('outing(s) waiting to be published') }}
        </span>
        <button
          v-if="$offline.online"
          class="button is-small is-primary"
          :disabled="$offline.syncing"
          @click="$offline.syncPendingOutings()"
        >
          <fa-icon icon="rotate" :class="{ 'fa-spin': $offline.syncing }" />
          &nbsp;{{ $offline.syncing ? $gettext('Syncing…') : $gettext('Sync now') }}
        </button>
        <span v-else class="tag is-warning">{{ $gettext('Offline') }}</span>
      </header>
      <ul class="pending-outings-list">
        <li v-for="item in $offline.pendingOutings" :key="item.id" class="pending-outing">
          <span class="pending-outing-title">{{ item.title || $gettext('Untitled outing') }}</span>
          <span v-if="item.attempts > 0" class="tag is-light is-danger is-small">
            {{ $gettext('Attempts:') }} {{ item.attempts }}
          </span>
          <button
            class="button is-small is-text"
            :title="$gettext('Discard this pending outing')"
            @click="discardPending(item.id)"
          >
            <fa-icon icon="trash" />
          </button>
        </li>
      </ul>
    </section>

    <div v-if="!entries.length && !$offline.pendingOutings.length" class="empty-state has-text-centered">
      <fa-icon icon="download" size="4x" class="has-text-grey-lighter" />
      <p class="title is-5 mt-4">
        {{ $gettext('No topos saved for offline use yet.') | uppercaseFirstLetter }}
      </p>
      <p class="subtitle is-6 has-text-grey">
        {{ $gettext('Open a route, waypoint or outing, and tap "Save for offline use" to keep it on this device.') }}
      </p>
      <router-link :to="{ name: 'routes' }" class="button is-primary mt-2">
        {{ $gettext('Browse the topoguide') | uppercaseFirstLetter }}
      </router-link>
    </div>

    <template v-else>
      <section v-for="group in groups" :key="group.id || 'unfiled'" class="offline-section">
        <header class="offline-section-header">
          <button class="offline-section-toggle" @click="toggleCollapse(group.id || 'unfiled')">
            <fa-icon :icon="isCollapsed(group.id || 'unfiled') ? 'chevron-right' : 'chevron-down'" fixed-width />
            <fa-icon :icon="group.id ? 'folder' : 'list'" class="has-text-primary" />
            <span class="offline-section-title">{{ group.name }}</span>
            <span class="tag is-light">{{ group.entries.length }}</span>
          </button>
          <div v-if="group.id" class="offline-section-actions">
            <button class="button is-text is-small" :title="$gettext('Rename folder')" @click="renameFolder(group)">
              <fa-icon icon="edit" />
            </button>
            <button class="button is-text is-small" :title="$gettext('Delete folder')" @click="deleteFolder(group)">
              <fa-icon icon="trash" />
            </button>
          </div>
        </header>

        <div v-if="!isCollapsed(group.id || 'unfiled')" class="offline-grid">
          <article v-for="entry in group.entries" :key="entryKey(entry)" class="offline-card">
            <router-link :to="linkTo(entry)" class="offline-card-body">
              <div class="offline-card-icon">
                <fa-icon :icon="iconFor(entry.type)" size="lg" />
              </div>
              <div class="offline-card-content">
                <h3 class="offline-card-title">{{ titleOf(entry) }}</h3>
                <div class="offline-card-meta">
                  <span class="tag is-light">{{ $gettext(entry.type) }}</span>
                  <span class="tag is-light">{{ entry.lang.toUpperCase() }}</span>
                  <span class="has-text-grey is-size-7">{{ formatDate(entry.savedAt) }}</span>
                </div>
              </div>
            </router-link>
            <div class="offline-card-actions">
              <select
                class="offline-card-select"
                :value="entry.folderId || ''"
                :title="$gettext('Move to folder')"
                @change="moveToFolder(entry, $event.target.value)"
              >
                <option value="">{{ $gettext('No folder') }}</option>
                <option v-for="f in $offline.folders" :key="f.id" :value="f.id">{{ f.name }}</option>
              </select>
              <button
                class="offline-card-remove button is-small is-text"
                :title="$gettext('Remove from offline use')"
                @click="remove(entry)"
              >
                <fa-icon icon="trash" />
              </button>
            </div>
          </article>
        </div>
      </section>
    </template>

    </template> <!-- /tab === 'saved' -->

    <modal-window ref="folderModal" small>
      <template #header>
        {{ folderModalMode === 'rename' ? $gettext('Rename folder') : $gettext('New folder') }}
      </template>
      <input
        ref="folderInput"
        class="input"
        type="text"
        :placeholder="$gettext('Folder name')"
        v-model="folderInputValue"
        @keyup.enter="confirmFolderModal"
      />
      <template #footer>
        <div class="buttons is-right mt-4">
          <button class="button" @click="$refs.folderModal.hide()">{{ $gettext('Cancel') }}</button>
          <button class="button is-primary" :disabled="!folderInputValue.trim()" @click="confirmFolderModal">
            {{ folderModalMode === 'rename' ? $gettext('Rename') : $gettext('Create') }}
          </button>
        </div>
      </template>
    </modal-window>
  </div>
</template>

<script>
import ModalWindow from '@/components/generics/modals/ModalWindow';

import pullRefreshMixin from '@/js/pull-refresh-mixin';

const TYPE_ICONS = {
  route: 'route',
  waypoint: 'map-marker-alt',
  outing: ['document-type', 'outing'],
  article: 'newspaper',
  book: 'atlas',
  image: 'image',
  xreport: 'exclamation-circle',
};

export default {
  name: 'OfflineView',

  components: { ModalWindow },

  mixins: [pullRefreshMixin],

  data() {
    return {
      storage: null,
      collapsed: {},
      folderModalMode: 'create',
      folderInputValue: '',
      folderBeingRenamed: null,
      // V4 — sub-tab Sauvegardés / Mes plans. Persists across visits.
      tab: window.localStorage.getItem('v4.offline.tab') || 'saved',
    };
  },

  watch: {
    tab(v) {
      try { window.localStorage.setItem('v4.offline.tab', v); } catch { /* ignore */ }
    },
  },

  computed: {
    entries() {
      return [...this.$offline.savedDocs].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    },

    groups() {
      const result = [];
      for (const folder of this.$offline.folders) {
        const folderEntries = this.entries.filter((entry) => entry.folderId === folder.id);
        result.push({ id: folder.id, name: folder.name, entries: folderEntries });
      }
      const unfiled = this.entries.filter((entry) => !entry.folderId);
      if (unfiled.length || !result.length) {
        result.push({ id: null, name: this.$gettext('Unfiled'), entries: unfiled });
      }
      return result;
    },

    plansDesc() {
      // Most-recently-updated first.
      return [...this.$offline.plans].sort(
        (a, b) => (b.updatedAt || b.savedAt || 0) - (a.updatedAt || a.savedAt || 0)
      );
    },

    storageLabel() {
      if (!this.storage) {
        return null;
      }
      const { usage, quota } = this.storage;
      if (!usage) {
        return null;
      }
      const used = this.formatBytes(usage);
      if (!quota) {
        return used;
      }
      return `${used} / ${this.formatBytes(quota)}`;
    },
  },

  async mounted() {
    this.storage = await this.$offline.getStorageUsage();
  },

  methods: {
    // Pull-to-refresh handler (#7) — re-reads from IDB and re-checks
    // pending uploads. Returned for the mixin's done-event.
    pullRefresh() {
      return this.$offline.refresh();
    },

    entryKey(entry) {
      return `${entry.type}/${entry.id}/${entry.lang}`;
    },

    linkTo(entry) {
      // V4 — saved topos now open the new OfflineTopoExperience (5
      // swipable views, GPS, notes…) instead of the V1 RouteView /
      // OutingView etc. Same data underneath, dedicated UI for the
      // field.
      return {
        name: 'offline-topo',
        params: { type: entry.type, id: String(entry.id), lang: entry.lang },
      };
    },

    iconFor(type) {
      if (type === 'plan') return 'route';
      return TYPE_ICONS[type] || 'file-download';
    },

    // V4 — plan helpers
    planIcon(plan) {
      switch (plan.discipline) {
        case 'climbing': return 'mountain-sun';
        case 'skitouring': return 'snowflake';
        case 'mountaineering': return 'mountain';
        case 'trek': return 'route';
        default: return 'route';
      }
    },

    async removePlan(plan) {
      const ok = window.confirm(
        this.$gettext('Supprimer le plan "{title}" ? Cette action est irréversible.').replace('{title}', plan.title || '?')
      );
      if (!ok) return;
      await this.$offline.removePlan(plan.document_id);
    },

    titleOf(entry) {
      const data = entry.data;
      if (!data) {
        return this.$gettext('Untitled');
      }
      if (data.cooked?.title) {
        return data.cooked.title;
      }
      if (Array.isArray(data.locales)) {
        const localeMatch = data.locales.find((l) => l.lang === entry.lang) || data.locales[0];
        if (localeMatch?.title) {
          return localeMatch.title;
        }
      }
      return this.$gettext('Untitled');
    },

    formatDate(ts) {
      if (!ts) {
        return '';
      }
      try {
        return new Date(ts).toLocaleDateString(this.$language?.current);
      } catch {
        return new Date(ts).toLocaleDateString();
      }
    },

    formatBytes(bytes) {
      if (!bytes || bytes < 1024) {
        return `${bytes || 0} B`;
      }
      const units = ['KB', 'MB', 'GB'];
      let value = bytes / 1024;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
    },

    isCollapsed(key) {
      return this.collapsed[key] === true;
    },

    toggleCollapse(key) {
      this.$set(this.collapsed, key, !this.collapsed[key]);
    },

    openCreateFolderModal() {
      this.folderModalMode = 'create';
      this.folderInputValue = '';
      this.folderBeingRenamed = null;
      this.$refs.folderModal.show();
      this.$nextTick(() => this.$refs.folderInput?.focus());
    },

    renameFolder(folder) {
      this.folderModalMode = 'rename';
      this.folderInputValue = folder.name;
      this.folderBeingRenamed = folder;
      this.$refs.folderModal.show();
      this.$nextTick(() => this.$refs.folderInput?.focus());
    },

    async confirmFolderModal() {
      const name = this.folderInputValue.trim();
      if (!name) {
        return;
      }
      if (this.folderModalMode === 'rename' && this.folderBeingRenamed) {
        await this.$offline.renameFolder(this.folderBeingRenamed.id, name);
      } else {
        await this.$offline.createFolder(name);
      }
      this.$refs.folderModal.hide();
    },

    async deleteFolder(folder) {
      const message = this.$gettext('Delete this folder? The topos inside will be moved to "Unfiled".');
      if (!window.confirm(message)) {
        return;
      }
      await this.$offline.removeFolder(folder.id);
    },

    async moveToFolder(entry, folderId) {
      await this.$offline.moveDocumentToFolder(entry.type, entry.id, entry.lang, folderId || null);
    },

    async remove(entry) {
      const message = this.$gettext('Remove this topo from offline storage?');
      if (!window.confirm(message)) {
        return;
      }
      await this.$offline.removeDocument(entry.type, entry.id, entry.lang);
      this.storage = await this.$offline.getStorageUsage();
    },

    async discardPending(id) {
      const message = this.$gettext('Discard this outing? Your data will be lost.');
      if (!window.confirm(message)) {
        return;
      }
      await this.$offline.removePendingOuting(id);
    },
  },
};
</script>

<style scoped lang="scss">
.offline-view {
  padding: 1rem;
  max-width: 1200px;
  margin: 0 auto;
}

.offline-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.offline-status {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

// V4 — sub-tabs Sauvegardés / Mes plans
.offline-tabs {
  display: flex;
  gap: 0.3rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);

  button {
    flex: 1 1 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.6rem 0.6rem;
    border: none;
    background: transparent;
    color: #6b6b6b;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    border-bottom: 2px solid transparent;

    &:hover, &:focus { color: #4a4a4a; outline: none; }
    &.is-active {
      color: #ff9933;
      border-bottom-color: #ff9933;
    }
    .tag { background: rgba(0, 0, 0, 0.06); font-size: 0.7rem; }
  }
}

.saved-toolbar,
.plans-toolbar {
  margin-bottom: 0.75rem;
  text-align: right;
}

// V4 — plans list (mirrors offline-grid styling but with a different
// accent so the user instantly distinguishes "mine" from "C2C saved").
.plans-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.plan-card {
  display: flex;
  align-items: stretch;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-left: 3px solid #ff9933;
  border-radius: 8px;
  overflow: hidden;
}

.plan-card-body {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.7rem;
  color: #4a4a4a;
  text-decoration: none;

  &:hover { background: rgba(255, 153, 51, 0.04); }
}

.plan-card-icon {
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #fff5e6;
  color: #ff9933;
  border-radius: 6px;
}

.plan-card-content {
  flex: 1 1 auto;
  min-width: 0;
}

.plan-card-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: #4a4a4a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plan-card-meta {
  margin-top: 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;

  .tag { font-size: 0.65rem; }
}

.plan-card-actions {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  padding: 0.25rem;
  gap: 0.2rem;
}

.empty-state {
  padding: 3rem 1rem;
  border: 2px dashed #e5e5e5;
  border-radius: 12px;
  background: #fafafa;
}

.offline-section {
  margin-bottom: 1.75rem;
}

.offline-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0.2rem;
  border-bottom: 1px solid #ececec;
  margin-bottom: 0.75rem;
}

.offline-section-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-size: 1rem;
  color: $text;
  padding: 0;
}

.offline-section-title {
  font-weight: 600;
}

.offline-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}

.offline-card {
  display: flex;
  align-items: stretch;
  background: $white;
  border: 1px solid #ececec;
  border-radius: 10px;
  overflow: hidden;
  transition: box-shadow 0.15s ease, transform 0.15s ease;

  &:hover {
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
    transform: translateY(-1px);
  }
}

.offline-card-body {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 0.9rem;
  flex: 1;
  color: $text;
  text-decoration: none;
  min-width: 0;
}

.offline-card-icon {
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $color-base-c2c-lighter;
  border-radius: 8px;
  color: $color-base-c2c;
}

.offline-card-content {
  min-width: 0;
  flex: 1;
}

.offline-card-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline-card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.offline-card-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  border-left: 1px solid #f0f0f0;
  padding: 0.25rem;
  gap: 0.2rem;
}

.offline-card-select {
  font-size: 0.75rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: $white;
  max-width: 7.5rem;
}

.offline-card-remove {
  color: $grey;

  &:hover {
    color: $red;
  }
}

.pending-outings {
  margin-bottom: 1.5rem;
  padding: 0.85rem 1rem;
  background: hsl(48, 100%, 95%);
  border-left: 4px solid hsl(48, 100%, 50%);
  border-radius: 6px;
}

.pending-outings-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.pending-outings-title {
  font-weight: 600;
  flex: 1;
}

.pending-outings-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.pending-outing {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0;
  border-top: 1px solid hsl(48, 100%, 88%);

  &:first-child {
    border-top: 0;
  }
}

.pending-outing-title {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
