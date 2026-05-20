<template>
  <div class="plan-editor">
    <!-- Top toolbar: title input + save -->
    <header class="plan-editor-header">
      <button
        type="button"
        class="plan-editor-back"
        :aria-label="$gettext('Retour')"
        @click="goBack"
      >
        <fa-icon icon="chevron-left" />
      </button>
      <input
        v-model="plan.title"
        class="plan-editor-title-input"
        :placeholder="$gettext('Titre du plan (ex : Trek Mont Perdu 4j)')"
      />
      <button
        type="button"
        class="button is-primary is-small plan-editor-save"
        :disabled="saving || !plan.title.trim()"
        @click="save"
      >
        <fa-icon icon="bookmark" />
        &nbsp;{{ $gettext('Sauver') }}
      </button>
    </header>

    <!-- Tool strip just under the header: drawing mode toggle, day picker,
         linked-topos count, options -->
    <div class="plan-editor-tools">
      <div class="plan-editor-tools-left">
        <button
          type="button"
          class="plan-tool-btn"
          :class="{ 'is-active': drawingMode === 'on-trail' }"
          :title="$gettext('Tracer en suivant un sentier (snap au plus proche)')"
          @click="setDrawingMode('on-trail')"
        >
          <fa-icon icon="route" />
          <span>{{ $gettext('Sentier') }}</span>
        </button>
        <button
          type="button"
          class="plan-tool-btn"
          :class="{ 'is-active': drawingMode === 'off-trail' }"
          :title="$gettext('Tracer librement (hors sentier — alpinisme, ski, etc.)')"
          @click="setDrawingMode('off-trail')"
        >
          <fa-icon icon="mountain" />
          <span>{{ $gettext('Hors-piste') }}</span>
        </button>
        <button
          type="button"
          class="plan-tool-btn"
          :class="{ 'is-active': drawingMode === 'pan' }"
          :title="$gettext('Déplacer la carte')"
          @click="setDrawingMode('pan')"
        >
          <fa-icon icon="hand" />
        </button>
      </div>

      <div class="plan-editor-tools-right">
        <button
          type="button"
          class="plan-tool-btn is-danger"
          :disabled="!plan.coordinates.length"
          @click="confirmUndoLast"
          :title="$gettext('Retirer le dernier point')"
        >
          <fa-icon icon="rotate-left" />
        </button>
        <button
          type="button"
          class="plan-tool-btn is-danger"
          :disabled="!plan.coordinates.length"
          @click="confirmClearTrace"
          :title="$gettext('Tout effacer')"
        >
          <fa-icon icon="trash" />
        </button>
      </div>
    </div>

    <!-- Drawing mode banner — explains what tapping does. -->
    <div v-if="drawingMode !== 'pan'" class="plan-editor-banner">
      <fa-icon icon="circle-info" />
      &nbsp;
      <template v-if="drawingMode === 'on-trail'">
        {{ $gettext('Tapez sur la carte pour ajouter un point. Le tracé suivra le sentier le plus proche entre deux points (best effort).') }}
      </template>
      <template v-else>
        {{ $gettext('Tapez sur la carte pour ajouter un point. Tracé en ligne droite — adapté aux passages hors sentier.') }}
      </template>
    </div>

    <!-- Map. The actual click handling is wired via OL's `map.on('click')`
         in attachDrawingLayer below — using a Vue @click on this wrapper
         doesn't work because OL's interactions swallow the event. -->
    <div class="plan-editor-map">
      <map-view
        ref="map"
        :documents="documentsForMap"
        :initial-extent="initialExtent"
        @move="onMapMove"
        show-center-on-geolocation
        show-recenter-on
      />

      <!-- HUD: stats + linked topos chip -->
      <div class="plan-editor-hud">
        <div class="plan-editor-hud-stats">
          <div>
            <strong>{{ totalDistanceLabel }}</strong>
            <small>{{ $gettext('Distance') }}</small>
          </div>
          <div>
            <strong>+{{ Math.round(totalClimb) }} m</strong>
            <small>{{ $gettext('Dénivelé+') }}</small>
          </div>
          <div>
            <strong>{{ plan.coordinates.length }}</strong>
            <small>{{ $gettext('Points') }}</small>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom sheet: linked topos + segments/days + general notes -->
    <div class="plan-editor-bottom" :class="{ 'is-expanded': sheetExpanded }">
      <button
        type="button"
        class="plan-editor-sheet-handle"
        @click="sheetExpanded = !sheetExpanded"
      >
        <fa-icon :icon="sheetExpanded ? 'chevron-down' : 'chevron-up'" />
        <span>{{ sheetExpanded ? $gettext('Replier') : $gettext('Détails du plan') }}</span>
      </button>

      <div v-if="sheetExpanded" class="plan-editor-sheet-body">
        <!-- Meta -->
        <section class="plan-section">
          <h3>{{ $gettext('Caractéristiques') }}</h3>
          <div class="plan-meta-grid">
            <label>
              <span>{{ $gettext('Discipline') }}</span>
              <select v-model="plan.discipline">
                <option value="hiking">{{ $gettext('Randonnée') }}</option>
                <option value="trek">{{ $gettext('Trek multi-jours') }}</option>
                <option value="mountaineering">{{ $gettext('Alpinisme') }}</option>
                <option value="climbing">{{ $gettext('Escalade') }}</option>
                <option value="skitouring">{{ $gettext('Ski de rando') }}</option>
                <option value="other">{{ $gettext('Autre') }}</option>
              </select>
            </label>
            <label>
              <span>{{ $gettext('Nombre de jours') }}</span>
              <input type="number" v-model.number="plan.days" min="1" max="60" />
            </label>
          </div>
        </section>

        <!-- Linked topos detected on the trace -->
        <section class="plan-section">
          <h3>
            {{ $gettext('Topos C2C détectés') }}
            <span v-if="detectingTopos" class="plan-detecting">
              <fa-icon icon="circle-notch" spin />
              &nbsp;{{ $gettext('détection…') }}
            </span>
          </h3>
          <p v-if="!plan.linkedTopos.length && !detectingTopos" class="plan-empty-hint">
            {{ $gettext('Aucun topo détecté pour l\'instant. Tracez votre itinéraire et l\'application proposera les topos C2C qui passent par là.') }}
          </p>
          <ul v-else class="plan-linked-topos">
            <li v-for="topo in plan.linkedTopos" :key="topo.document_id + '-' + topo.type">
              <fa-icon :icon="topoIcon(topo)" />
              <a :href="topoUrl(topo)" target="_blank" rel="noopener">
                {{ topoTitle(topo) }}
                <fa-icon icon="up-right-from-square" class="is-size-7" />
              </a>
              <button
                type="button"
                class="plan-linked-remove"
                @click="unlinkTopo(topo)"
                :title="$gettext('Retirer du plan')"
              >
                <fa-icon icon="xmark" />
              </button>
            </li>
          </ul>
          <button
            v-if="plan.coordinates.length > 1 && $offline.online"
            type="button"
            class="button is-small plan-redetect-btn"
            :disabled="detectingTopos"
            @click="detectLinkedTopos"
          >
            <fa-icon icon="rotate" />
            &nbsp;{{ $gettext('Relancer la détection') }}
          </button>
        </section>

        <!-- Stages / days -->
        <section v-if="plan.days > 1" class="plan-section">
          <h3>{{ $gettext('Étapes') }}</h3>
          <p class="plan-empty-hint">
            {{ $gettext('Les notes par étape sont accessibles depuis la mini-app du plan une fois sauvegardé.') }}
          </p>
        </section>

        <!-- General notes -->
        <section class="plan-section">
          <h3>{{ $gettext('Notes générales') }}</h3>
          <textarea
            v-model="plan.generalNotes"
            class="plan-notes-area"
            rows="4"
            :placeholder="$gettext('Matériel, transport, plans B, contacts refuges, points de vigilance…')"
          ></textarea>
        </section>

        <!-- Export -->
        <section class="plan-section plan-section-export">
          <button class="button is-small" @click="exportGpx" :disabled="!plan.coordinates.length">
            <fa-icon icon="download" />
            &nbsp;{{ $gettext('Exporter GPX') }}
          </button>
          <button
            class="button is-small"
            @click="convertToOuting"
            :disabled="!plan.coordinates.length || !$user.isLogged"
            :title="!$user.isLogged ? $gettext('Connexion requise') : ''"
          >
            <fa-icon icon="pen-to-square" />
            &nbsp;{{ $gettext('Convertir en sortie C2C') }}
          </button>
        </section>
      </div>
    </div>
  </div>
</template>

<script>
// V4 — Plan editor. Lets the user trace an itinerary on the map,
// auto-detects C2C topos that match the trace, and stores everything as
// a `plan` doc in the offline cache.
//
// Drawing model: a simple polyline of [lon, lat, alt?] points. Each
// point gets a `mode` ('on-trail' or 'off-trail') matching the drawing
// mode at the time it was added, so a single plan can mix sentier and
// hors-piste segments (the spec from Sixte). We don't actually snap to
// trails — proper routing requires a backend (OSRM / GraphHopper) we
// don't have. Instead, the "on-trail" mode just colors the segment
// blue for the user's clarity and assumes they're picking points on a
// visible trail in the underlying map tiles. A real snap-to-trail
// integration is a v4.1 follow-up.

import c2c from '@/js/apis/c2c';
import ol from '@/js/libs/ol';
import { toast } from 'bulma-toast';

const PROJ_LATLNG = 'EPSG:4326';
const PROJ_MERCATOR = 'EPSG:3857';

// Haversine — meters between two [lon, lat] coords.
function haversine(a, b) {
  if (!a || !b) return 0;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Build a bounding box (lon/lat) from a list of points, optionally padded.
function bbox(points, padDeg = 0) {
  if (!points.length) return null;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const p of points) {
    if (p[0] < minLon) minLon = p[0];
    if (p[1] < minLat) minLat = p[1];
    if (p[0] > maxLon) maxLon = p[0];
    if (p[1] > maxLat) maxLat = p[1];
  }
  return [minLon - padDeg, minLat - padDeg, maxLon + padDeg, maxLat + padDeg];
}

// Map activity → discipline.
function disciplineGuess(linkedTopos) {
  const counts = {};
  for (const t of linkedTopos) {
    for (const a of t.activities || []) {
      counts[a] = (counts[a] || 0) + 1;
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const a = top[0];
  if (['skitouring', 'snowshoeing'].includes(a)) return 'skitouring';
  if (['mountain_climbing', 'mountaineering'].includes(a)) return 'mountaineering';
  if (['rock_climbing', 'ice_climbing', 'via_ferrata'].includes(a)) return 'climbing';
  if (a === 'hiking') return 'hiking';
  return null;
}

export default {
  name: 'PlanEditor',

  data() {
    return {
      plan: {
        document_id: null,
        title: '',
        discipline: 'hiking',
        days: 1,
        // [{ lon, lat, alt?, mode: 'on-trail' | 'off-trail' }]
        coordinates: [],
        linkedTopos: [],
        generalNotes: '',
        createdAt: null,
        updatedAt: null,
      },
      drawingMode: 'on-trail',
      saving: false,
      detectingTopos: false,
      sheetExpanded: false,
      // Stores the OpenLayers Feature we draw the trace into.
      traceFeature: null,
      traceLayer: null,
      initialExtent: null,
    };
  },

  computed: {
    documentsForMap() {
      // Show linked topos as document features on the map.
      return this.plan.linkedTopos;
    },

    totalDistance() {
      let d = 0;
      for (let i = 1; i < this.plan.coordinates.length; i += 1) {
        const a = this.plan.coordinates[i - 1];
        const b = this.plan.coordinates[i];
        d += haversine([a.lon, a.lat], [b.lon, b.lat]);
      }
      return d;
    },

    totalDistanceLabel() {
      const m = this.totalDistance;
      if (!m) return '0';
      if (m < 1000) return `${Math.round(m)} m`;
      return `${(m / 1000).toFixed(1)} km`;
    },

    totalClimb() {
      let g = 0;
      for (let i = 1; i < this.plan.coordinates.length; i += 1) {
        const da = (this.plan.coordinates[i].alt || 0) - (this.plan.coordinates[i - 1].alt || 0);
        if (da > 0) g += da;
      }
      return g;
    },
  },

  async mounted() {
    if (this.$route.params.id) {
      // Loading existing plan
      const existing = await this.$offline.getPlan(this.$route.params.id);
      if (existing) {
        this.plan = { ...this.plan, ...existing };
      }
    }
    this.$nextTick(() => this.attachDrawingLayer());
  },

  watch: {
    'plan.coordinates'() {
      this.refreshTraceFeature();
    },
  },

  methods: {
    setDrawingMode(mode) {
      this.drawingMode = mode;
    },

    onMapSingleClick(evt) {
      if (this.drawingMode === 'pan') return;
      const coord3857 = evt.coordinate;
      if (!coord3857) return;
      const [lon, lat] = ol.proj.toLonLat(coord3857);
      this.plan.coordinates = [
        ...this.plan.coordinates,
        { lon, lat, alt: null, mode: this.drawingMode },
      ];
      // Debounced detection — only kick off after ≥ 2 points and online.
      if (this.plan.coordinates.length >= 2 && this.$offline.online) {
        this.scheduleTopoDetection();
      }
    },

    onMapMove(extent) {
      // Used by OlMap component — we don't need it but it's required.
      void extent;
    },

    attachDrawingLayer() {
      const olMap = this.$refs.map?.map;
      if (!olMap) {
        // The OlMap component sometimes initializes asynchronously —
        // retry a couple of times before giving up.
        if (!this._attachRetries) this._attachRetries = 0;
        if (this._attachRetries < 10) {
          this._attachRetries += 1;
          window.setTimeout(() => this.attachDrawingLayer(), 200);
        }
        return;
      }
      // VectorLayer with a single Feature representing the trace.
      const source = new ol.source.Vector();
      const layer = new ol.layer.Vector({
        source,
        style: this.traceStyleFn(),
        zIndex: 100,
      });
      olMap.addLayer(layer);
      this.traceLayer = layer;

      // Wire the map-level click for our drawing tool. OL's pan/zoom
      // interactions don't interfere with `singleclick` (it fires on
      // tap end, not on drag).
      olMap.on('singleclick', this.onMapSingleClick);

      this.refreshTraceFeature();
      // If we're editing an existing plan, frame the map on the trace.
      if (this.plan.coordinates.length > 1) {
        this.fitToTrace();
      }
    },

    fitToTrace() {
      const olMap = this.$refs.map?.map;
      if (!olMap || this.plan.coordinates.length < 2) return;
      const coords = this.plan.coordinates.map((p) =>
        ol.proj.fromLonLat([p.lon, p.lat])
      );
      const extent = ol.extent.boundingExtent(coords);
      const padded = ol.extent.buffer(extent, 200); // 200 m around
      olMap.getView().fit(padded, { padding: [40, 40, 40, 40], duration: 400 });
    },

    refreshTraceFeature() {
      if (!this.traceLayer) return;
      const source = this.traceLayer.getSource();
      source.clear();
      const coords = this.plan.coordinates;
      if (coords.length < 1) return;
      // Build per-segment features so we can style on-trail vs off-trail
      // differently. Also add a Point feature at each user-added vertex
      // for visibility.
      for (let i = 1; i < coords.length; i += 1) {
        const a = ol.proj.fromLonLat([coords[i - 1].lon, coords[i - 1].lat]);
        const b = ol.proj.fromLonLat([coords[i].lon, coords[i].lat]);
        const segMode = coords[i].mode || 'on-trail';
        const f = new ol.Feature({
          geometry: new ol.geom.LineString([a, b]),
          mode: segMode,
        });
        source.addFeature(f);
      }
      // Vertex points
      for (let i = 0; i < coords.length; i += 1) {
        const xy = ol.proj.fromLonLat([coords[i].lon, coords[i].lat]);
        const f = new ol.Feature({ geometry: new ol.geom.Point(xy), vertex: true });
        source.addFeature(f);
      }
    },

    traceStyleFn() {
      return (feature) => {
        if (feature.get('vertex')) {
          return new ol.style.Style({
            image: new ol.style.Circle({
              radius: 5,
              fill: new ol.style.Fill({ color: '#ff9933' }),
              stroke: new ol.style.Stroke({ color: 'white', width: 2 }),
            }),
          });
        }
        const mode = feature.get('mode');
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: mode === 'off-trail' ? '#c0392b' : '#337ab7',
            width: 4,
            lineDash: mode === 'off-trail' ? [6, 6] : undefined,
          }),
        });
      };
    },

    scheduleTopoDetection() {
      if (this._detectTimer) window.clearTimeout(this._detectTimer);
      this._detectTimer = window.setTimeout(() => this.detectLinkedTopos(), 800);
    },

    async detectLinkedTopos() {
      if (!this.plan.coordinates.length || !this.$offline.online) return;
      this.detectingTopos = true;
      try {
        const pts = this.plan.coordinates.map((p) => [p.lon, p.lat]);
        const bb = bbox(pts, 0.005); // ~500 m pad
        if (!bb) return;
        // C2C API expects bbox in EPSG:3857. Convert.
        const sw = ol.proj.fromLonLat([bb[0], bb[1]]);
        const ne = ol.proj.fromLonLat([bb[2], bb[3]]);
        const bboxMerc = `${sw[0]},${sw[1]},${ne[0]},${ne[1]}`;
        // Search routes + waypoints in bbox.
        const [routes, waypoints] = await Promise.all([
          c2c.route.getAll({ bbox: bboxMerc, limit: 30 }),
          c2c.waypoint.getAll({ bbox: bboxMerc, limit: 30 }),
        ]);
        const found = [
          ...(routes?.data?.documents || []),
          ...(waypoints?.data?.documents || []),
        ];
        // Merge into linkedTopos, deduping by document_id+type.
        const existing = new Map(
          this.plan.linkedTopos.map((t) => [`${t.type}-${t.document_id}`, t])
        );
        for (const doc of found) {
          existing.set(`${doc.type}-${doc.document_id}`, doc);
        }
        this.plan.linkedTopos = Array.from(existing.values());
        // Auto-guess discipline if not user-set.
        const guess = disciplineGuess(this.plan.linkedTopos);
        if (guess && (this.plan.discipline === 'hiking' || !this.plan.discipline)) {
          this.plan.discipline = guess;
        }
      } catch {
        // Network blip is fine — user can retry from the button.
      } finally {
        this.detectingTopos = false;
      }
    },

    unlinkTopo(topo) {
      this.plan.linkedTopos = this.plan.linkedTopos.filter(
        (t) => !(t.document_id === topo.document_id && t.type === topo.type)
      );
    },

    topoIcon(topo) {
      if (topo.type === 'w') return 'location-dot';
      if (topo.type === 'r') return 'route';
      return 'circle-info';
    },
    topoTitle(topo) {
      return this.$documentUtils.getDocumentTitle(topo) || `#${topo.document_id}`;
    },
    topoUrl(topo) {
      const type = this.$documentUtils.getDocumentType(topo.type);
      return `https://www.camptocamp.org/${type}s/${topo.document_id}`;
    },

    confirmUndoLast() {
      if (!this.plan.coordinates.length) return;
      this.plan.coordinates = this.plan.coordinates.slice(0, -1);
    },

    confirmClearTrace() {
      if (!this.plan.coordinates.length) return;
      const ok = window.confirm(this.$gettext('Effacer tout le tracé ? Les notes restent.'));
      if (!ok) return;
      this.plan.coordinates = [];
      this.plan.linkedTopos = [];
    },

    async save() {
      this.saving = true;
      try {
        const id = await this.$offline.savePlan(this.plan);
        this.plan.document_id = id;
        toast({
          type: 'is-success',
          position: 'bottom-center',
          message: this.$gettext('Plan sauvegardé.'),
        });
        // Redirect to the offline mini-app so the user immediately sees
        // the plan in its 5-view experience.
        this.$router.push({
          name: 'offline-topo',
          params: { type: 'plan', id, lang: '__' },
        });
      } catch (err) {
        toast({
          type: 'is-danger',
          position: 'bottom-center',
          message: this.$gettext('Échec de la sauvegarde du plan.'),
        });
      } finally {
        this.saving = false;
      }
    },

    exportGpx() {
      const coords = this.plan.coordinates;
      if (!coords.length) return;
      const escape = (s) =>
        String(s ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      const trkpts = coords
        .map((p) => {
          const ele = Number.isFinite(p.alt) ? `      <ele>${p.alt.toFixed(1)}</ele>\n` : '';
          return `    <trkpt lat="${p.lat}" lon="${p.lon}">\n${ele}    </trkpt>`;
        })
        .join('\n');
      const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Camptocamp mobile V4" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escape(this.plan.title || 'Plan Camptocamp')}</name>
    <desc>${escape(this.plan.generalNotes)}</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${escape(this.plan.title || 'Plan')}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
      const blob = new Blob([gpx], { type: 'application/gpx+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(this.plan.title || 'plan').replace(/[^a-zA-Z0-9-_]/g, '_')}.gpx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    convertToOuting() {
      // Pre-fill the V1 outing creation form with this plan's data:
      //   - First linked route auto-associated via ?r=<id>
      //   - Title pre-filled via session-local storage (picked up by
      //     OutingEditionView on mount).
      const params = { lang: this.$language.current };
      const query = {};
      const firstRoute = this.plan.linkedTopos.find((t) => t.type === 'r');
      if (firstRoute) query.r = firstRoute.document_id;
      try {
        window.sessionStorage.setItem(
          'v4.planSeed',
          JSON.stringify({ title: this.plan.title, generalNotes: this.plan.generalNotes })
        );
      } catch { /* ignore */ }
      this.$router.push({ name: 'outing-add', params, query });
    },

    goBack() {
      if (window.history.length > 1) this.$router.back();
      else this.$router.push({ name: 'offline' });
    },
  },

  beforeDestroy() {
    if (this._detectTimer) window.clearTimeout(this._detectTimer);
    const olMap = this.$refs.map?.map;
    if (olMap) olMap.un('singleclick', this.onMapSingleClick);
  },
};
</script>

<style lang="scss" scoped>
.plan-editor {
  position: fixed;
  inset: 0;
  z-index: 30;
  background: #fbfaf6;
  display: flex;
  flex-direction: column;
}

.plan-editor-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: calc(0.4rem + env(safe-area-inset-top)) 0.5rem 0.4rem;
  background: white;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  min-height: 52px;
}

.plan-editor-back {
  width: 38px;
  height: 38px;
  border: none;
  background: transparent;
  color: #4a4a4a;
  font-size: 1.1rem;
  cursor: pointer;
  border-radius: 4px;
  &:hover { background: rgba(0, 0, 0, 0.05); }
}

.plan-editor-title-input {
  flex: 1 1 auto;
  font-size: 0.95rem;
  font-weight: 600;
  color: #4a4a4a;
  border: none;
  background: transparent;
  padding: 0.4rem 0.3rem;
  &:focus { outline: none; }
}

.plan-editor-tools {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.97);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  padding: 0.35rem 0.5rem;
}

.plan-editor-tools-left,
.plan-editor-tools-right {
  display: flex;
  gap: 0.3rem;
}

.plan-tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.55rem;
  background: transparent;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 6px;
  color: #4a4a4a;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;

  span { line-height: 1; }

  &:hover, &:focus {
    background: rgba(0, 0, 0, 0.04);
    outline: none;
  }
  &.is-active {
    background: #fff5e6;
    border-color: #ff9933;
    color: #cc7a29;
  }
  &.is-danger {
    color: #c0392b;
    &:hover:not(:disabled) {
      background: rgba(192, 57, 43, 0.06);
      border-color: #c0392b;
    }
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.plan-editor-banner {
  flex: 0 0 auto;
  padding: 0.4rem 0.7rem;
  background: #fff5e6;
  color: #cc7a29;
  font-size: 0.75rem;
  border-bottom: 1px solid rgba(255, 153, 51, 0.3);
}

.plan-editor-map {
  flex: 1 1 0;
  min-height: 0;
  position: relative;

  // The MapView fills the wrapper.
  ::v-deep .ol-viewport, ::v-deep .map-view {
    height: 100%;
    width: 100%;
  }
}

.plan-editor-hud {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 8px;
  padding: 0.45rem 0.6rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  pointer-events: none;
}

.plan-editor-hud-stats {
  display: flex;
  gap: 0.9rem;
  strong { display: block; color: #4a4a4a; font-size: 0.9rem; line-height: 1; }
  small { display: block; font-size: 0.62rem; color: #6b6b6b; text-transform: uppercase; }
}

.plan-editor-bottom {
  flex: 0 0 auto;
  background: white;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}

.plan-editor-sheet-handle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: none;
  background: transparent;
  color: #4a4a4a;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;

  &:hover { background: rgba(0, 0, 0, 0.03); }
}

.plan-editor-sheet-body {
  flex: 1 1 0;
  overflow-y: auto;
  padding: 0.5rem 0.75rem 1rem;
}

.plan-section {
  margin-bottom: 1rem;

  h3 {
    font-size: 0.82rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #6b6b6b;
    margin: 0 0 0.4rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
}

.plan-detecting {
  font-size: 0.7rem;
  text-transform: none;
  letter-spacing: 0;
  color: #6b6b6b;
}

.plan-empty-hint {
  font-size: 0.85rem;
  color: #6b6b6b;
  font-style: italic;
  margin: 0;
}

.plan-meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;

  label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    span {
      font-size: 0.7rem;
      color: #6b6b6b;
    }
    select, input {
      padding: 0.4rem 0.5rem;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 6px;
      font-size: 0.85rem;
      color: #4a4a4a;
      background: white;
    }
  }
}

.plan-linked-topos {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;

  li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.55rem;
    background: #f8f8f8;
    border-radius: 6px;
    font-size: 0.85rem;

    a {
      flex: 1 1 auto;
      color: #337ab7;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}

.plan-linked-remove {
  border: none;
  background: transparent;
  color: #9a9a9a;
  cursor: pointer;
  padding: 0.2rem 0.3rem;
  &:hover { color: #c0392b; }
}

.plan-redetect-btn {
  margin-top: 0.4rem;
}

.plan-notes-area {
  width: 100%;
  padding: 0.45rem 0.55rem;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  font: inherit;
  resize: vertical;
  background: white;
  color: #4a4a4a;

  &:focus { outline: none; border-color: #ff9933; }
}

.plan-section-export {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
</style>

<style lang="scss">
html[data-theme='dark'] {
  .plan-editor { background: #1a1a1a; }
  .plan-editor-header {
    background: #232323;
    border-bottom-color: rgba(255, 255, 255, 0.08);
  }
  .plan-editor-back { color: #e5e5e5; }
  .plan-editor-title-input { color: #f5f5f5; &::placeholder { color: #6b6b6b; } }
  .plan-editor-tools {
    background: #2a2a2a;
    border-bottom-color: rgba(255, 255, 255, 0.08);
  }
  .plan-tool-btn {
    color: #e5e5e5;
    border-color: rgba(255, 255, 255, 0.12);
    &:hover, &:focus { background: rgba(255, 255, 255, 0.05); }
    &.is-active { background: #3a2f1a; border-color: #ff9933; color: #ffb866; }
  }
  .plan-editor-banner {
    background: #3a2f1a;
    color: #ffb866;
    border-bottom-color: rgba(255, 153, 51, 0.3);
  }
  .plan-editor-hud {
    background: rgba(30, 30, 30, 0.92);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    strong { color: #f0f0f0; }
    small { color: #9a9a9a; }
  }
  .plan-editor-bottom {
    background: #232323;
    border-top-color: rgba(255, 255, 255, 0.08);
  }
  .plan-editor-sheet-handle { color: #e5e5e5; }
  .plan-section h3 { color: #9a9a9a; }
  .plan-empty-hint { color: #9a9a9a; }
  .plan-linked-topos li { background: #2a2a2a; }
  .plan-linked-topos li a { color: #6db4ff; }
  .plan-meta-grid label span { color: #9a9a9a; }
  .plan-meta-grid select,
  .plan-meta-grid input,
  .plan-notes-area {
    background: #1f1f1f;
    color: #e5e5e5;
    border-color: rgba(255, 255, 255, 0.15);
  }
}
</style>
