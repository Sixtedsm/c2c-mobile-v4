<template>
  <div class="topo-progress-view">
    <div class="topo-progress-header">
      <h2>
        <fa-icon icon="chart-line" />
        &nbsp;{{ disciplineLabel }}
      </h2>
      <p>{{ disciplineHint }}</p>
    </div>

    <!-- Big numbers: current vs total. The one thing you want when
         you're 800m up and tired: "how much longer?". -->
    <div class="topo-progress-bignums">
      <div class="topo-progress-bignum">
        <span class="topo-progress-bignum-label">{{ $gettext('Altitude') }}</span>
        <strong>{{ altitudeLabel }}</strong>
        <small v-if="document.elevation_max">/ {{ document.elevation_max }} m</small>
      </div>
      <div class="topo-progress-bignum">
        <span class="topo-progress-bignum-label">{{ $gettext('Montée') }}</span>
        <strong>+{{ Math.round($outingSession.elevationGainMeters) }} m</strong>
        <small v-if="document.height_diff_up">/ +{{ document.height_diff_up }} m</small>
      </div>
      <div class="topo-progress-bignum">
        <span class="topo-progress-bignum-label">{{ $gettext('Durée') }}</span>
        <strong>{{ elapsedLabel }}</strong>
      </div>
    </div>

    <!-- Progress bar — % of climb done if the doc has total climb. -->
    <div v-if="progressPercent !== null" class="topo-progress-bar-wrap">
      <div class="topo-progress-bar">
        <div class="topo-progress-bar-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <small>{{ progressPercent }}% {{ $gettext('du dénivelé total') }}</small>
    </div>

    <!-- D3 altitude chart drawn off the recorded trace (if any) and/or
         the topo's geom_detail (if available). -->
    <div class="topo-progress-chart-wrap">
      <svg ref="chart" class="topo-progress-chart"></svg>
      <p v-if="!hasChartData" class="topo-progress-empty">
        {{ $gettext('Profil altimétrique disponible une fois que la trace est démarrée ou si le topo contient un tracé GPS.') }}
      </p>
    </div>
  </div>
</template>

<script>
// V4 — altitude profile + live position.
//
// D3 is already in the project deps (used by elevation profile in V1).
// We keep the rendering self-contained: parse coordinates → build
// scales → draw line + the user's current-position marker. Re-renders
// when the page becomes active or the session position updates.

import * as d3 from 'd3';

// Extract [time?, distance, altitude] samples from either:
//  1. The recorded session positions (live trace), or
//  2. The doc's geom_detail (route polyline with altitude in z).
function buildSeries(session, doc) {
  // 1. Recorded trace wins — it represents reality.
  if (session?.positions?.length > 1) {
    let acc = 0;
    let prev = session.positions[0];
    const out = [{ d: 0, alt: prev.alt ?? 0, t: prev.t }];
    const haversine = (a, b) => {
      const R = 6371000;
      const toRad = (v) => (v * Math.PI) / 180;
      const dLat = toRad(b.lat - a.lat);
      const dLon = toRad(b.lon - a.lon);
      const lat1 = toRad(a.lat);
      const lat2 = toRad(b.lat);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    for (let i = 1; i < session.positions.length; i += 1) {
      const cur = session.positions[i];
      acc += haversine(prev, cur);
      out.push({ d: acc, alt: cur.alt ?? out[out.length - 1].alt, t: cur.t });
      prev = cur;
    }
    return { points: out, source: 'session' };
  }

  // 2. Doc's geom_detail is a GeoJSON LineString in EPSG:3857 (web
  // mercator). To extract altitudes we'd need a 3-D coord which the C2C
  // API may or may not expose depending on the doc. If unavailable,
  // bail and let the UI show "no chart" until the user starts walking.
  const geom = doc?.geometry?.geom_detail;
  if (!geom) return { points: [], source: 'none' };
  try {
    const parsed = typeof geom === 'string' ? JSON.parse(geom) : geom;
    if (parsed.type !== 'LineString') return { points: [], source: 'none' };
    const coords = parsed.coordinates;
    if (!coords || coords.length < 2) return { points: [], source: 'none' };
    const hasZ = coords[0].length >= 3;
    if (!hasZ) return { points: [], source: 'none' };
    let acc = 0;
    const out = [{ d: 0, alt: coords[0][2] }];
    const fromMerc = (xy) => {
      // Approximate web-mercator → meters distance along the path.
      // Mercator x/y are already in meters at the equator; for
      // distance estimation along a trail the error is acceptable.
      return [xy[0], xy[1]];
    };
    let prev = fromMerc(coords[0]);
    for (let i = 1; i < coords.length; i += 1) {
      const cur = fromMerc(coords[i]);
      const dx = cur[0] - prev[0];
      const dy = cur[1] - prev[1];
      acc += Math.sqrt(dx * dx + dy * dy);
      out.push({ d: acc, alt: coords[i][2] });
      prev = cur;
    }
    return { points: out, source: 'doc' };
  } catch {
    return { points: [], source: 'none' };
  }
}

export default {
  name: 'TopoProgressView',

  props: {
    document: { type: Object, required: true },
    discipline: { type: String, default: 'hiking' },
    active: { type: Boolean, default: false },
  },

  data() {
    return {
      now: Date.now(),
      tickHandle: null,
    };
  },

  computed: {
    altitudeLabel() {
      const a = this.$outingSession.currentPosition?.alt;
      if (a === null || a === undefined) return '—';
      return `${Math.round(a)} m`;
    },

    progressPercent() {
      const total = this.document?.height_diff_up;
      const done = this.$outingSession.elevationGainMeters;
      if (!total) return null;
      return Math.min(100, Math.round((done / total) * 100));
    },

    elapsedLabel() {
      const s = this.$outingSession;
      if (!s.startedAt) return '—';
      const sec = Math.floor((this.now - s.startedAt) / 1000);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
      return `${m} min`;
    },

    disciplineLabel() {
      switch (this.discipline) {
        case 'climbing': return this.$gettext('Progression dans la voie');
        case 'skitouring': return this.$gettext('Montée / descente');
        case 'mountaineering': return this.$gettext('Progression alpinisme');
        default: return this.$gettext('Progression');
      }
    },
    disciplineHint() {
      switch (this.discipline) {
        case 'climbing':
          return this.$gettext('Suit le dénivelé montée pour estimer le nombre de longueurs grimpées.');
        case 'skitouring':
          return this.$gettext('Altitude actuelle + montée déjà faite. Important pour décider la conversion.');
        case 'mountaineering':
          return this.$gettext('Indispensable pour caler les horaires et anticiper le retour au refuge.');
        default:
          return this.$gettext('Position courante sur le profil + temps écoulé.');
      }
    },

    hasChartData() {
      return this.series.points.length > 1;
    },

    series() {
      // Re-computed when sessions update — that's fine, the points
      // array is small (< 5000 entries for a multi-day trek).
      return buildSeries(this.$outingSession, this.document);
    },
  },

  mounted() {
    this.tickHandle = window.setInterval(() => {
      this.now = Date.now();
    }, 30000);
    if (this.active) this.$nextTick(() => this.renderChart());
  },

  beforeDestroy() {
    if (this.tickHandle) window.clearInterval(this.tickHandle);
  },

  watch: {
    active(now) {
      if (now) this.$nextTick(() => this.renderChart());
    },
    series: {
      handler() {
        if (this.active) this.renderChart();
      },
      deep: false,
    },
  },

  methods: {
    renderChart() {
      const svg = d3.select(this.$refs.chart);
      if (svg.empty()) return;
      const node = svg.node();
      const width = node?.parentElement?.clientWidth || 320;
      const height = 180;
      svg.selectAll('*').remove();
      svg.attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height);

      const points = this.series.points;
      if (points.length < 2) return;

      const margin = { top: 14, right: 14, bottom: 22, left: 36 };
      const w = width - margin.left - margin.right;
      const h = height - margin.top - margin.bottom;

      const x = d3.scaleLinear().domain([0, points[points.length - 1].d]).range([0, w]);
      const yExtent = d3.extent(points, (p) => p.alt);
      const yPad = Math.max(50, (yExtent[1] - yExtent[0]) * 0.1);
      const y = d3.scaleLinear().domain([yExtent[0] - yPad, yExtent[1] + yPad]).range([h, 0]);

      const g = svg.append('g').attr('transform', `translate(${margin.left}, ${margin.top})`);

      // Area under curve (subtle fill).
      const area = d3.area()
        .x((p) => x(p.d))
        .y0(h)
        .y1((p) => y(p.alt))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(points)
        .attr('d', area)
        .attr('fill', 'rgba(255, 153, 51, 0.15)');

      const line = d3.line()
        .x((p) => x(p.d))
        .y((p) => y(p.alt))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(points)
        .attr('d', line)
        .attr('fill', 'none')
        .attr('stroke', '#ff9933')
        .attr('stroke-width', 2);

      // Axes
      const xTickFmt = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`);
      g.append('g')
        .attr('transform', `translate(0, ${h})`)
        .call(d3.axisBottom(x).ticks(4).tickFormat(xTickFmt))
        .attr('color', 'currentColor')
        .selectAll('text')
        .style('font-size', '0.65rem');
      g.append('g')
        .call(d3.axisLeft(y).ticks(4).tickFormat((v) => `${Math.round(v)} m`))
        .attr('color', 'currentColor')
        .selectAll('text')
        .style('font-size', '0.65rem');

      // Live position marker — only when the recorded trace drives the
      // chart AND we have a current position.
      const session = this.$outingSession;
      if (this.series.source === 'session' && session.currentPosition && points.length > 1) {
        const last = points[points.length - 1];
        g.append('circle')
          .attr('cx', x(last.d))
          .attr('cy', y(last.alt))
          .attr('r', 6)
          .attr('fill', '#ff9933')
          .attr('stroke', 'white')
          .attr('stroke-width', 2);
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.topo-progress-view {
  padding: 0.75rem;
}

.topo-progress-header {
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

.topo-progress-bignums {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.4rem;
  margin-bottom: 0.75rem;
}

.topo-progress-bignum {
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 0.55rem;
  text-align: center;

  strong {
    display: block;
    font-size: 1.25rem;
    color: #4a4a4a;
    line-height: 1;
    margin-top: 0.25rem;
  }
  small {
    display: block;
    font-size: 0.7rem;
    color: #6b6b6b;
    margin-top: 0.15rem;
  }
}

.topo-progress-bignum-label {
  display: block;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6b6b6b;
}

.topo-progress-bar-wrap {
  margin-bottom: 1rem;

  small {
    display: block;
    margin-top: 0.3rem;
    font-size: 0.72rem;
    color: #6b6b6b;
    text-align: right;
  }
}

.topo-progress-bar {
  height: 8px;
  background: rgba(0, 0, 0, 0.08);
  border-radius: 4px;
  overflow: hidden;
}

.topo-progress-bar-fill {
  height: 100%;
  background: linear-gradient(to right, #ff9933, #cc7a29);
  transition: width 0.4s ease;
}

.topo-progress-chart-wrap {
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 0.5rem;
  color: #4a4a4a;
}

.topo-progress-chart {
  width: 100%;
  height: 180px;
  display: block;
  color: currentColor;
}

.topo-progress-empty {
  text-align: center;
  color: #9a9a9a;
  font-size: 0.85rem;
  padding: 0.8rem 0.5rem;
  font-style: italic;
  margin: 0;
}
</style>

<style lang="scss">
html[data-theme='dark'] {
  .topo-progress-view .topo-progress-header h2 { color: #f5f5f5; }
  .topo-progress-view .topo-progress-header p { color: #b5b5b5; }
  .topo-progress-view .topo-progress-bignum {
    background: #2a2a2a;
    border-color: rgba(255, 255, 255, 0.08);
    strong { color: #f5f5f5; }
    small { color: #9a9a9a; }
  }
  .topo-progress-view .topo-progress-bignum-label { color: #9a9a9a; }
  .topo-progress-view .topo-progress-bar { background: rgba(255, 255, 255, 0.08); }
  .topo-progress-view .topo-progress-bar-wrap small { color: #9a9a9a; }
  .topo-progress-view .topo-progress-chart-wrap {
    background: #2a2a2a;
    border-color: rgba(255, 255, 255, 0.08);
    color: #e5e5e5;
  }
  .topo-progress-view .topo-progress-empty { color: #6b6b6b; }
}
</style>
