<script lang="ts">
  import type { PublicCollection, PublicPhoto } from '@showcase/shared';
  import { api } from './lib/api';
  import Gallery from './lib/Gallery.svelte';
  import Lightbox from './lib/Lightbox.svelte';

  const params = new URLSearchParams(location.search);

  let title = $state('Photos');
  let collections = $state<PublicCollection[]>([]);
  let photos = $state<PublicPhoto[]>([]);
  let collection = $state<string | null>(params.get('c'));
  let openId = $state<string | null>(params.get('p'));
  let loading = $state(true);
  let error = $state<string | null>(null);

  const openIndex = $derived(openId ? photos.findIndex((p) => p.id === openId) : -1);

  api.site().then((s) => {
    title = s.title;
    document.title = s.title;
  }).catch(() => {});
  api.collections().then((c) => (collections = c)).catch(() => {});

  $effect(() => {
    const c = collection;
    loading = true;
    error = null;
    api
      .photos(c ?? undefined)
      .then((p) => (photos = p))
      .catch((e: Error) => (error = e.message))
      .finally(() => (loading = false));
  });

  // Keep the URL shareable: ?c=<collection>&p=<photo>
  $effect(() => {
    const q = new URLSearchParams();
    if (collection) q.set('c', collection);
    if (openId) q.set('p', openId);
    const qs = q.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  });

  function selectCollection(id: string | null) {
    collection = id;
    openId = null;
  }
</script>

<header>
  <h1>{title}</h1>
  {#if collections.length > 1}
    <nav aria-label="Collections">
      <button class:active={!collection} onclick={() => selectCollection(null)}>All</button>
      {#each collections as c (c.id)}
        <button
          class:active={collection === c.id || collection === c.slug}
          onclick={() => selectCollection(c.slug ?? c.id)}
        >
          {c.title} <span class="count">{c.count}</span>
        </button>
      {/each}
    </nav>
  {/if}
</header>

<main>
  {#if error}
    <p class="status">Couldn't load photos. {error}</p>
  {:else if loading && photos.length === 0}
    <p class="status">Loading…</p>
  {:else if photos.length === 0}
    <p class="status">No photos yet.</p>
  {:else}
    <Gallery {photos} onopen={(id) => (openId = id)} />
  {/if}
</main>

{#if openIndex >= 0}
  <Lightbox
    {photos}
    index={openIndex}
    onnavigate={(i) => (openId = photos[i]?.id ?? null)}
    onclose={() => (openId = null)}
  />
{/if}

<style>
  header {
    padding: 32px 16px 16px;
    max-width: 1600px;
    margin: 0 auto;
  }
  h1 {
    margin: 0 0 16px;
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  nav {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  nav button {
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 999px;
    padding: 6px 14px;
    cursor: pointer;
  }
  nav button.active {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }
  .count {
    opacity: 0.6;
    font-size: 0.85em;
    margin-left: 2px;
  }
  main {
    max-width: 1600px;
    margin: 0 auto;
    padding: 0 16px 48px;
  }
  .status {
    color: var(--muted);
    padding: 48px 0;
    text-align: center;
  }
</style>
