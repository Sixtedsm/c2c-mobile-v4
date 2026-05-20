<template>
  <div class="topo-description-view">
    <!-- Image gallery up top if the doc has associated images -->
    <div v-if="galleryImages.length" class="topo-gallery">
      <div class="topo-gallery-track">
        <div
          v-for="(image, i) in galleryImages"
          :key="image.document_id || i"
          class="topo-gallery-slide"
        >
          <img
            :src="imageUrl(image)"
            :alt="imageTitle(image)"
            loading="lazy"
          />
          <div v-if="imageTitle(image)" class="topo-gallery-caption">
            {{ imageTitle(image) }}
          </div>
        </div>
      </div>
    </div>

    <div class="topo-description-body">
      <!-- Plans get a different layout: their own title block + linked
           topos as proper card-like rows. C2C docs use the cooked HTML
           sections below. -->
      <template v-if="type === 'plan'">
        <div class="topo-plan-summary">
          <div class="topo-plan-meta">
            <span v-if="document.discipline" class="tag">
              {{ $gettext(document.discipline, 'discipline') }}
            </span>
            <span v-if="document.days" class="tag">
              {{ document.days }} {{ document.days > 1 ? $gettext('jours') : $gettext('jour') }}
            </span>
          </div>
          <router-link
            :to="{ name: 'plan-edit', params: { id: document.document_id } }"
            class="button is-small topo-plan-edit-btn"
          >
            <fa-icon icon="pen-to-square" />
            &nbsp;{{ $gettext('Modifier le plan') }}
          </router-link>
        </div>

        <section v-if="document.generalNotes" class="topo-section">
          <h2>{{ $gettext('Notes générales') }}</h2>
          <p class="topo-cooked" style="white-space: pre-wrap">{{ document.generalNotes }}</p>
        </section>

        <section v-if="document.linkedTopos && document.linkedTopos.length" class="topo-section">
          <h2>{{ $gettext('Topos C2C liés au plan') }}</h2>
          <ul class="topo-plan-linked">
            <li v-for="t in document.linkedTopos" :key="t.type + '-' + t.document_id">
              <fa-icon icon="link" />
              <span>{{ $documentUtils.getDocumentTitle(t, lang) || '#' + t.document_id }}</span>
              <small>{{ $gettext($documentUtils.getDocumentType(t.type) || t.type, 'doctype') }}</small>
            </li>
          </ul>
        </section>

        <!-- Multi-day stops curated in the planner -->
        <section v-if="planDays.length" class="topo-section">
          <h2>{{ $gettext('Étapes & arrêts') }}</h2>
          <div v-for="day in planDays" :key="'d' + day.day" class="topo-plan-day">
            <header>
              <strong>{{ $gettext('Jour') }} {{ day.day }}</strong>
              <span>{{ day.stops.length }} {{ $gettext('arrêt(s)') }}</span>
            </header>
            <ul v-if="day.stops.length">
              <li v-for="stop in day.stops" :key="stop.id">
                <span class="topo-plan-stop-icon">{{ stopEmoji(stop.type) }}</span>
                <div class="topo-plan-stop-body">
                  <strong>{{ stop.name }}</strong>
                  <small v-if="stop.notes">{{ stop.notes }}</small>
                </div>
              </li>
            </ul>
          </div>
        </section>

        <p v-if="!document.generalNotes && (!document.linkedTopos || !document.linkedTopos.length) && !planDays.length" class="topo-empty">
          {{ $gettext('Plan en cours de construction. Ouvrez l\'édition pour le compléter.') }}
        </p>
      </template>

      <!-- C2C docs only: discipline-specific quick stats strip — extremely
           glanceable because in the field you don't have time to scroll
           a wall of text to find "ok how long is the approach". -->
      <div v-if="type !== 'plan'" class="topo-quickstats">
        <div v-for="stat in quickStats" :key="stat.label" class="topo-quickstat">
          <span class="topo-quickstat-icon">
            <fa-icon :icon="stat.icon" />
          </span>
          <div>
            <strong>{{ stat.value }}</strong>
            <small>{{ stat.label }}</small>
          </div>
        </div>
      </div>

      <!-- Cooked HTML sections from the C2C document — kept as-is so
           the user sees the same content as on the website. -->
      <section v-if="cookedTitle" class="topo-section">
        <h2>{{ $gettext('Description') }}</h2>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="topo-cooked" v-html="cookedTitle"></div>
      </section>

      <section v-if="cookedDescription" class="topo-section">
        <h2>{{ $gettext('Itinéraire') }}</h2>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="topo-cooked" v-html="cookedDescription"></div>
      </section>

      <section v-if="cookedRemarks" class="topo-section">
        <h2>{{ $gettext('Remarques') }}</h2>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="topo-cooked" v-html="cookedRemarks"></div>
      </section>

      <section v-if="cookedSummary" class="topo-section">
        <h2>{{ $gettext('Résumé') }}</h2>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="topo-cooked" v-html="cookedSummary"></div>
      </section>

      <section v-if="cookedExternalResources" class="topo-section">
        <h2>{{ $gettext('Autres ressources') }}</h2>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="topo-cooked" v-html="cookedExternalResources"></div>
      </section>

      <p v-if="!hasAnyContent" class="topo-empty">
        {{ $gettext('Ce topo ne contient pas de description détaillée.') }}
      </p>
    </div>
  </div>
</template>

<script>
import { getImageUrl } from '@/js/image-urls';

// Read the discipline-aware "what matters most" stats from the doc.
// Each discipline has its own short list — we don't try to be complete,
// we try to be useful in the field.
function statsFor(doc, discipline, gettext) {
  if (!doc) return [];
  const s = [];
  const push = (icon, value, label) => {
    if (value !== null && value !== undefined && value !== '') s.push({ icon, value, label });
  };
  if (discipline === 'climbing') {
    push(['fas', 'ruler-vertical'], doc.height_diff_up && `${doc.height_diff_up} m`, gettext('Hauteur paroi'));
    push(['fas', 'list-ol'], doc.elevation_max && `${doc.elevation_max} m`, gettext('Sommet'));
    push(['fas', 'rocket'], doc.global_rating, gettext('Cotation globale'));
    push(['fas', 'mountain'], doc.rock_free_rating || doc.aid_rating, gettext('Cotation'));
    push(['fas', 'route'], doc.route_length && `${doc.route_length} m`, gettext('Longueur'));
  } else if (discipline === 'skitouring') {
    push(['fas', 'mountain'], doc.height_diff_up && `+${doc.height_diff_up} m`, gettext('Dénivelé montée'));
    push(['fas', 'arrow-down'], doc.height_diff_down && `${doc.height_diff_down} m`, gettext('Dénivelé descente'));
    push(['fas', 'snowflake'], doc.ski_rating, gettext('Cotation ski'));
    push(['fas', 'compass'], doc.ski_exposition, gettext('Exposition'));
    push(['fas', 'list-ol'], doc.elevation_max && `${doc.elevation_max} m`, gettext('Altitude max'));
  } else if (discipline === 'mountaineering') {
    push(['fas', 'mountain'], doc.height_diff_up && `+${doc.height_diff_up} m`, gettext('Dénivelé'));
    push(['fas', 'list-ol'], doc.elevation_max && `${doc.elevation_max} m`, gettext('Altitude max'));
    push(['fas', 'rocket'], doc.global_rating, gettext('Cotation globale'));
    push(['fas', 'snowflake'], doc.glacier_rating, gettext('Cotation glacier'));
    push(['fas', 'shield-halved'], doc.engagement_rating, gettext('Engagement'));
  } else {
    // hiking / default
    push(['fas', 'route'], doc.route_length && `${(doc.route_length / 1000).toFixed(1)} km`, gettext('Distance'));
    push(['fas', 'mountain'], doc.height_diff_up && `+${doc.height_diff_up} m`, gettext('Dénivelé+'));
    push(['fas', 'arrow-down'], doc.height_diff_down && `${doc.height_diff_down} m`, gettext('Dénivelé−'));
    push(['fas', 'list-ol'], doc.elevation_max && `${doc.elevation_max} m`, gettext('Altitude max'));
    push(['fas', 'rocket'], doc.global_rating || doc.hiking_rating, gettext('Difficulté'));
  }
  return s.slice(0, 6);
}

export default {
  name: 'TopoDescriptionView',

  props: {
    document: { type: Object, required: true },
    discipline: { type: String, default: 'hiking' },
    type: { type: String, required: true },
    lang: { type: String, required: true },
  },

  computed: {
    locale() {
      if (!this.document?.locales?.length) return null;
      return (
        this.document.locales.find((l) => l.lang === this.lang) ||
        this.document.locales[0]
      );
    },

    cookedDescription() {
      return this.document?.cooked?.description || this.locale?.description || '';
    },
    cookedRemarks() {
      return this.document?.cooked?.remarks || this.locale?.remarks || '';
    },
    cookedSummary() {
      return this.document?.cooked?.summary || this.locale?.summary || '';
    },
    cookedExternalResources() {
      return (
        this.document?.cooked?.external_resources ||
        this.locale?.external_resources ||
        ''
      );
    },
    cookedTitle() {
      // For "Description" section: combine title_prefix and locale title
      // only if there's body text below in this view too.
      return '';
    },

    hasAnyContent() {
      return !!(this.cookedDescription || this.cookedRemarks || this.cookedSummary || this.cookedExternalResources);
    },

    galleryImages() {
      return this.document?.associations?.images || [];
    },

    quickStats() {
      return statsFor(this.document, this.discipline, this.$gettext);
    },

    // For plan-type documents: group stops by day so the experience
    // view shows them as N day-cards. Returns empty array when the
    // doc isn't a plan or has no stops.
    planDays() {
      if (this.type !== 'plan' || !this.document?.stops?.length) return [];
      const byDay = new Map();
      for (const s of this.document.stops) {
        if (!byDay.has(s.day)) byDay.set(s.day, []);
        byDay.get(s.day).push(s);
      }
      return Array.from(byDay.keys())
        .sort((a, b) => a - b)
        .map((day) => ({ day, stops: byDay.get(day) }));
    },
  },

  methods: {
    imageUrl(image) {
      return getImageUrl(image, 'MI') || '';
    },
    imageTitle(image) {
      if (!image) return '';
      const loc = image.locales?.find?.((l) => l.lang === this.lang) || image.locales?.[0];
      return loc?.title || '';
    },
    stopEmoji(type) {
      return {
        refuge: '🏠',
        bivouac: '⛺',
        water: '💧',
        summit: '⛰️',
        pass: '🌄',
        food: '🍴',
        view: '👁️',
        other: '📍',
      }[type] || '📍';
    },
  },
};
</script>

<style lang="scss" scoped>
.topo-description-view {
  padding: 0 0 1rem;
}

.topo-gallery {
  height: 220px;
  overflow-x: auto;
  overflow-y: hidden;
  background: #000;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
}

.topo-gallery-track {
  display: flex;
  height: 100%;
}

.topo-gallery-slide {
  flex: 0 0 100%;
  height: 100%;
  position: relative;
  scroll-snap-align: start;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.topo-gallery-caption {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
  color: white;
  padding: 1rem 0.75rem 0.5rem;
  font-size: 0.8rem;
}

.topo-description-body {
  padding: 0.75rem;
}

.topo-quickstats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 0.4rem;
  margin-bottom: 1rem;
}

.topo-quickstat {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 0.55rem 0.6rem;

  strong {
    display: block;
    font-size: 0.95rem;
    color: #4a4a4a;
    line-height: 1.1;
  }
  small {
    display: block;
    font-size: 0.65rem;
    color: #6b6b6b;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    line-height: 1;
    margin-top: 0.1rem;
  }
}

.topo-quickstat-icon {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #fff5e6;
  color: #ff9933;
  border-radius: 6px;
  font-size: 0.95rem;
}

.topo-section {
  margin: 1rem 0;

  h2 {
    font-size: 0.85rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6b6b6b;
    margin: 0 0 0.5rem;
  }
}

.topo-cooked {
  font-size: 0.95rem;
  color: #4a4a4a;
  line-height: 1.5;

  // Vue 2 SFC deep selectors — :deep() is Vue 3 syntax which Vue 2.7
  // accepts inconsistently; ::v-deep is the safe convention here.
  ::v-deep p { margin: 0 0 0.7rem; }
  ::v-deep h1, ::v-deep h2, ::v-deep h3, ::v-deep h4 {
    margin: 1rem 0 0.4rem;
    color: #4a4a4a;
  }
  ::v-deep ul, ::v-deep ol { padding-left: 1.4rem; margin: 0.4rem 0 0.7rem; }
  ::v-deep a { color: #337ab7; }
  ::v-deep img { max-width: 100%; height: auto; border-radius: 6px; }
  ::v-deep table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  ::v-deep td, ::v-deep th { padding: 0.25rem 0.5rem; border-bottom: 1px solid rgba(0, 0, 0, 0.06); }
}

.topo-empty {
  text-align: center;
  color: #9a9a9a;
  font-style: italic;
  padding: 2rem 0;
}

.topo-plan-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.topo-plan-meta {
  display: inline-flex;
  gap: 0.3rem;
  flex-wrap: wrap;

  .tag {
    background: #fff5e6;
    color: #cc7a29;
    font-weight: 600;
  }
}

.topo-plan-edit-btn {
  background: #ff9933;
  color: white;
  border: none;

  &:hover, &:focus { background: #e6791f; color: white; }
}

.topo-plan-linked {
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
    background: white;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 6px;
    font-size: 0.85rem;

    span { flex: 1 1 auto; }
    small {
      font-size: 0.7rem;
      color: #6b6b6b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
  }
}

.topo-plan-day {
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  margin-bottom: 0.5rem;
  overflow: hidden;

  > header {
    padding: 0.5rem 0.7rem;
    background: rgba(0, 0, 0, 0.02);
    border-bottom: 1px solid rgba(0, 0, 0, 0.04);
    display: flex;
    align-items: center;
    justify-content: space-between;

    strong { font-size: 0.88rem; color: #4a4a4a; }
    span { font-size: 0.7rem; color: #6b6b6b; }
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0.2rem 0;

    li {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      padding: 0.4rem 0.7rem;
      border-bottom: 1px solid rgba(0, 0, 0, 0.04);
      &:last-child { border-bottom: none; }
    }
  }
}

.topo-plan-stop-icon {
  font-size: 1.2rem;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.topo-plan-stop-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;

  strong { font-size: 0.88rem; color: #4a4a4a; }
  small { font-size: 0.74rem; color: #6b6b6b; }
}
</style>

<style lang="scss">
html[data-theme='dark'] {
  .topo-description-view .topo-quickstat {
    background: #2a2a2a;
    border-color: rgba(255, 255, 255, 0.08);
    strong { color: #f0f0f0; }
    small { color: #9a9a9a; }
  }
  .topo-description-view .topo-quickstat-icon {
    background: #3a2f1a;
  }
  .topo-description-view .topo-section h2 { color: #9a9a9a; }
  .topo-description-view .topo-cooked { color: #e5e5e5; }
  .topo-description-view .topo-cooked a { color: #6db4ff; }
  .topo-description-view .topo-empty { color: #6b6b6b; }
  .topo-description-view .topo-plan-day {
    background: #2a2a2a;
    border-color: rgba(255, 255, 255, 0.08);
    > header {
      background: rgba(255, 255, 255, 0.04);
      border-bottom-color: rgba(255, 255, 255, 0.06);
      strong { color: #f5f5f5; }
      span { color: #9a9a9a; }
    }
    li { border-bottom-color: rgba(255, 255, 255, 0.05); }
  }
  .topo-description-view .topo-plan-stop-body strong { color: #f5f5f5; }
  .topo-description-view .topo-plan-stop-body small { color: #b5b5b5; }
}
</style>
