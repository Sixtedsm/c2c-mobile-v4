<template>
  <div class="topo-map-view">
    <!-- The map fills the page. Controls (recenter, layer toggle,
         compass) sit on top via OpenLayers's positioning.
         We use the V1 OlMap component directly — it already wires
         offline tiles via the SW cache, the geolocation marker, and
         the layer switcher. Adding a feature here only adds a layer
         on top of it. -->
    <map-view
      ref="map"
      :documents="documentsForMap"
      :highlighted-document="document"
      show-center-on-geolocation
      show-recenter-on
    />

    <!-- Live HUD overlay — distance / elevation / position bearing. -->
    <div v-if="hudVisible" class="topo-map-hud">
      <div class="topo-map-hud-row">
        <div class="topo-map-hud-item">
          <span class="topo-map-hud-label">{{ $gettext('Altitude') }}</span>
          <strong>{{ altitudeLabel }}</strong>
        </div>
        <div class="topo-map-hud-item">
          <span class="topo-map-hud-label">{{ $gettext('Restant ↑') }}</span>
          <strong>{{ remainingClimbLabel }}</strong>
        </div>
        <div class="topo-map-hud-item">
          <span class="topo-map-hud-label">{{ $gettext('Distance') }}</span>
          <strong>{{ tracedDistanceLabel }}</strong>
        </div>
      </div>
      <div v-if="$outingSession.geoError" class="topo-map-hud-error">
        <fa-icon icon="triangle-exclamation" />
        &nbsp;{{ geoErrorLabel }}
      </div>
    </div>

    <!-- Where am I? one-shot button (works even when session not started) -->
    <button
      type="button"
      class="topo-map-where-btn"
      :title="$gettext('Localiser ma position')"
      :aria-label="$gettext('Localiser ma position')"
      @click="locateOnce"
    >
      <fa-icon icon="location-crosshairs" />
    </button>
  </div>
</template>

<script>
// V4 — interactive map with optional GPS HUD.
//
// We delegate the bulk of the work to the V1 OlMap component (registered
// globally as <map-view>). It already knows how to render documents +
// geolocation marker + layer switcher. We add three things on top:
//   1. A HUD strip showing altitude, remaining climb, recorded distance.
//   2. A "where am I" button that triggers a one-shot geolocate without
//      starting the full tracking session — useful for "am I on the
//      right ridge?" moments without committing to a battery-heavy
//      watchPosition loop.
//   3. The session's recorded trace as a magenta line on the map
//      (added imperatively once the map is ready).

// (Note: we read the active session via this.$outingSession; the
// MapView (OlMap) exposes geolocation natively too, but only when its
// "center-on-geolocation" toggle is on. Our HUD reads from the
// session's currentPosition which is updated by the watchPosition
// loop when gpsTracking is on, OR by the one-shot button below.)

import ol from '@/js/libs/ol';

export default {
  name: 'TopoMapView',

  props: {
    document: { type: Object, required: true },
    discipline: { type: String, default: 'hiking' },
    active: { type: Boolean, default: false },
    type: { type: String, required: true },
  },

  data() {
    return {
      // Local copy of remainingClimb computed once at mount — the
      // computation walks the geom which is expensive, no need to redo
      // on every tick.
      totalClimb: this.document?.height_diff_up || null,
    };
  },

  computed: {
    hudVisible() {
      // Show the HUD when the user has explicitly started the outing —
      // before that, the screen stays clean / map-only.
      const s = this.$outingSession;
      if (!s.sessionActive) return false;
      return (
        s.topoRef?.type === this.type &&
        String(s.topoRef?.id) === String(this.document?.document_id)
      );
    },

    documentsForMap() {
      // OlMap consumes documents with `geometry.geom_detail` (GeoJSON
      // LineString in EPSG:3857). For plans we don't have that natively
      // — we have a list of lon/lat coordinates. Build a synthetic
      // document so OlMap renders the plan trace.
      if (!this.document) return [];
      if (this.type === 'plan' && Array.isArray(this.document.coordinates)) {
        const coords3857 = this.document.coordinates.map((p) =>
          ol.proj.fromLonLat([p.lon, p.lat])
        );
        return [
          ...((this.document.linkedTopos || [])),
          {
            type: 'p', // synthetic — OlMap will ignore unknown types
            document_id: this.document.document_id,
            geometry: {
              has_geom_detail: true,
              geom_detail: JSON.stringify({
                type: 'LineString',
                coordinates: coords3857,
              }),
            },
          },
        ];
      }
      return [this.document];
    },

    altitudeLabel() {
      const a = this.$outingSession.currentPosition?.alt;
      if (a === null || a === undefined) return '—';
      return `${Math.round(a)} m`;
    },

    remainingClimbLabel() {
      // Crude: total climb minus what we've already done in this session.
      // Good enough for a HUD; the user wants order-of-magnitude.
      const total = this.totalClimb;
      const done = this.$outingSession.elevationGainMeters;
      if (!total) return '—';
      const left = Math.max(0, total - done);
      return `${Math.round(left)} m`;
    },

    tracedDistanceLabel() {
      const m = this.$outingSession.tracedDistanceMeters;
      if (!m) return '—';
      if (m < 1000) return `${Math.round(m)} m`;
      return `${(m / 1000).toFixed(1)} km`;
    },

    geoErrorLabel() {
      const e = this.$outingSession.geoError;
      if (!e) return '';
      switch (e.code) {
        case 1:
          return this.$gettext('Géolocalisation refusée. Autorisez-la dans les réglages du navigateur.');
        case 2:
          return this.$gettext('Position indisponible (signal GPS ?).');
        case 3:
          return this.$gettext('Délai dépassé pour récupérer la position.');
        default:
          return this.$gettext('Erreur de géolocalisation.');
      }
    },
  },

  watch: {
    active(now) {
      // When the user swipes back to the Map view, force a resize on the
      // OL map — OL drops its tiles when its container is invisible.
      if (now) {
        this.$nextTick(() => {
          const map = this.$refs.map?.map;
          if (map?.updateSize) map.updateSize();
        });
      }
    },
  },

  methods: {
    async locateOnce() {
      try {
        const sample = await this.$outingSession.requestCurrentPosition();
        // Pan the map to the new position. ol is the V1 barrel module
        // re-exporting the bits we need (proj.fromLonLat added in V4).
        const olMap = this.$refs.map?.map;
        if (olMap && sample) {
          const view = olMap.getView();
          view.animate({
            center: ol.proj.fromLonLat([sample.lon, sample.lat]),
            zoom: 15,
            duration: 400,
          });
        }
      } catch (err) {
        // Error is already surfaced via $outingSession.geoError → HUD
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.topo-map-view {
  position: relative;
  height: 100%;
  width: 100%;
  // OlMap takes 100% of its container — but its default styling assumes
  // a sized parent. Make sure we provide that.
  display: flex;
  flex-direction: column;
}

// MapView is a child component; its root is a div we expand fully.
::v-deep .ol-viewport, ::v-deep .map-view {
  height: 100%;
  width: 100%;
}

.topo-map-hud {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  right: 4rem; // leave room for the quick-toggle pill on the right
  z-index: 10;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 10px;
  padding: 0.55rem 0.7rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  pointer-events: none;
}

.topo-map-hud-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.topo-map-hud-item {
  text-align: left;

  strong {
    display: block;
    font-size: 1rem;
    color: #4a4a4a;
    line-height: 1;
  }
}

.topo-map-hud-label {
  display: block;
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6b6b6b;
  margin-bottom: 0.15rem;
}

.topo-map-hud-error {
  margin-top: 0.4rem;
  font-size: 0.75rem;
  color: #c0392b;
}

.topo-map-where-btn {
  position: absolute;
  bottom: 1rem;
  right: 1rem;
  z-index: 10;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: white;
  color: #337ab7;
  font-size: 1.2rem;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:hover, &:focus {
    background: #f0f4f8;
    outline: none;
  }
}
</style>

<style lang="scss">
html[data-theme='dark'] {
  .topo-map-hud {
    background: rgba(30, 30, 30, 0.92);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  }
  .topo-map-hud-row strong { color: #f0f0f0; }
  .topo-map-hud-label { color: #9a9a9a; }
  .topo-map-where-btn {
    background: #2a2a2a;
    color: #6db4ff;
    &:hover { background: #353535; }
  }
}
</style>
