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
        :disabled="saving"
        :title="!plan.title.trim() ? $gettext('Le titre sera généré automatiquement si vous ne le remplissez pas') : ''"
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

    <!-- Drawing mode banner — explains what tapping does. Auto-hides
         once the user has placed a few points (they've understood). -->
    <div v-if="showDrawingBanner" class="plan-editor-banner">
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

      <!-- Waypoints panel toggle (right side) -->
      <button
        type="button"
        class="plan-editor-wp-toggle"
        :class="{ 'is-active': waypointsPanelOpen }"
        :aria-label="$gettext('Points de passage')"
        :title="$gettext('Voir / modifier les points de passage')"
        @click="toggleWaypointsPanel"
      >
        <fa-icon icon="list" />
        <span class="plan-editor-wp-count" v-if="plan.coordinates.length">
          {{ plan.coordinates.length }}
        </span>
      </button>

      <!-- Waypoints side panel — scrollable list of every vertex, with
           per-point reorder + delete + center-on-map. Replaces the
           crude "undo last" by a precise editing tool. -->
      <aside
        v-if="waypointsPanelOpen"
        class="plan-editor-wp-panel"
        :aria-label="$gettext('Points de passage')"
      >
        <header>
          <strong>{{ $gettext('Points de passage') }}</strong>
          <small>{{ plan.coordinates.length }} {{ $gettext('points') }}</small>
          <button
            type="button"
            class="plan-editor-wp-close"
            :aria-label="$gettext('Fermer')"
            @click="waypointsPanelOpen = false"
          >
            <fa-icon icon="xmark" />
          </button>
        </header>
        <ul v-if="plan.coordinates.length">
          <li
            v-for="(c, i) in plan.coordinates"
            :key="i"
            :class="{ 'is-off-trail': c.mode === 'off-trail' }"
          >
            <span class="plan-wp-index">{{ i + 1 }}</span>
            <button
              type="button"
              class="plan-wp-focus"
              :title="$gettext('Centrer la carte sur ce point')"
              @click="focusCoordinateOnMap(i)"
            >
              <span class="plan-wp-coord">{{ c.lat.toFixed(4) }}, {{ c.lon.toFixed(4) }}</span>
              <span class="plan-wp-mode-tag" :class="c.mode">
                {{ c.mode === 'off-trail' ? $gettext('hors-piste') : $gettext('sentier') }}
              </span>
            </button>
            <div class="plan-wp-actions">
              <button
                type="button"
                :disabled="i === 0"
                :title="$gettext('Monter')"
                @click="moveCoordinate(i, -1)"
              >
                <fa-icon icon="chevron-up" />
              </button>
              <button
                type="button"
                :disabled="i === plan.coordinates.length - 1"
                :title="$gettext('Descendre')"
                @click="moveCoordinate(i, 1)"
              >
                <fa-icon icon="chevron-down" />
              </button>
              <button
                type="button"
                class="is-danger"
                :title="$gettext('Supprimer ce point')"
                @click="removeCoordinate(i)"
              >
                <fa-icon icon="trash" />
              </button>
            </div>
          </li>
        </ul>
        <p v-else class="plan-wp-empty">
          {{ $gettext('Aucun point pour l\'instant. Tapez sur la carte pour en ajouter.') }}
        </p>
      </aside>
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

        <!-- Stages / days — only shown when planning > 1 day. Each
             day has its own stops list (refuge / bivouac / water /
             summit / etc.) the user can curate. -->
        <section v-if="plan.days > 1" class="plan-section">
          <h3>{{ $gettext('Étapes par jour') }}</h3>
          <div v-for="d in plan.days" :key="d" class="plan-day-card">
            <header class="plan-day-card-header">
              <strong>{{ $gettext('Jour') }} {{ d }}</strong>
              <span class="plan-day-stops-count">
                {{ stopsForDay(d).length }} {{ $gettext('arrêt(s)') }}
              </span>
            </header>

            <ul v-if="stopsForDay(d).length" class="plan-day-stops">
              <li v-for="stop in stopsForDay(d)" :key="stop.id" :class="'stop-' + stop.type">
                <span class="plan-stop-icon">
                  <fa-icon :icon="stopIcon(stop.type)" />
                </span>
                <div class="plan-stop-body">
                  <strong>{{ stop.name || $gettext('Sans nom') }}</strong>
                  <small v-if="stop.notes">{{ stop.notes }}</small>
                  <small v-if="stop.gps" class="plan-stop-gps">
                    <fa-icon icon="location-dot" />
                    {{ stop.gps.lat.toFixed(4) }}, {{ stop.gps.lon.toFixed(4) }}
                  </small>
                </div>
                <button
                  type="button"
                  class="plan-stop-delete"
                  :title="$gettext('Supprimer')"
                  @click="removeStop(stop.id)"
                >
                  <fa-icon icon="trash" />
                </button>
              </li>
            </ul>

            <details class="plan-day-add">
              <summary>
                <fa-icon icon="plus" />
                &nbsp;{{ $gettext('Ajouter un arrêt') }}
              </summary>
              <div class="plan-add-stop-form">
                <label>
                  <span>{{ $gettext('Type') }}</span>
                  <select v-model="newStop.type">
                    <option value="refuge">🏠 {{ $gettext('Refuge') }}</option>
                    <option value="bivouac">⛺ {{ $gettext('Bivouac') }}</option>
                    <option value="water">💧 {{ $gettext('Point d\'eau') }}</option>
                    <option value="summit">⛰ {{ $gettext('Sommet') }}</option>
                    <option value="pass">🌄 {{ $gettext('Col') }}</option>
                    <option value="food">🍴 {{ $gettext('Ravitaillement') }}</option>
                    <option value="view">👁 {{ $gettext('Point de vue') }}</option>
                    <option value="other">📍 {{ $gettext('Autre') }}</option>
                  </select>
                </label>
                <label>
                  <span>{{ $gettext('Nom') }}</span>
                  <input
                    type="text"
                    v-model="newStop.name"
                    :placeholder="$gettext('Ex : Refuge des Conscrits')"
                  />
                </label>
                <label>
                  <span>{{ $gettext('Notes (optionnel)') }}</span>
                  <input
                    type="text"
                    v-model="newStop.notes"
                    :placeholder="$gettext('Ex : gardé en été, 22 €/nuit')"
                  />
                </label>
                <div class="plan-add-stop-actions">
                  <button
                    type="button"
                    class="button is-small"
                    @click="attachStopGps"
                    :disabled="attachingGps"
                  >
                    <fa-icon icon="location-crosshairs" />
                    &nbsp;{{ newStop.gps ? $gettext('Position OK') : $gettext('Joindre ma position') }}
                  </button>
                  <button
                    type="button"
                    class="button is-small is-primary"
                    :disabled="!newStop.name.trim()"
                    @click="addStopToDay(d)"
                  >
                    {{ $gettext('Ajouter') }}
                  </button>
                </div>
              </div>
            </details>
          </div>
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

// OSRM public demo for foot routing. Returns a GeoJSON LineString
// between waypoints, snapped to OpenStreetMap's hiking-aware foot
// network. Rate-limited (~1 req/sec), good enough for our usage.
// docs: https://project-osrm.org/docs/v5.5.1/api/
async function osrmRoute(lonLatPairs) {
  if (!lonLatPairs || lonLatPairs.length < 2) return null;
  const coords = lonLatPairs.map((p) => `${p[0]},${p[1]}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/foot/${coords}?geometries=geojson&overview=full`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  if (data?.code !== 'Ok' || !data.routes?.length) return null;
  return data.routes[0].geometry; // GeoJSON LineString in lon/lat
}

// Smart topo association scoring (replaces naive bbox match).
// For routes (LineString geom_detail), measure overlap with the trace:
// % of route points within MATCH_DIST_M of any trace point. Anything
// below MIN_OVERLAP is dropped.
// For waypoints, score by relevance of waypoint_type + closeness.
const MATCH_DIST_M = 150;
const MIN_OVERLAP = 0.25;

const WAYPOINT_RELEVANCE = {
  // Highly relevant — the stuff users actually plan around
  summit: 1.0,
  hut: 1.0,
  gite: 0.9,
  pass: 0.9,
  bivouac: 0.9,
  bisse: 0.6,
  source: 0.6,
  lake: 0.6,
  cave: 0.5,
  paragliding_takeoff: 0.5,
  paragliding_landing: 0.4,
  climbing_outdoor: 0.5,
  bergschrund: 0.4,
  climbing_indoor: 0.1,
  gathering_place: 0.3,
  // Low / noise — typically not useful for trek planning
  access: 0.05,
  parking: 0.05,
  hut_unstaffed: 0.6,
  base_camp: 0.5,
  decision_point: 0.4,
  weather_station: 0.2,
  webcam: 0.1,
  virtual: 0.05,
  water_point: 0.6,
  local_product: 0.1,
  camp_site: 0.6,
  dam: 0.2,
};

function pointToSegmentDist(p, a, b) {
  // Approx great-circle: treat as flat in meters at this scale.
  // p, a, b are [lon, lat]. Use simple equirectangular projection at
  // mean latitude for distance.
  const meanLat = (a[1] + b[1]) / 2;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  const toM = (dLon, dLat) => Math.sqrt((dLon * 111320 * cosLat) ** 2 + (dLat * 110540) ** 2);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return toM(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  const px = a[0] + t * dx;
  const py = a[1] + t * dy;
  return toM(p[0] - px, p[1] - py);
}

function minDistFromPointToTrace(point, traceCoords) {
  let min = Infinity;
  for (let i = 1; i < traceCoords.length; i += 1) {
    const d = pointToSegmentDist(point, traceCoords[i - 1], traceCoords[i]);
    if (d < min) min = d;
  }
  return min;
}

function routeOverlapScore(route, traceCoords) {
  // Pull route geometry (LineString in EPSG:3857). Convert to lon/lat
  // points and measure what fraction passes near the trace.
  const geom = route?.geometry?.geom_detail;
  if (!geom) return 0;
  let parsed;
  try { parsed = typeof geom === 'string' ? JSON.parse(geom) : geom; } catch { return 0; }
  if (parsed.type !== 'LineString' || !parsed.coordinates?.length) return 0;
  let near = 0;
  for (const xy of parsed.coordinates) {
    const lonLat = ol.proj.toLonLat([xy[0], xy[1]]);
    const d = minDistFromPointToTrace(lonLat, traceCoords);
    if (d <= MATCH_DIST_M) near += 1;
  }
  return near / parsed.coordinates.length;
}

function waypointScore(wp, traceCoords) {
  const wtype = wp.waypoint_type;
  const relevance = WAYPOINT_RELEVANCE[wtype] ?? 0.2;
  const geom = wp?.geometry?.geom;
  if (!geom) return 0;
  let parsed;
  try { parsed = typeof geom === 'string' ? JSON.parse(geom) : geom; } catch { return 0; }
  let lonLat;
  if (parsed.type === 'Point') lonLat = ol.proj.toLonLat(parsed.coordinates);
  else return 0;
  const d = minDistFromPointToTrace(lonLat, traceCoords);
  // Inverse-distance score, clamped to MATCH_DIST_M.
  if (d > MATCH_DIST_M * 2) return 0;
  const proximity = Math.max(0, 1 - d / (MATCH_DIST_M * 2));
  return relevance * proximity;
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
        // V4 — per-day stops along the route (refuge, bivouac, water…)
        // Shape: [{ id, day, type, name, notes, gps?: {lon, lat} }]
        stops: [],
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
      waypointsPanelOpen: false,
      draftRestored: false,
      // Snap-to-trail cache. Key = "lon1,lat1-lon2,lat2" of two
      // consecutive on-trail anchors; value = array of [lon, lat]
      // returned by OSRM (or null if the query failed). Content-keyed
      // so removing/reordering anchors doesn't invalidate other pairs.
      snapCache: {},
      snapInFlight: 0,
      // Inline form state for adding a new stop. Shared across days
      // because only one form is open at a time (the <details> auto-
      // collapses others).
      newStop: { type: 'refuge', name: '', notes: '', gps: null },
      attachingGps: false,
    };
  },

  computed: {
    documentsForMap() {
      // Show linked topos as document features on the map. Tag them
      // nonInteractive so OlMap's click handler doesn't router.push
      // away when the user taps on a topo while tracing — that was
      // the "trace disappears" bug Sixte reported. The `properties`
      // bag is the V1 convention (see OlMap.onClick).
      return this.plan.linkedTopos.map((t) => ({
        ...t,
        properties: { ...(t.properties || {}), nonInteractive: true },
      }));
    },

    // Banner becomes noise once the user has clearly understood the
    // gesture — hide it after a few points.
    showDrawingBanner() {
      return this.drawingMode !== 'pan' && this.plan.coordinates.length < 3;
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
      // Editing an existing plan — load from offline store.
      const existing = await this.$offline.getPlan(this.$route.params.id);
      if (existing) {
        this.plan = { ...this.plan, ...existing };
      }
    } else {
      // New plan — restore a draft from localStorage if the user was
      // mid-edit on a previous session (closed the tab, lost network,
      // accidentally navigated away from the map, etc.). Anti-data-loss.
      try {
        const draftRaw = window.localStorage.getItem('v4.planDraft');
        if (draftRaw) {
          const draft = JSON.parse(draftRaw);
          if (draft && Array.isArray(draft.coordinates) && draft.coordinates.length > 0) {
            const restore = window.confirm(
              this.$gettext(
                'Un brouillon de plan en cours a été retrouvé ({n} points). Le reprendre ?'
              ).replace('{n}', draft.coordinates.length)
            );
            if (restore) {
              this.plan = { ...this.plan, ...draft };
              this.draftRestored = true;
            } else {
              window.localStorage.removeItem('v4.planDraft');
            }
          }
        }
      } catch {
        // localStorage unavailable — ignore, no autosave possible
      }
    }
    this.$nextTick(() => this.attachDrawingLayer());
  },

  watch: {
    'plan.coordinates'() {
      this.refreshTraceFeature();
      this.persistDraft();
      // Kick off snap-to-trail for any new on-trail pair. snapDirty
      // is a no-op for pairs already cached.
      this.snapDirtyPairs();
    },
    'plan.title'() { this.persistDraft(); },
    'plan.generalNotes'() { this.persistDraft(); },
    'plan.discipline'() { this.persistDraft(); },
    'plan.days'() { this.persistDraft(); },
    'plan.linkedTopos'() { this.persistDraft(); },
    'plan.stops'() { this.persistDraft(); },
  },

  methods: {
    // Snapshot the live draft to localStorage so a refresh / accidental
    // navigation / crashed tab doesn't lose the user's tracing work.
    // Debounced via a timer so we don't write to localStorage on every
    // single keystroke or coordinate add. Cleared on a real save.
    persistDraft() {
      if (this._draftTimer) window.clearTimeout(this._draftTimer);
      this._draftTimer = window.setTimeout(() => {
        try {
          // Only persist if there's at least 1 point — empty drafts
          // are noise we don't want to restore.
          if (this.plan.coordinates.length === 0 && !this.plan.title.trim()) {
            window.localStorage.removeItem('v4.planDraft');
            return;
          }
          // Don't persist the document_id of a NEW plan; only an
          // already-saved one (where the user is editing).
          window.localStorage.setItem('v4.planDraft', JSON.stringify(this.plan));
        } catch {
          /* quota / disabled — ignore */
        }
      }, 600);
    },

    clearDraft() {
      try { window.localStorage.removeItem('v4.planDraft'); } catch { /* ignore */ }
    },

    setDrawingMode(mode) {
      this.drawingMode = mode;
    },

    toggleWaypointsPanel() {
      this.waypointsPanelOpen = !this.waypointsPanelOpen;
    },

    removeCoordinate(index) {
      if (index < 0 || index >= this.plan.coordinates.length) return;
      this.plan.coordinates = this.plan.coordinates.filter((_, i) => i !== index);
      // Re-detect topos when removing points might change which topos
      // intersect the trace.
      if (this.plan.coordinates.length >= 2 && this.$offline.online) {
        this.scheduleTopoDetection();
      }
    },

    moveCoordinate(index, delta) {
      const newIndex = index + delta;
      if (newIndex < 0 || newIndex >= this.plan.coordinates.length) return;
      const next = [...this.plan.coordinates];
      const [item] = next.splice(index, 1);
      next.splice(newIndex, 0, item);
      this.plan.coordinates = next;
    },

    focusCoordinateOnMap(index) {
      const olMap = this.$refs.map?.map;
      const c = this.plan.coordinates[index];
      if (!olMap || !c) return;
      olMap.getView().animate({
        center: ol.proj.fromLonLat([c.lon, c.lat]),
        zoom: Math.max(olMap.getView().getZoom(), 14),
        duration: 400,
      });
    },

    // Per-day stops (refuge / bivouac / water…)
    stopsForDay(day) {
      return (this.plan.stops || []).filter((s) => s.day === day);
    },

    stopIcon(type) {
      const map = {
        refuge: 'house',
        bivouac: 'tent', // may fall back to a generic icon if absent
        water: 'droplet',
        summit: 'mountain',
        pass: 'mountain-sun',
        food: 'utensils',
        view: 'eye',
        other: 'location-dot',
      };
      return map[type] || 'location-dot';
    },

    addStopToDay(day) {
      const name = this.newStop.name.trim();
      if (!name) return;
      const newId = `stop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      this.plan.stops = [
        ...(this.plan.stops || []),
        {
          id: newId,
          day,
          type: this.newStop.type,
          name,
          notes: this.newStop.notes.trim(),
          gps: this.newStop.gps,
        },
      ];
      // Reset form for next add.
      this.newStop = { type: 'refuge', name: '', notes: '', gps: null };
    },

    removeStop(id) {
      this.plan.stops = (this.plan.stops || []).filter((s) => s.id !== id);
    },

    async attachStopGps() {
      this.attachingGps = true;
      try {
        const sample = await this.$outingSession.requestCurrentPosition();
        this.newStop = { ...this.newStop, gps: { lon: sample.lon, lat: sample.lat } };
      } catch {
        window.alert(this.$gettext('Position indisponible — vérifie les permissions de géolocalisation.'));
      } finally {
        this.attachingGps = false;
      }
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

      // Per-segment features. For two consecutive on-trail anchors,
      // use the snapped polyline from OSRM (if cached); otherwise
      // fall back to a straight line. Off-trail segments are always
      // straight (dashed red in the style fn).
      for (let i = 1; i < coords.length; i += 1) {
        const segMode = coords[i].mode || 'on-trail';
        const a = coords[i - 1];
        const b = coords[i];
        let lineCoords;
        if (a.mode === 'on-trail' && b.mode === 'on-trail') {
          const cached = this.snapCache[this.snapKey(a, b)];
          if (cached && cached.length >= 2) {
            // Use the snapped path (in lon/lat) — project each to 3857.
            lineCoords = cached.map((p) => ol.proj.fromLonLat(p));
          }
        }
        if (!lineCoords) {
          lineCoords = [
            ol.proj.fromLonLat([a.lon, a.lat]),
            ol.proj.fromLonLat([b.lon, b.lat]),
          ];
        }
        const f = new ol.Feature({
          geometry: new ol.geom.LineString(lineCoords),
          mode: segMode,
        });
        source.addFeature(f);
      }

      // Vertex points (user-clicked anchors).
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
      if (this.plan.coordinates.length < 2 || !this.$offline.online) return;
      this.detectingTopos = true;
      try {
        const pts = this.plan.coordinates.map((p) => [p.lon, p.lat]);
        const bb = bbox(pts, 0.005); // ~500 m pad
        if (!bb) return;
        // C2C API expects bbox in EPSG:3857. Convert.
        const sw = ol.proj.fromLonLat([bb[0], bb[1]]);
        const ne = ol.proj.fromLonLat([bb[2], bb[3]]);
        const bboxMerc = `${sw[0]},${sw[1]},${ne[0]},${ne[1]}`;

        // We need each route/waypoint's geometry to score it — the
        // listing endpoint returns it inline, so a single call covers
        // both the candidate set AND the geometry. limit:50 to keep
        // the bandwidth reasonable.
        const [routesResp, waypointsResp] = await Promise.all([
          c2c.route.getAll({ bbox: bboxMerc, limit: 50 }),
          c2c.waypoint.getAll({ bbox: bboxMerc, limit: 50 }),
        ]);
        const routesAll = routesResp?.data?.documents || [];
        const waypointsAll = waypointsResp?.data?.documents || [];

        // Smart scoring: prefer routes that overlap with the trace
        // ≥ MIN_OVERLAP, prefer waypoints whose type is relevant AND
        // close to the trace. Drop the noise. See the helpers above
        // for the math.
        const scoredRoutes = routesAll
          .map((r) => ({ doc: r, score: routeOverlapScore(r, pts) }))
          .filter((x) => x.score >= MIN_OVERLAP)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8);

        const scoredWaypoints = waypointsAll
          .map((w) => ({ doc: w, score: waypointScore(w, pts) }))
          .filter((x) => x.score > 0.15)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8);

        const found = [
          ...scoredRoutes.map((x) => ({ ...x.doc, _score: x.score })),
          ...scoredWaypoints.map((x) => ({ ...x.doc, _score: x.score })),
        ];

        // Merge into linkedTopos, deduping by document_id+type. Keep
        // user-added (unscored) topos pinned at the top.
        const existing = new Map(
          this.plan.linkedTopos.map((t) => [`${t.type}-${t.document_id}`, t])
        );
        for (const doc of found) {
          const key = `${doc.type}-${doc.document_id}`;
          if (!existing.has(key)) existing.set(key, doc);
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

    // OSRM snap-to-trail for consecutive on-trail anchors. Cached
    // by content hash so reordering / inserting points doesn't waste
    // a query.
    snapKey(a, b) {
      return `${a.lon.toFixed(5)},${a.lat.toFixed(5)}-${b.lon.toFixed(5)},${b.lat.toFixed(5)}`;
    },

    async snapBetweenAnchors(a, b) {
      if (!this.$offline.online) return null;
      const key = this.snapKey(a, b);
      if (this.snapCache[key] !== undefined) return this.snapCache[key];
      // Reserve the slot to prevent duplicate inflight requests.
      this.$set(this.snapCache, key, null);
      this.snapInFlight += 1;
      try {
        const geom = await osrmRoute([[a.lon, a.lat], [b.lon, b.lat]]);
        const coords = geom?.coordinates || null;
        this.$set(this.snapCache, key, coords);
        // Re-render the trace once snapping data is in.
        this.refreshTraceFeature();
        return coords;
      } catch {
        return null;
      } finally {
        this.snapInFlight -= 1;
      }
    },

    // Trigger snap requests for any pair of consecutive on-trail
    // anchors that doesn't have a cache entry yet. Called after every
    // anchor add / remove / move.
    snapDirtyPairs() {
      const coords = this.plan.coordinates;
      for (let i = 1; i < coords.length; i += 1) {
        if (coords[i - 1].mode === 'on-trail' && coords[i].mode === 'on-trail') {
          const key = this.snapKey(coords[i - 1], coords[i]);
          if (this.snapCache[key] === undefined) {
            // Schedule with throttle to avoid hammering OSRM's free demo.
            this._snapQueue = (this._snapQueue || Promise.resolve()).then(async () => {
              await this.snapBetweenAnchors(coords[i - 1], coords[i]);
              await new Promise((r) => setTimeout(r, 250));
            });
          }
        }
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
      // Auto-title when empty — friendlier than disabling the button
      // and leaving the user stuck. Format: "Plan du DD/MM/YYYY".
      if (!this.plan.title.trim()) {
        const d = new Date();
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        this.plan.title = `Plan du ${day}/${month}/${d.getFullYear()}`;
      }
      this.saving = true;
      try {
        const id = await this.$offline.savePlan(this.plan);
        this.plan.document_id = id;
        this.clearDraft();
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
    if (this._draftTimer) window.clearTimeout(this._draftTimer);
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

// Floating button on the right side of the map opening the waypoints
// list panel. Stays above the bottom sheet.
.plan-editor-wp-toggle {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 12;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: none;
  background: white;
  color: #4a4a4a;
  font-size: 1rem;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:hover, &:focus { background: #f0f4f8; outline: none; }
  &.is-active { background: #ff9933; color: white; }
}

.plan-editor-wp-count {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  background: #ff9933;
  color: white;
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 18px;
  border-radius: 9px;
  text-align: center;
  box-shadow: 0 0 0 2px white;
}

.plan-editor-wp-panel {
  position: absolute;
  top: 0.5rem;
  right: 3.7rem;
  bottom: 0.5rem;
  z-index: 11;
  width: min(280px, calc(100vw - 5rem));
  background: white;
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;

  > header {
    flex: 0 0 auto;
    padding: 0.55rem 0.7rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    display: flex;
    align-items: center;
    gap: 0.4rem;

    strong { font-size: 0.85rem; color: #4a4a4a; }
    small { color: #6b6b6b; font-size: 0.7rem; flex: 1; }
  }

  ul {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 0.3rem 0;
  }

  li {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.04);

    &:hover { background: rgba(0, 0, 0, 0.03); }
    &.is-off-trail .plan-wp-mode-tag { background: rgba(192, 57, 43, 0.15); color: #c0392b; }
  }
}

.plan-editor-wp-close {
  border: none;
  background: transparent;
  color: #6b6b6b;
  cursor: pointer;
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  &:hover { background: rgba(0, 0, 0, 0.05); color: #4a4a4a; }
}

.plan-wp-index {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  background: #f0f4f8;
  color: #4a4a4a;
  font-size: 0.72rem;
  font-weight: 700;
  border-radius: 11px;
}

.plan-wp-focus {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  padding: 0.1rem 0.2rem;
  min-width: 0;

  &:hover .plan-wp-coord { color: #337ab7; }
}

.plan-wp-coord {
  font-size: 0.72rem;
  font-family: monospace;
  color: #4a4a4a;
}

.plan-wp-mode-tag {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.05rem 0.35rem;
  border-radius: 3px;
  background: rgba(51, 122, 183, 0.15);
  color: #337ab7;

  &.off-trail {
    background: rgba(192, 57, 43, 0.15);
    color: #c0392b;
  }
}

.plan-wp-actions {
  flex: 0 0 auto;
  display: inline-flex;
  gap: 0.1rem;

  button {
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: #6b6b6b;
    cursor: pointer;
    border-radius: 4px;
    font-size: 0.7rem;
    &:hover:not(:disabled) { background: rgba(0, 0, 0, 0.05); color: #4a4a4a; }
    &:disabled { opacity: 0.3; cursor: not-allowed; }
    &.is-danger { color: #c0392b; }
    &.is-danger:hover:not(:disabled) { background: rgba(192, 57, 43, 0.08); }
  }
}

.plan-wp-empty {
  text-align: center;
  color: #9a9a9a;
  font-size: 0.8rem;
  font-style: italic;
  padding: 1.5rem 1rem;
  margin: 0;
}

// Multi-day stops UI inside the bottom sheet
.plan-day-card {
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  margin-bottom: 0.6rem;
  overflow: hidden;
}

.plan-day-card-header {
  padding: 0.55rem 0.7rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(0, 0, 0, 0.02);
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);

  strong { font-size: 0.9rem; color: #4a4a4a; }
}

.plan-day-stops-count {
  font-size: 0.7rem;
  color: #6b6b6b;
}

.plan-day-stops {
  list-style: none;
  margin: 0;
  padding: 0.2rem 0;

  li {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.4rem 0.7rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.04);

    &:last-child { border-bottom: none; }
  }
}

.plan-stop-icon {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #fff5e6;
  color: #ff9933;
  border-radius: 6px;
}

.plan-stop-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;

  strong { font-size: 0.85rem; color: #4a4a4a; }
  small { font-size: 0.72rem; color: #6b6b6b; }
}

.plan-stop-gps {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-family: monospace !important;
  color: #337ab7 !important;
}

.plan-stop-delete {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: #9a9a9a;
  cursor: pointer;
  padding: 0.2rem 0.3rem;
  border-radius: 4px;
  &:hover { color: #c0392b; background: rgba(192, 57, 43, 0.06); }
}

.plan-day-add {
  border-top: 1px dashed rgba(0, 0, 0, 0.08);

  summary {
    padding: 0.45rem 0.7rem;
    font-size: 0.8rem;
    color: #337ab7;
    cursor: pointer;
    list-style: none;

    &::-webkit-details-marker { display: none; }
    &:hover { background: rgba(51, 122, 183, 0.04); }
  }

  &[open] summary {
    border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  }
}

.plan-add-stop-form {
  padding: 0.5rem 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;

  label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;

    span {
      font-size: 0.7rem;
      color: #6b6b6b;
    }
    input, select {
      padding: 0.35rem 0.45rem;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 5px;
      font-size: 0.85rem;
      color: #4a4a4a;
      background: white;
    }
  }
}

.plan-add-stop-actions {
  display: flex;
  gap: 0.3rem;
  margin-top: 0.3rem;
  justify-content: flex-end;
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
  .plan-editor-wp-toggle {
    background: #2a2a2a;
    color: #e5e5e5;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.5);
    &:hover, &:focus { background: #353535; }
  }
  .plan-editor-wp-count { box-shadow: 0 0 0 2px #2a2a2a; }
  .plan-editor-wp-panel {
    background: #2a2a2a;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
    > header {
      border-bottom-color: rgba(255, 255, 255, 0.08);
      strong { color: #f5f5f5; }
      small { color: #9a9a9a; }
    }
    li {
      border-bottom-color: rgba(255, 255, 255, 0.05);
      &:hover { background: rgba(255, 255, 255, 0.04); }
    }
  }
  .plan-editor-wp-close { color: #9a9a9a; &:hover { background: rgba(255, 255, 255, 0.06); color: #f5f5f5; } }
  .plan-wp-index { background: #3a3a3a; color: #e5e5e5; }
  .plan-wp-coord { color: #d5d5d5; }
  .plan-wp-empty { color: #6b6b6b; }
  .plan-wp-actions button {
    color: #9a9a9a;
    &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.06); color: #e5e5e5; }
    &.is-danger { color: #ff6b5a; }
  }
  // Day cards
  .plan-day-card { background: #2a2a2a; border-color: rgba(255, 255, 255, 0.08); }
  .plan-day-card-header {
    background: rgba(255, 255, 255, 0.04);
    border-bottom-color: rgba(255, 255, 255, 0.06);
    strong { color: #f5f5f5; }
  }
  .plan-day-stops-count { color: #9a9a9a; }
  .plan-day-stops li { border-bottom-color: rgba(255, 255, 255, 0.06); }
  .plan-stop-icon { background: #3a2f1a; }
  .plan-stop-body strong { color: #f5f5f5; }
  .plan-stop-body small { color: #b5b5b5; }
  .plan-stop-gps { color: #6db4ff !important; }
  .plan-stop-delete {
    color: #9a9a9a;
    &:hover { color: #ff6b5a; background: rgba(255, 107, 90, 0.08); }
  }
  .plan-day-add {
    border-top-color: rgba(255, 255, 255, 0.08);
    summary { color: #6db4ff; &:hover { background: rgba(109, 180, 255, 0.06); } }
    &[open] summary { border-bottom-color: rgba(255, 255, 255, 0.06); }
  }
  .plan-add-stop-form {
    label span { color: #9a9a9a; }
    input, select {
      background: #1f1f1f;
      color: #e5e5e5;
      border-color: rgba(255, 255, 255, 0.15);
    }
  }
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
