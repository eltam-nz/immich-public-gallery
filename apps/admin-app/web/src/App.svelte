<script lang="ts">
  import type { AdminCollection, AdminPhoto, AdminStatus } from '@showcase/shared';
  import { api } from './lib/api';
  import CollectionsView from './lib/CollectionsView.svelte';
  import PhotosView from './lib/PhotosView.svelte';
  import StatusView from './lib/StatusView.svelte';

  type Tab = 'photos' | 'collections' | 'status';
  const tabs: { id: Tab; label: string }[] = [
    { id: 'photos', label: 'Photos' },
    { id: 'collections', label: 'Collections' },
    { id: 'status', label: 'Sync' },
  ];

  let tab = $state<Tab>((location.hash.slice(1) as Tab) || 'photos');
  let status = $state<AdminStatus | null>(null);
  let photos = $state<AdminPhoto[]>([]);
  let collections = $state<AdminCollection[]>([]);
  let loadError = $state<string | null>(null);

  $effect(() => {
    history.replaceState(null, '', `#${tab}`);
  });

  async function reload() {
    try {
      [status, photos, collections] = await Promise.all([api.status(), api.photos(), api.collections()]);
      loadError = null;
    } catch (e) {
      loadError = (e as Error).message;
    }
  }
  reload();
</script>

<header>
  <div class="title">
    <h1>Gallery admin</h1>
    {#if status?.publicSiteUrl}
      <a href={status.publicSiteUrl} target="_blank" rel="noopener noreferrer">View site ↗</a>
    {/if}
  </div>
  <nav aria-label="Sections">
    {#each tabs as t (t.id)}
      <button class:active={tab === t.id} aria-current={tab === t.id ? 'page' : undefined} onclick={() => (tab = t.id)}>
        {t.label}
        {#if t.id === 'status' && status?.lastSync && !status.lastSync.ok}<span class="dot" title="Last sync had errors"></span>{/if}
      </button>
    {/each}
  </nav>
  {#if status}<span class="who muted">{status.email}</span>{/if}
</header>

<main>
  {#if loadError}
    <p class="error banner">{loadError}</p>
  {/if}
  {#if !status && !loadError}
    <p class="muted">Loading…</p>
  {:else if tab === 'photos'}
    <PhotosView bind:photos {collections} defaultGps={status?.defaultGpsPrecision ?? -1} onchange={reload} />
  {:else if tab === 'collections'}
    <CollectionsView {collections} onchange={reload} />
  {:else if status}
    <StatusView {status} onchange={reload} />
  {/if}
</main>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 24px;
    flex-wrap: wrap;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .title { display: flex; align-items: baseline; gap: 12px; }
  h1 { font-size: 18px; margin: 0; }
  nav { display: flex; gap: 4px; }
  nav button {
    border: 0;
    background: transparent;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    position: relative;
  }
  nav button.active { background: var(--accent); color: var(--accent-fg); }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
    margin-left: 6px;
    vertical-align: middle;
  }
  .who { margin-left: auto; font-size: 13px; }
  main { padding: 16px; max-width: 1600px; margin: 0 auto; }
  .banner { padding: 12px; border: 1px solid var(--danger); border-radius: 6px; }
  a { color: inherit; }
</style>
