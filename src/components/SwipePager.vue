<template>
  <div class="swipe-pager" :class="{ 'is-dragging': dragging }">
    <!-- Top: page dots + optional mini-tab labels -->
    <div v-if="showHeader" class="swipe-pager-header">
      <div class="swipe-pager-dots" role="tablist">
        <button
          v-for="(page, i) in pages"
          :key="i"
          type="button"
          class="swipe-pager-dot"
          :class="{ 'is-active': i === activeIndex }"
          :aria-label="page.label || ('Page ' + (i + 1))"
          :aria-selected="i === activeIndex"
          role="tab"
          @click="goTo(i)"
        />
      </div>
    </div>

    <!-- Pages container — translated by drag/active index -->
    <div
      class="swipe-pager-track"
      :style="trackStyle"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div
        v-for="(page, i) in pages"
        :key="page.key || i"
        class="swipe-pager-page"
        :class="{ 'is-active': i === activeIndex }"
        :aria-hidden="i !== activeIndex"
      >
        <slot :name="page.key || ('page-' + i)" :active="i === activeIndex" :index="i" />
      </div>
    </div>

    <!-- Bottom: clickable tabs with icons + short labels -->
    <nav v-if="showTabs" class="swipe-pager-tabs" role="tablist">
      <button
        v-for="(page, i) in pages"
        :key="i"
        type="button"
        class="swipe-pager-tab"
        :class="{ 'is-active': i === activeIndex }"
        :aria-label="page.label"
        :aria-selected="i === activeIndex"
        role="tab"
        @click="goTo(i)"
      >
        <fa-icon v-if="page.icon" :icon="page.icon" />
        <span class="swipe-pager-tab-label">{{ page.label }}</span>
      </button>
    </nav>
  </div>
</template>

<script>
// Horizontal swipable pager — the backbone of the V4 OfflineTopoExperience.
// Plain touch events, no library. Each page is rendered via a named slot
// (`#carte`, `#topo`, etc.) so the parent stays in control of what's
// inside. The active page is the only one that gets `:active="true"` —
// children should mount lazy work conditionally to avoid running 5 maps
// in parallel.
//
// Drag math: translateX of `-activeIndex * 100% + dragOffset`. We snap
// to the next/prev page on release if the user dragged past 25% of the
// container width OR flicked fast enough (velocity > 0.25 px/ms).

const SNAP_RATIO = 0.25;
const FLICK_VELOCITY = 0.25;

export default {
  name: 'SwipePager',

  props: {
    pages: {
      // [{ key, label, icon }]
      type: Array,
      required: true,
    },
    value: {
      // active index (v-model: index)
      type: Number,
      default: 0,
    },
    showHeader: {
      type: Boolean,
      default: true,
    },
    showTabs: {
      type: Boolean,
      default: true,
    },
  },

  data() {
    return {
      activeIndex: this.value,
      dragOffset: 0,
      dragging: false,
      startX: 0,
      startY: 0,
      startTime: 0,
      lastX: 0,
      lastTime: 0,
      // Lock direction once we know it: vertical scroll vs horizontal swipe.
      // Without this the user fights the page when scrolling vertically
      // inside a swipable view.
      lockedAxis: null,
    };
  },

  computed: {
    trackStyle() {
      const dx = this.dragOffset;
      return {
        transform: `translateX(calc(${-this.activeIndex * 100}% + ${dx}px))`,
        transition: this.dragging ? 'none' : 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
        width: `${this.pages.length * 100}%`,
      };
    },
  },

  watch: {
    value(v) {
      if (v !== this.activeIndex) this.activeIndex = v;
    },
    activeIndex(v) {
      this.$emit('input', v);
      this.$emit('change', v);
    },
  },

  methods: {
    goTo(i) {
      const next = Math.max(0, Math.min(this.pages.length - 1, i));
      this.activeIndex = next;
    },

    next() {
      this.goTo(this.activeIndex + 1);
    },

    prev() {
      this.goTo(this.activeIndex - 1);
    },

    onTouchStart(e) {
      if (e.touches.length !== 1) return;
      this.dragging = true;
      this.dragOffset = 0;
      this.startX = e.touches[0].clientX;
      this.startY = e.touches[0].clientY;
      this.startTime = performance.now();
      this.lastX = this.startX;
      this.lastTime = this.startTime;
      this.lockedAxis = null;
    },

    onTouchMove(e) {
      if (!this.dragging || e.touches.length !== 1) return;
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const dx = x - this.startX;
      const dy = y - this.startY;

      // Decide axis on first significant move. ~8px deadzone lets a
      // genuine tap pass through without flicker.
      if (!this.lockedAxis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        this.lockedAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }

      if (this.lockedAxis === 'y') {
        // User is scrolling vertically inside a page — give up the swipe.
        this.dragging = false;
        this.dragOffset = 0;
        return;
      }

      // Block native scroll horizontally so the page actually follows
      // the finger.
      e.preventDefault();

      // Rubber-band at the edges — drag is dampened to ~30% if past edge.
      let next = dx;
      const atStart = this.activeIndex === 0 && dx > 0;
      const atEnd = this.activeIndex === this.pages.length - 1 && dx < 0;
      if (atStart || atEnd) next = dx * 0.3;

      this.dragOffset = next;
      this.lastX = x;
      this.lastTime = performance.now();
    },

    onTouchEnd() {
      if (!this.dragging) return;
      const containerWidth = this.$el?.offsetWidth || 320;
      const dx = this.dragOffset;
      const dt = Math.max(1, performance.now() - this.lastTime + 1);
      // Velocity over the last segment of the gesture.
      const velocity = Math.abs(dx) / Math.max(1, performance.now() - this.startTime);

      this.dragging = false;
      this.dragOffset = 0;

      if (Math.abs(dx) > containerWidth * SNAP_RATIO || velocity > FLICK_VELOCITY) {
        if (dx < 0) this.next();
        else this.prev();
      }
      // else: snap back to current (transition kicks in automatically
      // since `dragging` is now false).
      void dt;
    },
  },
};
</script>

<style lang="scss" scoped>
.swipe-pager {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.swipe-pager-header {
  flex: 0 0 auto;
  padding: 0.4rem 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.swipe-pager-dots {
  display: inline-flex;
  gap: 0.3rem;
  align-items: center;
}

.swipe-pager-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #d1d5db;
  border: none;
  padding: 0;
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;

  &.is-active {
    background: #ff9933;
    transform: scale(1.35);
  }
}

.swipe-pager-track {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: row;
  will-change: transform;
}

.swipe-pager-page {
  flex: 0 0 calc(100% / var(--page-count, 1));
  width: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

// Children compute their own size — the page itself is just a flex slot.
.swipe-pager-page {
  flex-basis: 0;
  flex-grow: 1;
  flex-shrink: 0;
  min-width: 100%;
}

.swipe-pager-tabs {
  flex: 0 0 auto;
  display: flex;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  background: white;
}

.swipe-pager-tab {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0.45rem 0.2rem calc(0.45rem + env(safe-area-inset-bottom));
  border: none;
  background: transparent;
  color: #9a9a9a;
  font-size: 0.7rem;
  font-weight: 500;
  cursor: pointer;

  &:hover, &:focus { color: #4a4a4a; outline: none; }
  &.is-active { color: #ff9933; }

  .fa-icon, svg { font-size: 1.05rem; }
}

.swipe-pager-tab-label { line-height: 1; }
</style>

<style lang="scss">
html[data-theme='dark'] {
  .swipe-pager-tabs {
    background: #232323;
    border-top-color: rgba(255, 255, 255, 0.08);
  }
  .swipe-pager-tab {
    color: #8a8a8a;
    &:hover, &:focus { color: #ccc; }
    &.is-active { color: #ff9933; }
  }
  .swipe-pager-dot { background: #4a4a4a; &.is-active { background: #ff9933; } }
}
</style>
