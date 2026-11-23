<script lang="ts">
  import type { AdminPlace, PlaceRef } from '@showcase/shared';
  import { api } from './api';

  let {
    galleryPlaces,
    onpick,
    oncancel,
  }: { galleryPlaces: AdminPlace[]; onpick: (p: PlaceRef) => void; oncancel: () => void } = $props();

  let query = $state('');
  let results = $state<PlaceRef[]>([]);
  let searching = $state(false);
  let error = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Places already in the gallery, filtered by the search text as you type.
  const shown = $derived(
    query.trim()
      ? galleryPlaces.filter((p) => `${p.name} ${p.country}`.toLowerCase().includes(query.trim().toLowerCase()))
      : galleryPlaces,
  );

  function search() {
    clearTimeout(timer);
    const q = query.trim();
    if (q.length < 2) {
      results = [];
      return;
    }
    timer = setTimeout(async () => {
      searching = true;
      error = null;
      try {
        const found = await api.searchPlaces(q);
        if (q === query.trim()) results = found.filter((p) => !galleryPlaces.some((g) => g.id === p.id));
      } catch (e) {
        error = (e as Error).message;
      } finally {
        searching = false;
      }
    }, 250);
  }
</script>

<div class="picker" role="dialog" aria-label="Choose a place">
  <input type="text" placeholder="Search towns and cities…" bind:value={query} oninput={search} aria-label="Search places" />
  {#if shown.length}
    <p class="label">In your gallery</p>
    <ul>
      {#each shown as p (p.id)}
        <li><button type="button" onclick={() => onpick(p)}>{p.name}, {p.country} <span class="muted">· {p.count}</span></button></li>
      {/each}
    </ul>
  {/if}
  {#if results.length}
    <p class="label">Other places</p>
    <ul>
      {#each results as p (p.id)}
        <li><button type="button" onclick={() => onpick(p)}>{p.name}, {p.country}</button></li>
      {/each}
    </ul>
  {:else if searching}
    <p class="muted">Searching…</p>
  {:else if query.trim().length >= 2 && !shown.length}
    <p class="muted">No places found.</p>
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
  <button type="button" class="btn" onclick={oncancel}>Cancel</button>
</div>

<style>
  .picker {
    border: 1px solid var(--border); background: var(--surface); border-radius: 8px;
    padding: 10px; display: grid; gap: 6px; margin: 8px 0;
  }
  .label { margin: 6px 0 0; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; }
  ul { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; }
  li button {
    width: 100%; text-align: left; border: 0; background: none; padding: 6px 8px; border-radius: 6px; cursor: pointer;
  }
  li button:hover, li button:focus-visible { background: var(--border); }
  .picker > .btn { justify-self: start; }
</style>
