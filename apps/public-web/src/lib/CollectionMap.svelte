<script lang="ts">
  // Small, fixed map of where a collection's photos were taken. Loaded on demand.
  // Every interaction is turned off so it can't trap scrolling or get "lost";
  // the "Taken in" links below give the same information without the map.
  import type { PublicPlace } from '@showcase/shared';
  import { onMount } from 'svelte';
  import { addBaseLayer, fitTo, L, MARKER_STYLE, markerRadius } from './leaflet';
  import { href, link } from './router';

  let { places }: { places: PublicPlace[] } = $props();
  let el = $state<HTMLDivElement>();

  const label = $derived(`Map showing where these photos were taken: ${places.map((p) => p.name).join(', ')}`);

  onMount(() => {
    if (!places.length || !el) return;
    const map = L.map(el, {
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomControl: false,
      tapHold: false,
      zoomSnap: 0.25,
    });
    addBaseLayer(map);
    const showLabels = places.length <= 6;
    for (const p of places) {
      const m = L.circleMarker([p.lat, p.lon], {
        radius: markerRadius(p.count, 10),
        ...MARKER_STYLE,
        interactive: false,
      }).addTo(map);
      if (showLabels) {
        m.bindTooltip(p.name, { permanent: true, direction: 'right', offset: [12, 0], className: 'place-label' });
      }
    }
    fitTo(map, places.map((p) => [p.lat, p.lon]), 8);
    return () => map.remove();
  });
</script>

{#if places.length}
  <figure class="where">
    <div class="map" bind:this={el} role="group" aria-label={label}></div>
    <figcaption>
      <span class="lead">Taken in:</span>
      <ul>
        {#each places as p (p.id)}
          <li><a href={href({ view: 'place', id: p.id })} use:link>{p.name}</a> <span class="n">({p.count})</span></li>
        {/each}
      </ul>
    </figcaption>
  </figure>
{/if}

<style>
  .where { margin: 0 0 1.5rem; }
  .map {
    height: 14rem;
    border-radius: var(--radius); overflow: hidden;
    border: 0.125rem solid var(--border);
    background: var(--surface);
    /* Not interactive: let touches scroll the page instead. */
    touch-action: pan-y;
    cursor: default;
  }
  figcaption { margin-top: 0.5rem; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 0.75rem; }
  .lead { color: var(--muted); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0 1.25rem; }
  figcaption a {
    display: inline-block; min-height: 2.75rem; padding: 0.4rem 0;
    font-weight: 700; font-size: 1.05rem;
  }
  .n { color: var(--muted); }
  .map :global(.place-label) {
    background: #ffffff; color: #111111; border: 0.0625rem solid #555; border-radius: 0.3rem;
    font: 600 0.85rem/1.2 system-ui, sans-serif; padding: 0.15rem 0.4rem; box-shadow: none;
  }
  .map :global(.place-label::before) { display: none; }
  .map :global(.leaflet-control-attribution) { font-size: 0.7rem; }
</style>
