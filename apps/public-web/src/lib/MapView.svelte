<script lang="ts">
  // Loaded on demand (dynamic import) so Leaflet is only downloaded for the map.
  import type { PublicPlace } from '@showcase/shared';
  import { addBaseLayer, fitTo, L, MARKER_STYLE, markerRadius as radius } from './leaflet';
  import { onMount } from 'svelte';
  import { plural } from './api';
  import { href, link, navigate } from './router';

  let { places }: { places: PublicPlace[] } = $props();
  let el = $state<HTMLDivElement>();

  function popupContent(p: PublicPlace): HTMLElement {
    // Built with DOM APIs (not HTML strings), so names can't inject markup.
    const box = document.createElement('div');
    box.className = 'pop';
    if (p.cover) {
      const img = document.createElement('img');
      img.src = p.cover;
      img.alt = '';
      box.append(img);
    }
    const name = document.createElement('strong');
    name.textContent = p.name;
    const meta = document.createElement('span');
    meta.textContent = `${p.country} · ${plural(p.count, 'photo')}`;
    const a = document.createElement('a');
    a.className = 'btn primary';
    a.href = href({ view: 'place', id: p.id });
    a.textContent = `View ${plural(p.count, 'photo')}`;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(a.getAttribute('href')!);
    });
    box.append(name, meta, a);
    return box;
  }

  onMount(() => {
    if (!places.length || !el) return;
    const map = L.map(el, {
      scrollWheelZoom: false, // don't trap page scrolling
      zoomSnap: 0.5,
      worldCopyJump: true,
    });
    addBaseLayer(map);

    for (const p of places) {
      L.circleMarker([p.lat, p.lon], {
        radius: radius(p.count),
        ...MARKER_STYLE,
        bubblingMouseEvents: false,
      })
        .bindPopup(popupContent(p), { maxWidth: 260, minWidth: 200, closeButton: true })
        .bindTooltip(`${p.name} (${p.count})`, { direction: 'top', offset: [0, -radius(p.count)] })
        .addTo(map);
    }
    fitTo(map, places.map((p) => [p.lat, p.lon]));
    return () => map.remove();
  });
</script>

{#if places.length}
  <div class="map" bind:this={el} role="region" aria-label="Map of places with photos"></div>
{/if}

<section aria-labelledby="places-list">
  <h2 id="places-list">{places.length ? 'All places' : 'No places yet'}</h2>
  {#if !places.length}
    <p>None of the photos have a place yet.</p>
  {/if}
  <ul class="list">
    {#each places as p (p.id)}
      <li>
        <a href={href({ view: 'place', id: p.id })} use:link>
          <span class="thumb">{#if p.cover}<img src={p.cover} alt="" loading="lazy" decoding="async" />{/if}</span>
          <span class="text">
            <span class="name">{p.name}</span>
            <span class="meta">{p.country} · {plural(p.count, 'photo')}</span>
          </span>
          <span class="go" aria-hidden="true">›</span>
        </a>
      </li>
    {/each}
  </ul>
</section>

<style>
  .map {
    height: 60vh; min-height: 18rem;
    border-radius: var(--radius); overflow: hidden;
    box-shadow: var(--shadow-lg);
    margin-bottom: 2rem;
    background: var(--surface-2);
  }
  h2 { font-size: 1.35rem; margin-bottom: 0.75rem; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; max-width: 45rem; }
  .list a {
    display: flex; align-items: center; gap: 1rem; min-height: 5rem; padding: 0.55rem;
    background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow);
    border: 0.125rem solid transparent;
    color: var(--fg); text-decoration: none;
  }
  .list a:hover { border-color: var(--border); }
  .thumb { flex: none; width: 4.5rem; height: 4.5rem; border-radius: var(--radius-sm); overflow: hidden; background: var(--surface-2); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .text { display: grid; flex: 1; min-width: 0; }
  .name { font-weight: 700; font-size: 1.15rem; }
  .meta { color: var(--muted); }
  .go { font-size: 2rem; padding: 0 0.5rem; }

  /* Leaflet controls and popups, made bigger and easier to tap. */
  .map :global(.leaflet-control-zoom a) {
    width: 3rem; height: 3rem; line-height: 3rem; font-size: 1.6rem;
  }
  .map :global(.leaflet-popup-content) { margin: 0.75rem; font: inherit; font-size: 1rem; }
  .map :global(.leaflet-popup-close-button) { width: 2.75rem !important; height: 2.75rem !important; font-size: 1.75rem !important; }
  .map :global(.pop) { display: grid; gap: 0.25rem; }
  .map :global(.pop img) { width: 100%; height: 8rem; object-fit: cover; border-radius: 0.4rem; }
  .map :global(.pop strong) { font-size: 1.15rem; }
  .map :global(.pop .btn) { margin-top: 0.5rem; color: var(--accent-fg); }
  .map :global(.leaflet-tooltip) { font-size: 0.95rem; }
</style>
