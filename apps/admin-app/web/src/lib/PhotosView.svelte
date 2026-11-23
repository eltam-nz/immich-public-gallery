<script lang="ts">
  import type { AdminCollection, AdminPhoto, AdminPlace, PlaceRef } from '@showcase/shared';
  import { api } from './api';
  import PhotoEditor from './PhotoEditor.svelte';
  import PlacePicker from './PlacePicker.svelte';

  let {
    photos = $bindable(),
    collections,
    galleryPlaces,
    onchange,
  }: { photos: AdminPhoto[]; collections: AdminCollection[]; galleryPlaces: AdminPlace[]; onchange: () => Promise<void> } =
    $props();

  // Filter: 'all' | 'hidden' | 'featured' | 'none' (in no collection) | 'noplace' | a collection id
  let filter = $state('all');
  let query = $state('');
  let selected = $state<Set<string>>(new Set());
  let editingId = $state<string | null>(null);
  let busy = $state(false);
  let message = $state<{ text: string; error?: boolean } | null>(null);
  let bulkCollection = $state('');
  let pickingPlace = $state(false);
  const FIXED_FILTERS = ['all', 'hidden', 'featured', 'none', 'noplace'];

  const visiblePhotos = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return photos.filter((p) => {
      if (filter === 'hidden' && p.visible) return false;
      if (filter === 'featured' && !p.featured) return false;
      if (filter === 'none' && p.collections.length) return false;
      if (filter === 'noplace' && p.effectivePlace) return false;
      if (!FIXED_FILTERS.includes(filter) && !p.collections.includes(filter)) return false;
      if (!q) return true;
      return [p.caption, p.description, p.effectivePlace?.name, p.camera, p.lens, ...p.tags]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q));
    });
  });

  const editing = $derived(editingId ? photos.find((p) => p.id === editingId) ?? null : null);
  const allShownSelected = $derived(visiblePhotos.length > 0 && visiblePhotos.every((p) => selected.has(p.id)));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function toggleAll() {
    selected = allShownSelected ? new Set() : new Set(visiblePhotos.map((p) => p.id));
  }

  async function bulk(body: Omit<Parameters<typeof api.bulk>[0], 'ids'>, done: string) {
    busy = true;
    message = null;
    try {
      const { updated } = await api.bulk({ ids: [...selected], ...body });
      await onchange();
      message = { text: `${done} (${updated} photo${updated === 1 ? '' : 's'}).` };
      selected = new Set();
    } catch (e) {
      message = { text: (e as Error).message, error: true };
    } finally {
      busy = false;
    }
  }

  function saved(p: AdminPhoto) {
    photos = photos.map((x) => (x.id === p.id ? p : x));
  }

  const collectionTitle = (id: string) => collections.find((c) => c.id === id)?.title ?? '';
</script>

<div class="layout" class:with-editor={editing}>
  <section>
    <div class="toolbar">
      <select bind:value={filter} aria-label="Filter photos">
        <option value="all">All photos ({photos.length})</option>
        <option value="hidden">Hidden ({photos.filter((p) => !p.visible).length})</option>
        <option value="featured">Featured ({photos.filter((p) => p.featured).length})</option>
        <option value="none">Not in a collection ({photos.filter((p) => !p.collections.length).length})</option>
        <option value="noplace">No location ({photos.filter((p) => !p.effectivePlace).length})</option>
        {#if collections.length}
          <optgroup label="Collections">
            {#each collections as c (c.id)}<option value={c.id}>{c.title} ({c.count})</option>{/each}
          </optgroup>
        {/if}
      </select>
      <input type="text" placeholder="Search caption, tags, place, camera…" bind:value={query} aria-label="Search" />
      <label class="check"><input type="checkbox" checked={allShownSelected} onchange={toggleAll} /> Select shown</label>
    </div>

    {#if selected.size}
      <div class="bulk" role="region" aria-label="Bulk actions">
        <strong>{selected.size} selected</strong>
        <button class="btn" disabled={busy} onclick={() => bulk({ set: { visible: true } }, 'Shown')}>Show</button>
        <button class="btn" disabled={busy} onclick={() => bulk({ set: { visible: false } }, 'Hidden')}>Hide</button>
        <button class="btn" disabled={busy} onclick={() => bulk({ set: { featured: true } }, 'Featured')}>Feature</button>
        <button class="btn" disabled={busy} onclick={() => bulk({ set: { featured: false } }, 'Unfeatured')}>Unfeature</button>
        {#if collections.length}
          <select bind:value={bulkCollection} aria-label="Collection for bulk action">
            <option value="">Collection…</option>
            {#each collections as c (c.id)}<option value={c.id}>{c.title}</option>{/each}
          </select>
          <button class="btn" disabled={busy || !bulkCollection}
            onclick={() => bulk({ addTo: bulkCollection }, `Added to ${collectionTitle(bulkCollection)}`)}>Add</button>
          <button class="btn" disabled={busy || !bulkCollection}
            onclick={() => bulk({ removeFrom: bulkCollection }, `Removed from ${collectionTitle(bulkCollection)}`)}>Remove</button>
        {/if}
        <button class="btn" disabled={busy} onclick={() => (pickingPlace = !pickingPlace)}>Set location…</button>
        <button class="btn" disabled={busy} onclick={() => bulk({ location: { mode: 'auto' } }, 'Location from GPS')}>Use GPS</button>
        <button class="btn" disabled={busy} onclick={() => bulk({ location: { mode: 'hidden' } }, 'Location hidden')}>Hide location</button>
        <button class="btn" onclick={() => (selected = new Set())}>Clear</button>
      </div>
      {#if pickingPlace}
        <PlacePicker {galleryPlaces} oncancel={() => (pickingPlace = false)}
          onpick={(pl: PlaceRef) => { pickingPlace = false; bulk({ location: { mode: 'place', placeId: pl.id } }, `Location set to ${pl.name}`); }} />
      {/if}
    {/if}
    {#if message}<p class:error={message.error} class="msg" role="status">{message.text}</p>{/if}

    {#if !photos.length}
      <p class="muted">No photos synced yet. Check the Sync tab.</p>
    {:else if !visiblePhotos.length}
      <p class="muted">No photos match.</p>
    {/if}

    <ul class="grid">
      {#each visiblePhotos as p (p.id)}
        <li class:hidden={!p.visible} class:selected={selected.has(p.id)} class:current={p.id === editingId}>
          <input type="checkbox" class="pick" checked={selected.has(p.id)} onchange={() => toggle(p.id)}
            aria-label="Select photo" />
          <button class="thumb" onclick={() => (editingId = p.id)} aria-label="Edit photo">
            <img src={p.src.thumb} alt={p.caption ?? ''} loading="lazy" decoding="async" />
          </button>
          <div class="badges">
            {#if !p.visible}<span class="badge">Hidden</span>{/if}
            {#if p.featured}<span class="badge" title="Featured">★</span>{/if}
            {#if p.collections.length}<span class="badge" title={p.collections.map(collectionTitle).join(', ')}>{p.collections.length} coll.</span>{/if}
          </div>
          {#if p.caption}<p class="cap">{p.caption}</p>{/if}
        </li>
      {/each}
    </ul>
  </section>

  {#if editing}
    {#key editing.id}
      <PhotoEditor photo={editing} {collections} {galleryPlaces} selectedIds={[...selected]} onsaved={saved} onrefresh={onchange}
        onclose={() => (editingId = null)} />
    {/key}
  {/if}
</div>

<style>
  .layout { display: grid; grid-template-columns: 1fr; gap: 16px; }
  .layout.with-editor { grid-template-columns: 1fr 380px; }
  @media (max-width: 900px) { .layout.with-editor { grid-template-columns: 1fr; } }
  .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
  .toolbar select { width: auto; }
  .toolbar input[type='text'] { flex: 1; min-width: 200px; }
  .bulk {
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    padding: 8px 12px; border: 1px solid var(--border); background: var(--surface);
    border-radius: 8px; margin-bottom: 12px; position: sticky; top: 64px; z-index: 5;
  }
  .bulk select { width: auto; }
  .msg { margin: 0 0 12px; }
  .grid {
    list-style: none; padding: 0; margin: 0;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px;
  }
  li { position: relative; }
  .thumb {
    display: block; width: 100%; aspect-ratio: 1; padding: 0; border: 2px solid transparent;
    border-radius: 6px; overflow: hidden; background: var(--border); cursor: pointer;
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  li.hidden .thumb img { opacity: 0.35; }
  li.selected .thumb { border-color: var(--focus); }
  li.current .thumb { border-color: var(--accent); }
  .pick { position: absolute; top: 8px; left: 8px; z-index: 2; width: 18px; height: 18px; }
  .badges { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; }
  .badge { background: rgba(0, 0, 0, 0.65); color: #fff; font-size: 11px; padding: 1px 6px; border-radius: 999px; }
  .cap { margin: 4px 0 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
