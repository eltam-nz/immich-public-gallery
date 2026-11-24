<script lang="ts">
  import type { AdminPlace, PlaceRef } from '@showcase/shared';
  import { onMount } from 'svelte';
  import { api } from './api';

  let {
    galleryPlaces,
    onpick,
    oncancel,
    framed = true,
  }: {
    galleryPlaces: AdminPlace[];
    onpick: (p: PlaceRef) => void;
    oncancel?: () => void;
    /** Draw its own box (inline use). Off inside a Sheet. */
    framed?: boolean;
  } = $props();

  let query = $state('');
  let results = $state<PlaceRef[]>([]);
  let searching = $state(false);
  let error = $state<string | null>(null);
  let input: HTMLInputElement;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Focus the search box. Deferred so it wins over a dialog's own initial focus.
  onMount(() => {
    const t = setTimeout(() => input?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  });

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

<div class="picker" class:framed>
  <input type="search" placeholder="Search towns and cities…" bind:value={query} bind:this={input} oninput={search}
    aria-label="Search places" autocomplete="off" />
  {#if shown.length}
    <p class="label">In your gallery</p>
    <ul>
      {#each shown as p (p.id)}
        <li><button type="button" onclick={() => onpick(p)}><span>{p.name}, {p.country}</span><span class="muted">{p.count}</span></button></li>
      {/each}
    </ul>
  {/if}
  {#if results.length}
    <p class="label">Other places</p>
    <ul>
      {#each results as p (p.id)}
        <li><button type="button" onclick={() => onpick(p)}><span>{p.name}, {p.country}</span></button></li>
      {/each}
    </ul>
  {:else if searching}
    <p class="muted">Searching…</p>
  {:else if query.trim().length >= 2 && !shown.length}
    <p class="muted">No places found.</p>
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
  {#if oncancel}<button type="button" class="btn cancel" onclick={oncancel}>Cancel</button>{/if}
</div>

<style>
  .picker { display: grid; gap: 6px; }
  .picker.framed { border: 1px solid var(--border); background: var(--surface); border-radius: 12px; padding: 10px; margin: 8px 0; }
  .label { margin: 8px 0 0; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
  ul { list-style: none; margin: 0; padding: 0; }
  .framed ul { max-height: 240px; overflow-y: auto; }
  li button {
    width: 100%; display: flex; justify-content: space-between; gap: 12px; text-align: left;
    border: 0; background: none; padding: 8px; border-radius: 6px; cursor: pointer; min-height: var(--tap);
    align-items: center;
  }
  li button:hover, li button:focus-visible { background: var(--border); }
  .cancel { justify-self: start; }
</style>
