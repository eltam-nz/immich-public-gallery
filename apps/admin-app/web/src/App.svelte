<script lang="ts">
  import type { AdminCollection, AdminPhoto, AdminPlace, AdminStatus } from '@showcase/shared';
  import { api } from './lib/api';
  import CollectionsView from './lib/CollectionsView.svelte';
  import PhotosView from './lib/PhotosView.svelte';
  import { go, media, route, type Tab } from './lib/state.svelte';
  import StatusView from './lib/StatusView.svelte';
  import Toast from './lib/Toast.svelte';

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'photos', label: 'Photos', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
    { id: 'collections', label: 'Collections', icon: 'M3 7h7l2 2h9v10H3zM3 7V5h6l2 2' },
    { id: 'sync', label: 'Sync', icon: 'M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18 3v4h-4M6 21v-4h4' },
  ];

  let status = $state<AdminStatus | null>(null);
  let photos = $state<AdminPhoto[]>([]);
  let collections = $state<AdminCollection[]>([]);
  let places = $state<AdminPlace[]>([]);
  let loadError = $state<string | null>(null);

  const syncProblem = $derived(!!status?.lastSync && !status.lastSync.ok);
  const current = $derived(tabs.find((t) => t.id === route.tab)!);

  // Normalise the URL on first load (e.g. no hash yet).
  if (!location.hash) go(route.tab, route.photo, { replace: true });

  async function reload() {
    try {
      [status, photos, collections, places] = await Promise.all([
        api.status(),
        api.photos(),
        api.collections(),
        api.places(),
      ]);
      loadError = null;
    } catch (e) {
      loadError = (e as Error).message;
    }
  }
  reload();
</script>

{#snippet icon(path: string)}
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d={path} /></svg>
{/snippet}

<header class="top">
  <div class="title">
    <h1>Gallery admin</h1>
    {#if media.phone}<span class="section muted">· {current.label}</span>{/if}
  </div>
  {#if !media.phone}
    <nav aria-label="Sections" class="tabs">
      {#each tabs as t (t.id)}
        <button class:active={route.tab === t.id} aria-current={route.tab === t.id ? 'page' : undefined} onclick={() => go(t.id)}>
          {t.label}{#if t.id === 'sync' && syncProblem}<span class="dot" title="Last sync had errors"></span>{/if}
        </button>
      {/each}
    </nav>
  {/if}
  {#if status?.publicSiteUrl}
    <a class="site" href={status.publicSiteUrl} target="_blank" rel="noopener noreferrer">View site ↗</a>
  {/if}
  {#if status && !media.phone}<span class="who muted">{status.email}</span>{/if}
</header>

<main>
  {#if loadError}
    <p class="error banner">{loadError}</p>
  {/if}
  {#if !status && !loadError}
    <p class="muted">Loading…</p>
  {:else if route.tab === 'photos'}
    <PhotosView bind:photos {collections} galleryPlaces={places} onchange={reload} />
  {:else if route.tab === 'collections'}
    <CollectionsView {collections} onchange={reload} />
  {:else if status}
    <StatusView {status} onchange={reload} />
  {/if}
</main>

{#if media.phone}
  <nav class="tabbar" aria-label="Sections">
    {#each tabs as t (t.id)}
      <button class:active={route.tab === t.id} aria-current={route.tab === t.id ? 'page' : undefined} onclick={() => go(t.id)}>
        <span class="ico">{@render icon(t.icon)}{#if t.id === 'sync' && syncProblem}<span class="dot badge" title="Last sync had errors"></span>{/if}</span>
        <span>{t.label}</span>
      </button>
    {/each}
  </nav>
{/if}

<Toast />

<style>
  .top {
    display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
    padding: 10px 16px; padding-top: max(10px, env(safe-area-inset-top));
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 90%, transparent);
    -webkit-backdrop-filter: saturate(1.4) blur(12px); backdrop-filter: saturate(1.4) blur(12px);
    position: sticky; top: 0; z-index: 10;
  }
  .title { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  h1 { font-size: 18px; margin: 0; white-space: nowrap; }
  .section { font-size: 16px; }
  .tabs { display: flex; gap: 4px; }
  .tabs button {
    border: 0; background: transparent; padding: 6px 12px; border-radius: 8px; cursor: pointer; min-height: var(--tap);
  }
  .tabs { background: var(--surface-2); padding: 4px; border-radius: 999px; }
  .tabs button { border-radius: 999px; color: var(--muted); font-weight: 500; }
  .tabs button.active { background: var(--surface); color: var(--fg); box-shadow: var(--shadow); }
  .site { color: inherit; font-size: 14px; }
  .who { margin-left: auto; font-size: 13px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--danger); margin-left: 6px; vertical-align: middle; }
  main { padding: 16px; max-width: 1600px; margin: 0 auto; }
  .banner { padding: 12px; border: 1px solid var(--danger); border-radius: 8px; }

  @media (max-width: 700px) {
    .top { gap: 8px; flex-wrap: nowrap; padding: 8px 12px; padding-top: max(8px, env(safe-area-inset-top)); }
    .site { margin-left: auto; display: inline-flex; align-items: center; min-height: 44px; padding: 0 4px; }
    main {
      padding: 10px;
      /* room for the bottom tab bar and selection bar */
      padding-bottom: calc(var(--tabbar) + var(--selbar) + 24px + env(safe-area-inset-bottom));
    }
  }
  .tabbar {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
    display: grid; grid-template-columns: repeat(3, 1fr);
    height: calc(var(--tabbar) + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--surface); border-top: 1px solid var(--border);
  }
  .tabbar button {
    border: 0; background: none; cursor: pointer; color: var(--muted);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-size: 12px;
  }
  .tabbar button.active { color: var(--fg); font-weight: 600; }
  .ico { position: relative; display: inline-flex; padding: 3px 18px; border-radius: 999px; }
  .tabbar button.active .ico { background: var(--accent-soft); color: var(--accent-strong); }
  .badge { position: absolute; top: 0; right: 10px; margin: 0; }
</style>
