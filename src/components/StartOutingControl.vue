<template>
  <div class="start-outing">
    <!-- Idle: prominent CTA "Démarrer" -->
    <button
      v-if="!isActiveOnThisTopo"
      type="button"
      class="start-outing-btn start-outing-btn-idle"
      @click="openStartModal"
    >
      <fa-icon icon="play" />
      <span class="is-hidden-mobile">&nbsp;{{ $gettext('Démarrer la sortie') }}</span>
    </button>

    <!-- Active on this topo: status pill + dropdown -->
    <div v-else class="start-outing-active">
      <button
        type="button"
        class="start-outing-btn start-outing-btn-active"
        :class="{ 'is-recording': $outingSession.gpsTracking }"
        @click="showMenu = !showMenu"
      >
        <span class="start-outing-dot" :class="{ 'is-recording': $outingSession.gpsTracking }"></span>
        <span class="start-outing-elapsed">{{ elapsedLabel }}</span>
      </button>

      <div v-if="showMenu" class="start-outing-menu" @click.stop>
        <div class="start-outing-menu-row">
          <label class="start-outing-toggle">
            <input
              type="checkbox"
              :checked="$outingSession.gpsTracking"
              @change="toggleTracking"
            />
            <span>{{ $gettext('Enregistrer la trace GPS') }}</span>
          </label>
          <p class="start-outing-toggle-hint">
            <template v-if="$outingSession.gpsTracking">
              {{ $outingSession.positions.length }} {{ $gettext('points · ') }}
              {{ Math.round($outingSession.tracedDistanceMeters / 100) / 10 }} km
            </template>
            <template v-else>
              {{ $gettext('La trace ne sera pas enregistrée (économise la batterie).') }}
            </template>
          </p>
        </div>

        <hr />

        <button
          v-if="$outingSession.positions.length > 0"
          type="button"
          class="start-outing-link"
          @click="exportGpx"
        >
          <fa-icon icon="download" />
          &nbsp;{{ $gettext('Exporter la trace GPX') }}
        </button>

        <button type="button" class="start-outing-link is-danger" @click="confirmStop">
          <fa-icon icon="stop" />
          &nbsp;{{ $gettext('Arrêter la sortie') }}
        </button>
      </div>
    </div>

    <!-- Click outside closes menu -->
    <div v-if="showMenu" class="start-outing-overlay" @click="showMenu = false"></div>

    <!-- Start modal -->
    <div v-if="showStartModal" class="start-outing-modal" @click.self="showStartModal = false">
      <div class="start-outing-modal-card">
        <h3>{{ $gettext('Démarrer la sortie') }}</h3>
        <p class="start-outing-modal-sub">
          {{ $gettext('Mode terrain activé : position GPS sur la carte, distance restante, gros boutons.') }}
        </p>

        <label class="start-outing-checkbox">
          <input type="checkbox" v-model="wantTracking" />
          <span>
            <strong>{{ $gettext('Enregistrer la trace GPS') }}</strong>
            <small>{{ $gettext('Position toutes les 5 s · génère un GPX à la fin · consomme de la batterie') }}</small>
          </span>
        </label>

        <div class="start-outing-modal-actions">
          <button type="button" class="button is-text" @click="showStartModal = false">
            {{ $gettext('Annuler') }}
          </button>
          <button type="button" class="button is-primary" @click="confirmStart">
            <fa-icon icon="play" />
            &nbsp;{{ $gettext('C\'est parti') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// "Démarrer la sortie" toggle. Two orthogonal switches per Sixte's brief:
//   1. sessionActive — declares "I'm on the move now". Lightweight.
//   2. gpsTracking   — actively records the trace. Battery-heavy, opt-in.
//
// Defaults to: active + no tracking. The user can flip tracking on/off
// from the same dropdown at any moment. Trace persists across the
// toggle so they can stop recording mid-sortie without losing what
// they had.

export default {
  name: 'StartOutingControl',

  props: {
    topoRef: { type: Object, required: true },
  },

  data() {
    return {
      showStartModal: false,
      showMenu: false,
      wantTracking: false,
      tickHandle: null,
      now: Date.now(),
    };
  },

  computed: {
    isActiveOnThisTopo() {
      const s = this.$outingSession;
      if (!s.sessionActive || !s.topoRef) return false;
      return (
        s.topoRef.type === this.topoRef.type &&
        String(s.topoRef.id) === String(this.topoRef.id) &&
        s.topoRef.lang === this.topoRef.lang
      );
    },
    elapsedLabel() {
      const started = this.$outingSession.startedAt;
      if (!started) return '';
      const sec = Math.floor((this.now - started) / 1000);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
      return `${m} min`;
    },
  },

  mounted() {
    // Tick once a minute to refresh elapsed time. Cheap and avoids the
    // full reactivity churn of a per-second update.
    this.tickHandle = window.setInterval(() => {
      this.now = Date.now();
    }, 30000);
  },

  beforeDestroy() {
    if (this.tickHandle) window.clearInterval(this.tickHandle);
  },

  methods: {
    openStartModal() {
      // If another session is active on a different topo, warn the user.
      const s = this.$outingSession;
      if (s.sessionActive && s.topoRef) {
        const proceed = window.confirm(
          this.$gettext(
            'Une sortie est déjà en cours sur un autre topo. La démarrer ici arrêtera la précédente. Continuer ?'
          )
        );
        if (!proceed) return;
      }
      this.wantTracking = false;
      this.showStartModal = true;
    },
    confirmStart() {
      this.$outingSession.start(this.topoRef, { track: this.wantTracking });
      this.showStartModal = false;
    },
    toggleTracking(e) {
      this.$outingSession.gpsTracking = e.target.checked;
    },
    confirmStop() {
      const hasTrace = this.$outingSession.positions.length > 0;
      let proceed = true;
      if (hasTrace) {
        proceed = window.confirm(
          this.$gettext(
            'Arrêter la sortie ? La trace enregistrée reste disponible jusqu\'à l\'export ou la prochaine sortie.'
          )
        );
      }
      if (!proceed) return;
      this.$outingSession.stop();
      this.showMenu = false;
    },
    exportGpx() {
      const gpx = this.$outingSession.exportGpx({
        name: this.$gettext('Trace Camptocamp'),
        description: `topo ${this.topoRef.type}/${this.topoRef.id}`,
      });
      const blob = new Blob([gpx], { type: 'application/gpx+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trace-${Date.now()}.gpx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.showMenu = false;
    },
  },
};
</script>

<style lang="scss" scoped>
.start-outing {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.start-outing-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.7rem;
  border: none;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  line-height: 1;
}

.start-outing-btn-idle {
  background: #ff9933;
  color: white;
  &:hover, &:focus { background: #e6791f; }
}

.start-outing-btn-active {
  background: #f0f4f8;
  color: #4a4a4a;
  border: 1px solid rgba(0, 0, 0, 0.1);

  &.is-recording {
    background: #fff5e6;
    border-color: #ff9933;
    color: #cc7a29;
  }
}

.start-outing-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4a4a4a;

  &.is-recording {
    background: #e54545;
    animation: pulseRecord 1.5s ease-in-out infinite;
  }
}

@keyframes pulseRecord {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.6; }
}

.start-outing-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 0.4rem;
  min-width: 260px;
  background: white;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 0.5rem 0.6rem;
  z-index: 50;

  hr {
    margin: 0.5rem 0;
    border: none;
    border-top: 1px solid rgba(0, 0, 0, 0.06);
  }
}

.start-outing-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
}

.start-outing-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: #4a4a4a;
  cursor: pointer;

  input { margin: 0; }
}

.start-outing-toggle-hint {
  font-size: 0.7rem;
  color: #6b6b6b;
  margin: 0.2rem 0 0 1.3rem;
}

.start-outing-link {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.45rem 0.4rem;
  background: transparent;
  border: none;
  font-size: 0.85rem;
  color: #4a4a4a;
  cursor: pointer;
  border-radius: 4px;

  &:hover { background: rgba(0, 0, 0, 0.04); }
  &.is-danger { color: #c0392b; }
  &.is-danger:hover { background: rgba(192, 57, 43, 0.08); }
}

.start-outing-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 60;
}

.start-outing-modal-card {
  background: white;
  border-radius: 12px;
  padding: 1.25rem;
  max-width: 380px;
  width: 100%;

  h3 {
    margin: 0 0 0.4rem;
    font-size: 1.15rem;
    font-weight: 700;
    color: #4a4a4a;
  }
}

.start-outing-modal-sub {
  font-size: 0.85rem;
  color: #6b6b6b;
  margin: 0 0 1rem;
  line-height: 1.4;
}

.start-outing-checkbox {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.7rem;
  background: #fff5e6;
  border-radius: 8px;
  cursor: pointer;

  input { margin-top: 0.2rem; flex: 0 0 auto; }

  > span {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    strong { font-size: 0.9rem; color: #4a4a4a; }
    small { font-size: 0.7rem; color: #6b6b6b; line-height: 1.35; }
  }
}

.start-outing-modal-actions {
  margin-top: 1rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}
</style>

<style lang="scss">
html[data-theme='dark'] {
  .start-outing-btn-active {
    background: #2f2f2f;
    color: #e5e5e5;
    border-color: rgba(255, 255, 255, 0.12);
    &.is-recording {
      background: #3a2f1a;
      color: #ffb866;
    }
  }
  .start-outing-menu {
    background: #2a2a2a;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    hr { border-top-color: rgba(255, 255, 255, 0.08); }
  }
  .start-outing-toggle { color: #e5e5e5; }
  .start-outing-toggle-hint { color: #9a9a9a; }
  .start-outing-link { color: #e5e5e5; &:hover { background: rgba(255, 255, 255, 0.06); } }
  .start-outing-modal-card { background: #2a2a2a; }
  .start-outing-modal-card h3 { color: #f5f5f5; }
  .start-outing-modal-sub { color: #b5b5b5; }
  .start-outing-checkbox {
    background: #3a2f1a;
    > span strong { color: #f5f5f5; }
    > span small { color: #b5b5b5; }
  }
}
</style>
