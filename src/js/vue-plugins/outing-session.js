// V4 — runtime session tracking when the user "Démarre la sortie" on an
// offline topo. Two orthogonal toggles:
//   - sessionActive: the user has declared they are on the move (changes
//     UI: live position on map, distance-to-go updates, big touch
//     targets). Doesn't consume battery on its own.
//   - gpsTracking: actively logging GPS positions every 5s into a local
//     trace that becomes a GPX. Battery-heavy. Off by default — the user
//     opts in only if they want a recorded trace.
//
// Both states survive a route change because the plugin lives at the
// Vue prototype level. Reload-survival is handled by snapshotting to
// localStorage on every change so the user doesn't lose their trace on
// app refresh / OS-killed-tab.

import Vue from 'vue';

const STORAGE_KEY = 'v4.outingSession';
const TRACK_INTERVAL_MS = 5000; // GPS sample rate
const MIN_DISTANCE_M = 3; // ignore jitter under 3m (urban canyon GPS noise)

function loadSnapshot() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Sanity: drop stale sessions (>48h) to avoid resuming a forgotten
    // tracking run that drained battery overnight.
    if (parsed.startedAt && Date.now() - parsed.startedAt > 48 * 3600 * 1000) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persist(state) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessionActive: state.sessionActive,
        gpsTracking: state.gpsTracking,
        topoRef: state.topoRef,
        startedAt: state.startedAt,
        positions: state.positions,
      })
    );
  } catch {
    // localStorage full or denied — ignore, session won't survive reload
  }
}

// Great-circle distance (Haversine) for jitter filtering and trace
// distance computation. Accurate enough for outdoor distances.
function haversine(a, b) {
  if (!a || !b) return 0;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function install(Vue) {
  const snap = loadSnapshot();

  const vm = new Vue({
    name: 'OutingSession',

    data() {
      return {
        sessionActive: !!snap?.sessionActive,
        gpsTracking: false, // Always restart GPS tracking off — never silently log without the user re-opting in
        topoRef: snap?.topoRef || null,
        startedAt: snap?.startedAt || null,
        currentPosition: null,
        positions: snap?.positions || [],
        // Browser geolocation watch id (returned by watchPosition)
        watchId: null,
        // Last error from the browser geolocation API
        geoError: null,
      };
    },

    computed: {
      // Distance covered by the recorded trace (meters).
      tracedDistanceMeters() {
        let d = 0;
        for (let i = 1; i < this.positions.length; i += 1) {
          d += haversine(this.positions[i - 1], this.positions[i]);
        }
        return d;
      },
      // Elevation gain / loss along the recorded trace (meters).
      elevationGainMeters() {
        let g = 0;
        for (let i = 1; i < this.positions.length; i += 1) {
          const da = (this.positions[i].alt || 0) - (this.positions[i - 1].alt || 0);
          if (da > 0) g += da;
        }
        return g;
      },
      elevationLossMeters() {
        let l = 0;
        for (let i = 1; i < this.positions.length; i += 1) {
          const da = (this.positions[i].alt || 0) - (this.positions[i - 1].alt || 0);
          if (da < 0) l += -da;
        }
        return l;
      },
    },

    watch: {
      sessionActive: 'snapshot',
      gpsTracking(active) {
        if (active) this.startGpsWatch();
        else this.stopGpsWatch();
        this.snapshot();
      },
      positions: { handler: 'snapshot', deep: false },
      topoRef: { handler: 'snapshot', deep: true },
    },

    methods: {
      snapshot() {
        persist(this.$data);
      },

      // Start an outing on a given topo. Does NOT enable GPS tracking
      // unless the caller passes { track: true }.
      start({ type, id, lang }, { track = false } = {}) {
        this.sessionActive = true;
        this.topoRef = { type, id, lang };
        this.startedAt = Date.now();
        this.positions = [];
        this.gpsTracking = !!track;
      },

      // Stop the outing entirely — clears tracking and forgets the topo.
      stop() {
        this.gpsTracking = false;
        this.sessionActive = false;
        this.topoRef = null;
        this.startedAt = null;
        // Trace kept in memory until export/discard so the user can
        // attach it to a created outing right after.
      },

      // Live "where am I" one-shot, doesn't start the tracking loop.
      requestCurrentPosition() {
        return new Promise((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error('Geolocation API unavailable'));
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const sample = {
                lat: pos.coords.latitude,
                lon: pos.coords.longitude,
                alt: pos.coords.altitude,
                accuracy: pos.coords.accuracy,
                t: pos.timestamp || Date.now(),
              };
              this.currentPosition = sample;
              resolve(sample);
            },
            (err) => {
              this.geoError = err;
              reject(err);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
          );
        });
      },

      // Long-running watch — fired every TRACK_INTERVAL_MS-ish.
      startGpsWatch() {
        if (!navigator.geolocation || this.watchId !== null) return;
        let lastSampleTime = 0;
        this.watchId = navigator.geolocation.watchPosition(
          (pos) => {
            const now = pos.timestamp || Date.now();
            // Browser may fire much more often than we need; throttle here.
            if (now - lastSampleTime < TRACK_INTERVAL_MS - 500) return;
            const sample = {
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              alt: pos.coords.altitude,
              accuracy: pos.coords.accuracy,
              t: now,
            };
            this.currentPosition = sample;
            // Jitter filter: only log if we moved at least MIN_DISTANCE_M
            const last = this.positions[this.positions.length - 1];
            if (!last || haversine(last, sample) >= MIN_DISTANCE_M) {
              this.positions = [...this.positions, sample];
              lastSampleTime = now;
            }
          },
          (err) => {
            this.geoError = err;
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
      },

      stopGpsWatch() {
        if (this.watchId !== null && navigator.geolocation) {
          navigator.geolocation.clearWatch(this.watchId);
        }
        this.watchId = null;
      },

      // Discard the recorded trace (e.g., user doesn't want to keep it
      // after stopping the session).
      discardTrace() {
        this.positions = [];
        this.snapshot();
      },

      // Build a GPX 1.1 document from the recorded trace. Standard
      // format compatible with Garmin / Strava / Komoot / etc.
      exportGpx({ name = 'Sortie Camptocamp', description = '' } = {}) {
        const escape = (s) =>
          String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        const trkpts = this.positions
          .map((p) => {
            const ele = Number.isFinite(p.alt) ? `      <ele>${p.alt.toFixed(1)}</ele>\n` : '';
            const time = p.t ? `      <time>${new Date(p.t).toISOString()}</time>\n` : '';
            return `    <trkpt lat="${p.lat}" lon="${p.lon}">\n${ele}${time}    </trkpt>`;
          })
          .join('\n');
        return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Camptocamp mobile V4" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escape(name)}</name>
    <desc>${escape(description)}</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${escape(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
      },
    },

    beforeDestroy() {
      this.stopGpsWatch();
    },
  });

  Vue.prototype.$outingSession = vm;
}

export { haversine };
