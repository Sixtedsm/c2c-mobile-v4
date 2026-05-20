<template>
  <div class="topo-safety-view">
    <header class="safety-header">
      <h2>
        <fa-icon icon="triangle-exclamation" />
        &nbsp;{{ $gettext('Sécurité & conditions') }}
      </h2>
      <p>
        {{ $gettext('Informations cachées de votre dernière connexion. Vérifiez-les avant de partir et confrontez à ce que vous observez.') }}
      </p>
    </header>

    <!-- Emergency call card — always first. -->
    <section class="safety-card safety-card--emergency">
      <h3>{{ $gettext('Numéros d\'urgence') }}</h3>
      <ul class="safety-emergency-list">
        <li>
          <a href="tel:112">
            <strong>112</strong>
            <span>{{ $gettext('Numéro d\'urgence européen (priorité)') }}</span>
          </a>
        </li>
        <li>
          <a href="tel:15">
            <strong>15</strong>
            <span>{{ $gettext('SAMU (France)') }}</span>
          </a>
        </li>
        <li>
          <a href="tel:18">
            <strong>18</strong>
            <span>{{ $gettext('Pompiers (France)') }}</span>
          </a>
        </li>
      </ul>
      <p class="safety-hint">
        {{ $gettext('En montagne le 112 reroute vers le PGHM / secours alpin le plus proche. Donnez votre position GPS si possible.') }}
      </p>
    </section>

    <!-- Discipline-specific cards -->
    <section v-if="showAvalancheCard" class="safety-card">
      <h3>
        <fa-icon icon="snowflake" />
        &nbsp;{{ $gettext('Risque avalanche') }}
      </h3>
      <p>
        {{ $gettext('Avant de partir, consultez le BERA local (Météo-France ou SLF) puis cachez-le ici en ouvrant le bulletin sur le web pendant que vous êtes connecté.') }}
      </p>
      <p class="safety-key" v-if="document.ski_exposition || document.glacier_rating">
        <span v-if="document.ski_exposition">
          {{ $gettext('Exposition ski:') }} <strong>{{ document.ski_exposition }}</strong>
        </span>
        <span v-if="document.glacier_rating">
          {{ $gettext('Glacier:') }} <strong>{{ document.glacier_rating }}</strong>
        </span>
      </p>
      <a href="https://meteofrance.com/meteo-montagne/bulletin-avalanches" target="_blank" rel="noopener" class="safety-link">
        Météo-France BERA
        <fa-icon icon="up-right-from-square" />
      </a>
      <a href="https://www.slf.ch/fr/bulletin-davalanches.html" target="_blank" rel="noopener" class="safety-link">
        SLF (Suisse)
        <fa-icon icon="up-right-from-square" />
      </a>
    </section>

    <section v-if="showMountaineeringCard" class="safety-card">
      <h3>
        <fa-icon icon="mountain" />
        &nbsp;{{ $gettext('Spécificités alpinisme') }}
      </h3>
      <ul class="safety-bullets">
        <li v-if="document.engagement_rating">
          {{ $gettext('Engagement:') }} <strong>{{ document.engagement_rating }}</strong>
        </li>
        <li v-if="document.risk_rating">
          {{ $gettext('Risque objectif:') }} <strong>{{ document.risk_rating }}</strong>
        </li>
        <li v-if="document.equipment_rating">
          {{ $gettext('Équipement:') }} <strong>{{ document.equipment_rating }}</strong>
        </li>
        <li v-if="document.exposition_rock_rating">
          {{ $gettext('Expo rocher:') }} <strong>{{ document.exposition_rock_rating }}</strong>
        </li>
      </ul>
      <p class="safety-hint">
        {{ $gettext('Vérifiez l\'état du glacier et les chutes de pierres récentes en refuge avant le départ.') }}
      </p>
    </section>

    <section v-if="showClimbingCard" class="safety-card">
      <h3>
        <fa-icon icon="mountain-sun" />
        &nbsp;{{ $gettext('Spécificités escalade') }}
      </h3>
      <ul class="safety-bullets">
        <li v-if="document.rock_free_rating">
          {{ $gettext('Cotation libre:') }} <strong>{{ document.rock_free_rating }}</strong>
        </li>
        <li v-if="document.rock_required_rating">
          {{ $gettext('Cotation oblig.:') }} <strong>{{ document.rock_required_rating }}</strong>
        </li>
        <li v-if="document.equipment_rating">
          {{ $gettext('Équipement:') }} <strong>{{ document.equipment_rating }}</strong>
        </li>
        <li v-if="document.exposition_rock_rating">
          {{ $gettext('Exposition:') }} <strong>{{ document.exposition_rock_rating }}</strong>
        </li>
      </ul>
    </section>

    <!-- Weather: external links + offline reminder. We don't fetch in
         real time (we'd be offline by definition), but pointing to the
         right URLs that the user might have cached ahead of time. -->
    <section class="safety-card">
      <h3>
        <fa-icon icon="cloud" />
        &nbsp;{{ $gettext('Météo') }}
      </h3>
      <p>{{ $gettext('À consulter dans les 24 h avant départ. Notez les éléments importants dans la vue « Notes » pour les retrouver hors-ligne.') }}</p>
      <a href="https://meteofrance.com/" target="_blank" rel="noopener" class="safety-link">
        Météo-France
        <fa-icon icon="up-right-from-square" />
      </a>
      <a href="https://www.windy.com/" target="_blank" rel="noopener" class="safety-link">
        Windy.com (vents, précipitations)
        <fa-icon icon="up-right-from-square" />
      </a>
      <a href="https://www.meteoblue.com/fr/meteo/outdoorsports" target="_blank" rel="noopener" class="safety-link">
        Meteoblue Outdoor
        <fa-icon icon="up-right-from-square" />
      </a>
    </section>

    <!-- Generic safety checklist — discipline-aware. -->
    <section class="safety-card safety-card--checklist">
      <h3>
        <fa-icon icon="clipboard-check" />
        &nbsp;{{ $gettext('Checklist avant départ') }}
      </h3>
      <ul class="safety-checklist">
        <li v-for="item in checklist" :key="item">
          <fa-icon icon="square" :class="['far']" />
          &nbsp;{{ item }}
        </li>
      </ul>
    </section>
  </div>
</template>

<script>
// V4 — safety panel. We deliberately don't try to fetch the BERA / weather
// in real time here, because the user IS by definition offline on the
// field. We surface:
//   - Emergency phone numbers (always)
//   - Discipline-specific risk indicators read from the doc itself
//   - Curated external links (the user opens them at home before going)
//   - A pre-departure checklist
// The "Notes" view next door is where the user actually records the
// observed conditions (BERA level, snow, refuge info, etc.) so they
// stay on-device offline.

const CHECKLISTS = {
  climbing: [
    'Cotation et engagement vérifiés',
    'Matériel requis : corde, dégaines, baudrier, casque, friends/coinceurs',
    'Approche identifiée sur carte',
    'Météo annonce pas d\'orage en fin de journée',
    'Co-équipier·ière prévenu·e du retour estimé',
  ],
  skitouring: [
    'BERA consulté et noté (niveau, expositions à risque)',
    'Matériel sécu : DVA, pelle, sonde (testés)',
    'Itinéraire évalué selon orientation et altitude des pentes',
    'Conditions neige récentes vérifiées',
    'Personne extérieure prévenue du retour estimé',
  ],
  mountaineering: [
    'Conditions glacier / chutes pierres vérifiées au refuge',
    'Cordage adapté préparé',
    'Crampons, piolet, broches, dégaines',
    'Météo en altitude (vent, orage, gel)',
    'Heure de départ calée sur l\'horaire des chutes de pierres',
  ],
  hiking: [
    'Carte téléchargée hors-ligne',
    'Eau et nourriture suffisantes',
    'Vêtement chaud + coupe-vent même si beau temps',
    'Lampe frontale au cas où',
    'Retour estimé prévenu',
  ],
};

export default {
  name: 'TopoSafetyView',

  props: {
    document: { type: Object, required: true },
    discipline: { type: String, default: 'hiking' },
  },

  computed: {
    showAvalancheCard() {
      return this.discipline === 'skitouring' || (this.discipline === 'mountaineering' && this.document.glacier_rating);
    },
    showMountaineeringCard() {
      return this.discipline === 'mountaineering';
    },
    showClimbingCard() {
      return this.discipline === 'climbing';
    },
    checklist() {
      return CHECKLISTS[this.discipline] || CHECKLISTS.hiking;
    },
  },
};
</script>

<style lang="scss" scoped>
.topo-safety-view {
  padding: 0.75rem;
}

.safety-header {
  margin-bottom: 0.75rem;

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    color: #c0392b;
  }
  p {
    margin: 0.2rem 0 0;
    font-size: 0.78rem;
    color: #6b6b6b;
    line-height: 1.4;
  }
}

.safety-card {
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  padding: 0.7rem 0.8rem;
  margin-bottom: 0.6rem;

  h3 {
    margin: 0 0 0.4rem;
    font-size: 0.92rem;
    font-weight: 700;
    color: #4a4a4a;
  }

  p {
    margin: 0.2rem 0;
    font-size: 0.85rem;
    color: #4a4a4a;
    line-height: 1.4;
  }
}

.safety-card--emergency {
  background: #fff5f3;
  border-color: #f8a89c;
}

.safety-emergency-list {
  list-style: none;
  margin: 0.4rem 0;
  padding: 0;

  li {
    margin: 0.25rem 0;
  }

  a {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.55rem 0.6rem;
    background: white;
    border: 1px solid rgba(192, 57, 43, 0.25);
    border-radius: 6px;
    color: #4a4a4a;
    text-decoration: none;
    cursor: pointer;

    &:hover { background: #fff5f3; }

    strong {
      font-size: 1.4rem;
      color: #c0392b;
      letter-spacing: 0.05em;
      flex: 0 0 auto;
    }
    span {
      font-size: 0.82rem;
      color: #4a4a4a;
    }
  }
}

.safety-hint {
  font-size: 0.78rem !important;
  color: #6b6b6b !important;
  font-style: italic;
}

.safety-key {
  margin: 0.3rem 0 !important;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 1.2rem;
  font-size: 0.85rem;

  strong { color: #4a4a4a; }
}

.safety-bullets {
  list-style: none;
  margin: 0.3rem 0;
  padding: 0;
  font-size: 0.85rem;

  li {
    padding: 0.2rem 0;
    border-bottom: 1px dashed rgba(0, 0, 0, 0.06);
    &:last-child { border: 0; }
  }

  strong { color: #4a4a4a; }
}

.safety-link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.82rem;
  color: #337ab7;
  text-decoration: none;
  margin-right: 0.8rem;

  &:hover { text-decoration: underline; }
}

.safety-card--checklist h3 { color: #4a4a4a; }

.safety-checklist {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 0.85rem;

  li {
    padding: 0.3rem 0;
    color: #4a4a4a;
  }
}
</style>

<style lang="scss">
html[data-theme='dark'] {
  .topo-safety-view {
    .safety-header h2 { color: #ff6b5a; }
    .safety-header p { color: #b5b5b5; }
    .safety-card {
      background: #2a2a2a;
      border-color: rgba(255, 255, 255, 0.08);
      h3 { color: #f5f5f5; }
      p, .safety-checklist li, .safety-bullets li { color: #e5e5e5; }
    }
    .safety-card--emergency {
      background: #3a1f1c;
      border-color: rgba(255, 107, 90, 0.4);
    }
    .safety-emergency-list a {
      background: #2a1717;
      border-color: rgba(255, 107, 90, 0.4);
      color: #e5e5e5;
      span { color: #e5e5e5; }
      strong { color: #ff8b7a; }
      &:hover { background: #381f1d; }
    }
    .safety-hint { color: #9a9a9a !important; }
    .safety-link { color: #6db4ff; }
  }
}
</style>
