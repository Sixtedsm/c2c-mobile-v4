<template>
  <div class="offline-topo-experience">
    <!-- Top bar local: titre + bouton "Démarrer/Arrêter la sortie" -->
    <header class="experience-header">
      <button
        type="button"
        class="experience-back"
        :aria-label="$gettext('Retour')"
        @click="goBack"
      >
        <fa-icon icon="chevron-left" />
      </button>
      <div class="experience-title">
        <h1>{{ title }}</h1>
        <p v-if="subtitle" class="experience-subtitle">{{ subtitle }}</p>
      </div>
      <div class="experience-actions">
        <start-outing-control
          v-if="loaded"
          :topo-ref="{ type, id, lang }"
        />
      </div>
    </header>

    <!-- Pager body -->
    <div class="experience-body">
      <swipe-pager :pages="pages" v-model="activePage">
        <template #carte="{ active }">
          <topo-map-view
            v-if="loaded"
            :document="document"
            :discipline="discipline"
            :active="active"
            :type="type"
          />
        </template>

        <template #topo>
          <topo-description-view
            v-if="loaded"
            :document="document"
            :discipline="discipline"
            :type="type"
            :lang="lang"
          />
        </template>

        <template #profil="{ active }">
          <topo-progress-view
            v-if="loaded"
            :document="document"
            :discipline="discipline"
            :active="active"
          />
        </template>

        <template #securite>
          <topo-safety-view
            v-if="loaded"
            :document="document"
            :discipline="discipline"
          />
        </template>

        <template #notes>
          <topo-notes-view
            v-if="loaded"
            :document="document"
            :topo-ref="{ type, id, lang }"
          />
        </template>
      </swipe-pager>
    </div>

    <!-- Loading state -->
    <div v-if="!loaded && !loadError" class="experience-loading">
      <fa-icon icon="circle-notch" spin size="2x" />
      <p>{{ $gettext('Chargement du topo hors-ligne…') }}</p>
    </div>
    <div v-if="loadError" class="experience-error">
      <fa-icon icon="triangle-exclamation" size="2x" />
      <p>{{ $gettext('Ce topo n\'est pas dans vos sauvegardes hors-ligne.') }}</p>
      <button class="button is-primary" @click="goBack">
        {{ $gettext('Retour') }}
      </button>
    </div>
  </div>
</template>

<script>
// V4 — the "mini-app" experience that opens when the user taps a topo
// from their offline saves. Five swipable views: Carte, Topo, Profil,
// Sécurité, Notes. Adapted to the document's discipline so e.g. a
// climbing route shows pitch info on "Topo" instead of trek stages.
//
// Strictly offline-only by design (per V4 brief). The online RouteView /
// OutingView / etc. stay untouched — the user sees those at home; this
// view is for the field.

import SwipePager from '@/components/SwipePager.vue';
import StartOutingControl from '@/components/StartOutingControl.vue';

import TopoMapView from './views/TopoMapView.vue';
import TopoDescriptionView from './views/TopoDescriptionView.vue';
import TopoProgressView from './views/TopoProgressView.vue';
import TopoSafetyView from './views/TopoSafetyView.vue';
import TopoNotesView from './views/TopoNotesView.vue';

// Map an activity (or doc type) onto the discipline label used to
// customize the views. Conservative default: 'hiking' so empty docs
// still render coherently.
function inferDiscipline(doc, type) {
  if (!doc) return 'hiking';
  const acts = Array.isArray(doc.activities) ? doc.activities : [];
  if (acts.includes('skitouring') || acts.includes('snow_ice_mixed') || acts.includes('snowshoeing')) {
    return 'skitouring';
  }
  if (acts.includes('rock_climbing') || acts.includes('ice_climbing') || acts.includes('via_ferrata')) {
    return 'climbing';
  }
  if (acts.includes('mountain_climbing') || acts.includes('mountaineering')) {
    return 'mountaineering';
  }
  if (acts.includes('hiking')) {
    return 'hiking';
  }
  if (type === 'waypoint' || type === 'area') return 'waypoint';
  if (type === 'plan') return 'plan';
  return 'hiking';
}

export default {
  name: 'OfflineTopoExperience',

  components: {
    SwipePager,
    StartOutingControl,
    TopoMapView,
    TopoDescriptionView,
    TopoProgressView,
    TopoSafetyView,
    TopoNotesView,
  },

  data() {
    return {
      document: null,
      loaded: false,
      loadError: false,
      activePage: 0,
    };
  },

  computed: {
    type() {
      return this.$route.params.type;
    },
    id() {
      return this.$route.params.id;
    },
    lang() {
      return this.$route.params.lang;
    },
    discipline() {
      return inferDiscipline(this.document, this.type);
    },

    title() {
      if (!this.document) return this.$gettext('Topo hors-ligne');
      return this.$documentUtils.getDocumentTitle(this.document, this.lang) || this.$gettext('Sans titre');
    },

    subtitle() {
      if (!this.document) return '';
      const parts = [];
      if (this.discipline) parts.push(this.$gettext(this.discipline, 'discipline'));
      if (this.document.elevation_max) parts.push(`↑ ${this.document.elevation_max} m`);
      if (this.document.height_diff_up) parts.push(`+ ${this.document.height_diff_up} m`);
      return parts.join('  ·  ');
    },

    // Adaptive page set: the 5 baseline + per-discipline tweaks.
    // We keep the same keys so the parent slots match; the per-view
    // components themselves render different content based on discipline.
    pages() {
      return [
        { key: 'carte', label: this.$gettext('Carte'), icon: ['fas', 'map-location-dot'] },
        { key: 'topo', label: this.$gettext('Topo'), icon: ['fas', 'book'] },
        { key: 'profil', label: this.$gettext('Profil'), icon: ['fas', 'chart-line'] },
        { key: 'securite', label: this.$gettext('Sécurité'), icon: ['fas', 'triangle-exclamation'] },
        { key: 'notes', label: this.$gettext('Notes'), icon: ['fas', 'pen-to-square'] },
      ];
    },
  },

  async mounted() {
    await this.loadDocument();
    // Restore last-viewed page for this topo (Map by default).
    const key = `v4.offlineTopo.lastPage.${this.type}.${this.id}.${this.lang}`;
    try {
      const stored = parseInt(window.localStorage.getItem(key), 10);
      if (Number.isFinite(stored)) this.activePage = stored;
    } catch {
      /* ignore */
    }
  },

  watch: {
    activePage(v) {
      const key = `v4.offlineTopo.lastPage.${this.type}.${this.id}.${this.lang}`;
      try {
        window.localStorage.setItem(key, String(v));
      } catch {
        /* ignore */
      }
    },
    '$route'() {
      this.loadDocument();
    },
  },

  methods: {
    async loadDocument() {
      this.loaded = false;
      this.loadError = false;
      try {
        const entry = await this.$offline.getDocument(this.type, this.id, this.lang);
        if (entry?.data) {
          this.document = entry.data;
          this.loaded = true;
        } else {
          this.loadError = true;
        }
      } catch {
        this.loadError = true;
      }
    },

    goBack() {
      if (window.history.length > 1) this.$router.back();
      else this.$router.push({ name: 'offline' });
    },
  },
};
</script>

<style lang="scss" scoped>
.offline-topo-experience {
  position: fixed;
  // Sit above the V3 page-content scroll so we can take the full
  // viewport — this is a dedicated mini-app, not a regular scrollable
  // page. BottomNav is replaced by the swipe-pager's own tab bar.
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  background: #fbfaf6;
  display: flex;
  flex-direction: column;
}

.experience-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: calc(0.4rem + env(safe-area-inset-top)) 0.5rem 0.4rem;
  background: white;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  min-height: 52px;
}

.experience-back {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: #4a4a4a;
  font-size: 1.1rem;
  cursor: pointer;
  border-radius: 4px;
  &:hover { background: rgba(0, 0, 0, 0.05); }
}

.experience-title {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;

  h1 {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    color: #4a4a4a;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.experience-subtitle {
  margin: 0.05rem 0 0;
  font-size: 0.72rem;
  color: #6b6b6b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.experience-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
}

.experience-body {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.experience-loading,
.experience-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  background: rgba(255, 255, 255, 0.95);
  color: #6b6b6b;
  text-align: center;
  padding: 1.5rem;
}
</style>

<style lang="scss">
html[data-theme='dark'] {
  .offline-topo-experience {
    background: #1a1a1a;
  }
  .experience-header {
    background: #232323;
    border-bottom-color: rgba(255, 255, 255, 0.08);
  }
  .experience-back { color: #e5e5e5; }
  .experience-title h1 { color: #f5f5f5; }
  .experience-subtitle { color: #9a9a9a; }
  .experience-loading,
  .experience-error {
    background: rgba(20, 20, 20, 0.95);
    color: #b5b5b5;
  }
}
</style>
