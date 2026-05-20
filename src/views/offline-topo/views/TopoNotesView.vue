<template>
  <div class="topo-notes-view">
    <header class="notes-header">
      <h2>
        <fa-icon icon="pen-to-square" />
        &nbsp;{{ $gettext('Mes notes') }}
      </h2>
      <p>
        {{ $gettext('Notes personnelles attachées à ce topo. Restent locales sur cet appareil (synchronisables plus tard avec votre compte Camptocamp).') }}
      </p>
    </header>

    <!-- Quick-add row: tap a chip → adds a templated note with the
         current timestamp. Designed for one-handed use on the field
         where typing is slow. -->
    <div class="notes-quickadd">
      <button
        v-for="chip in quickChips"
        :key="chip.key"
        type="button"
        class="notes-quickadd-chip"
        @click="addQuick(chip)"
      >
        <fa-icon :icon="chip.icon" />
        <span>{{ chip.label }}</span>
      </button>
    </div>

    <!-- Free-text editor -->
    <div class="notes-editor">
      <textarea
        v-model="draft"
        :placeholder="$gettext('Écrire une observation : conditions, repère terrain, point d\'eau, refuge…')"
        rows="3"
      ></textarea>
      <div class="notes-editor-actions">
        <button
          type="button"
          class="button is-small notes-attach-position-btn"
          :disabled="attachingPos"
          @click="attachPosition"
        >
          <fa-icon icon="location-crosshairs" />
          &nbsp;{{ attachingPos ? $gettext('Localisation…') : $gettext('Joindre position') }}
        </button>
        <small v-if="pendingPosition" class="notes-pending-pos">
          {{ pendingPosition.lat.toFixed(5) }}, {{ pendingPosition.lon.toFixed(5) }}
          ({{ Math.round(pendingPosition.accuracy) }} m)
        </small>
        <span class="notes-editor-spacer"></span>
        <button
          type="button"
          class="button is-primary is-small"
          :disabled="!draft.trim()"
          @click="addNote"
        >
          {{ $gettext('Ajouter') }}
        </button>
      </div>
    </div>

    <!-- List of saved notes, newest first -->
    <div class="notes-list">
      <article v-for="note in notesDesc" :key="note.id" class="notes-item">
        <header class="notes-item-header">
          <span class="notes-item-time">{{ formatTime(note.t) }}</span>
          <button
            v-if="note.gps"
            type="button"
            class="notes-item-pos"
            :title="$gettext('Voir sur la carte')"
            @click="openOnMap(note)"
          >
            <fa-icon icon="map-location-dot" />
            {{ note.gps.lat.toFixed(4) }}, {{ note.gps.lon.toFixed(4) }}
          </button>
          <button
            type="button"
            class="notes-item-delete"
            :title="$gettext('Supprimer')"
            @click="deleteNote(note)"
          >
            <fa-icon icon="trash" />
          </button>
        </header>
        <p class="notes-item-body">{{ note.text }}</p>
      </article>

      <p v-if="!notes.length" class="notes-empty">
        {{ $gettext('Pas encore de notes pour ce topo.') }}
      </p>
    </div>
  </div>
</template>

<script>
// V4 — personal notes attached to an offline topo. Stored in
// localStorage under a key derived from {type, id, lang} so multi-user
// devices don't merge.
//
// Data model intentionally close to what a future C2C API endpoint
// would expect (id, t, text, optional gps), so sync becomes a simple
// list-merge later.

function notesKey(ref) {
  return `v4.topoNotes.${ref.type}.${ref.id}.${ref.lang}`;
}

function loadNotes(ref) {
  try {
    const raw = window.localStorage.getItem(notesKey(ref));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveNotes(ref, notes) {
  try {
    window.localStorage.setItem(notesKey(ref), JSON.stringify(notes));
  } catch {
    /* quota — ignore */
  }
}

export default {
  name: 'TopoNotesView',

  props: {
    document: { type: Object, required: true },
    topoRef: { type: Object, required: true },
  },

  data() {
    return {
      draft: '',
      notes: loadNotes(this.topoRef),
      pendingPosition: null,
      attachingPos: false,
    };
  },

  computed: {
    notesDesc() {
      return [...this.notes].sort((a, b) => b.t - a.t);
    },

    quickChips() {
      // Tailored shortcuts to record common field observations in 1 tap.
      // The discipline-aware version below adapts the chips based on
      // the doc's activities — but the baseline is generic enough.
      const base = [
        { key: 'water', icon: ['fas', 'droplet'], label: this.$gettext('Eau OK'), text: 'Point d\'eau fiable' },
        { key: 'no-water', icon: ['fas', 'droplet-slash'], label: this.$gettext('Pas d\'eau'), text: 'Pas d\'eau ici' },
        { key: 'crux', icon: ['fas', 'mountain'], label: this.$gettext('Passage clé'), text: 'Passage technique' },
        { key: 'escape', icon: ['fas', 'arrow-right-from-bracket'], label: this.$gettext('Échappatoire'), text: 'Échappatoire possible' },
        { key: 'refuge', icon: ['fas', 'house'], label: this.$gettext('Refuge'), text: 'Info refuge' },
        { key: 'photo', icon: ['fas', 'camera'], label: this.$gettext('Photo'), text: 'À reprendre en photo' },
      ];
      return base;
    },
  },

  watch: {
    notes: {
      handler(notes) {
        saveNotes(this.topoRef, notes);
      },
      deep: false,
    },
    topoRef: {
      handler(ref) {
        this.notes = loadNotes(ref);
      },
      deep: true,
    },
  },

  methods: {
    addNote() {
      const text = this.draft.trim();
      if (!text) return;
      this.notes = [
        ...this.notes,
        {
          id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          t: Date.now(),
          text,
          gps: this.pendingPosition,
        },
      ];
      this.draft = '';
      this.pendingPosition = null;
    },

    addQuick(chip) {
      this.notes = [
        ...this.notes,
        {
          id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          t: Date.now(),
          text: chip.text,
          gps: this.$outingSession.currentPosition,
          chip: chip.key,
        },
      ];
    },

    deleteNote(note) {
      const ok = window.confirm(this.$gettext('Supprimer cette note ?'));
      if (!ok) return;
      this.notes = this.notes.filter((n) => n.id !== note.id);
    },

    async attachPosition() {
      this.attachingPos = true;
      try {
        const sample = await this.$outingSession.requestCurrentPosition();
        this.pendingPosition = sample;
      } catch {
        window.alert(this.$gettext('Position indisponible. Vérifiez les permissions de géolocalisation.'));
      } finally {
        this.attachingPos = false;
      }
    },

    openOnMap(note) {
      // The Map view is page 0 of the SwipePager — we can't navigate to
      // it from here directly (we don't have the pager ref). Best
      // available: emit on the window so the parent listens.
      window.dispatchEvent(new CustomEvent('v4:focus-on-map', { detail: note.gps }));
    },

    formatTime(t) {
      const d = new Date(t);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${day}/${month} ${hh}:${mm}`;
    },
  },
};
</script>

<style lang="scss" scoped>
.topo-notes-view {
  padding: 0.75rem;
}

.notes-header {
  margin-bottom: 0.75rem;

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    color: #4a4a4a;
  }
  p {
    margin: 0.2rem 0 0;
    font-size: 0.78rem;
    color: #6b6b6b;
    line-height: 1.4;
  }
}

.notes-quickadd {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.6rem;
}

.notes-quickadd-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.65rem;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 999px;
  color: #4a4a4a;
  font-size: 0.78rem;
  cursor: pointer;

  &:hover, &:focus {
    background: #fff5e6;
    border-color: #ff9933;
    outline: none;
  }
}

.notes-editor {
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 0.5rem;
  margin-bottom: 1rem;

  textarea {
    width: 100%;
    border: none;
    background: transparent;
    color: #4a4a4a;
    font: inherit;
    resize: vertical;
    min-height: 60px;
    padding: 0.3rem;

    &:focus { outline: none; }
  }
}

.notes-editor-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.4rem;
}

.notes-editor-spacer { flex: 1 1 auto; }

.notes-pending-pos {
  font-size: 0.7rem;
  color: #6b6b6b;
  font-family: monospace;
}

.notes-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.notes-item {
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 0.5rem 0.6rem;
}

.notes-item-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.3rem;
}

.notes-item-time {
  font-size: 0.72rem;
  color: #6b6b6b;
  font-weight: 600;
}

.notes-item-pos {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: transparent;
  border: none;
  color: #337ab7;
  font-size: 0.7rem;
  cursor: pointer;
  font-family: monospace;
  &:hover { text-decoration: underline; }
}

.notes-item-delete {
  margin-left: auto;
  background: transparent;
  border: none;
  color: #9a9a9a;
  cursor: pointer;
  padding: 0.2rem 0.3rem;
  &:hover { color: #c0392b; }
}

.notes-item-body {
  margin: 0;
  font-size: 0.9rem;
  color: #4a4a4a;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.notes-empty {
  text-align: center;
  color: #9a9a9a;
  font-size: 0.85rem;
  padding: 1rem 0;
  font-style: italic;
  margin: 0;
}
</style>

<style lang="scss">
html[data-theme='dark'] {
  .topo-notes-view {
    .notes-header h2 { color: #f5f5f5; }
    .notes-header p { color: #b5b5b5; }
    .notes-quickadd-chip {
      background: #2a2a2a;
      border-color: rgba(255, 255, 255, 0.1);
      color: #e5e5e5;
      &:hover, &:focus { background: #3a2f1a; border-color: #ff9933; }
    }
    .notes-editor {
      background: #2a2a2a;
      border-color: rgba(255, 255, 255, 0.1);
      textarea { color: #e5e5e5; }
    }
    .notes-pending-pos { color: #9a9a9a; }
    .notes-item {
      background: #2a2a2a;
      border-color: rgba(255, 255, 255, 0.08);
    }
    .notes-item-time { color: #b5b5b5; }
    .notes-item-pos { color: #6db4ff; }
    .notes-item-body { color: #e5e5e5; }
    .notes-empty { color: #6b6b6b; }
  }
}
</style>
