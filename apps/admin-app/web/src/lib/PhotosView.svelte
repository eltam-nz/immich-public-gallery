<script lang="ts">
  import type { AdminCollection, AdminPhoto, AdminPlace, PlaceRef } from '@showcase/shared';
  import { untrack } from 'svelte';
  import { api, type LocationChoice } from './api';
  import PhotoEditor from './PhotoEditor.svelte';
  import PlacePicker from './PlacePicker.svelte';
  import Sheet from './Sheet.svelte';
  import { closePhoto, media, notify, openPhoto, route } from './state.svelte';

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
  let selecting = $state(false); // phone "Select" mode: taps tick photos instead of opening them
  let lastIndex = -1;
  let busy = $state(false);
  let sheet = $state<null | 'actions' | 'place'>(null);
  let bulkCollection = $state('');
  let pickingPlace = $state(false); // desktop inline picker
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

  const editing = $derived(route.photo ? photos.find((p) => p.id === route.photo) ?? null : null);

  // While the editor is open, ‹ › and "Save & next" walk a snapshot of the list
  // taken when it opened. Otherwise a photo that drops out of the filter after
  // an edit (e.g. "No location" once a place is set) would strand the editor.
  let navIds = $state<string[]>([]);
  $effect(() => {
    const id = route.photo;
    untrack(() => {
      if (!id) navIds = [];
      else if (!navIds.includes(id)) navIds = visiblePhotos.map((p) => p.id);
    });
  });
  const navList = $derived(navIds.filter((id) => photos.some((p) => p.id === id)));
  const editIndex = $derived(editing ? navList.indexOf(editing.id) : -1);
  const allShownSelected = $derived(visiblePhotos.length > 0 && visiblePhotos.every((p) => selected.has(p.id)));
  const showSelBar = $derived(media.phone && (selecting || selected.size > 0));
  const collectionTitle = (id: string) => collections.find((c) => c.id === id)?.title ?? '';

  // Reserve space for the phone selection bar; lock page scrolling under the phone editor.
  $effect(() => {
    document.documentElement.style.setProperty('--selbar', showSelBar ? '60px' : '0px');
    return () => document.documentElement.style.setProperty('--selbar', '0px');
  });
  $effect(() => {
    const lock = media.phone && !!editing;
    document.body.style.overflow = lock ? 'hidden' : '';
    return () => (document.body.style.overflow = '');
  });

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function selectAllShown() {
    selected = allShownSelected ? new Set() : new Set(visiblePhotos.map((p) => p.id));
  }

  function clearSelection() {
    selected = new Set();
    selecting = false;
    sheet = null;
  }

  // Tap/click a tile: open it, or (in Select mode / with Ctrl or Shift) select.
  function tileClick(e: MouseEvent, p: AdminPhoto, i: number) {
    if (e.shiftKey && lastIndex >= 0) {
      const [a, b] = [Math.min(lastIndex, i), Math.max(lastIndex, i)];
      selected = new Set([...selected, ...visiblePhotos.slice(a, b + 1).map((x) => x.id)]);
    } else if (selecting || e.ctrlKey || e.metaKey) {
      toggle(p.id);
    } else {
      openPhoto(p.id);
    }
    lastIndex = i;
  }

  async function bulk(
    body: { set?: { visible?: boolean; featured?: boolean }; location?: LocationChoice; addTo?: string; removeFrom?: string },
    done: string,
  ) {
    busy = true;
    try {
      const { updated } = await api.bulk({ ids: [...selected], ...body });
      await onchange();
      notify(`${done} (${updated} photo${updated === 1 ? '' : 's'}).`);
      clearSelection();
      pickingPlace = false;
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      busy = false;
    }
  }

  const setPlace = (pl: PlaceRef) => bulk({ location: { mode: 'place', placeId: pl.id } }, `Location set to ${pl.name}`);

  function saved(p: AdminPhoto) {
    photos = photos.map((x) => (x.id === p.id ? p : x));
  }

  function step(delta: number) {
    const id = navList[editIndex + delta];
    if (id) openPhoto(id);
  }
</script>

{#snippet bulkActions(stacked: boolean)}
  <div class="group" class:stacked>
    {#if stacked}<h3>Visibility</h3>{/if}
    <div class="buttons">
      <button class="btn" disabled={busy} onclick={() => bulk({ set: { visible: true } }, 'Shown')}>Show</button>
      <button class="btn" disabled={busy} onclick={() => bulk({ set: { visible: false } }, 'Hidden')}>Hide</button>
      <button class="btn" disabled={busy} onclick={() => bulk({ set: { featured: true } }, 'Featured')}>Feature</button>
      <button class="btn" disabled={busy} onclick={() => bulk({ set: { featured: false } }, 'Unfeatured')}>Unfeature</button>
    </div>
  </div>
  {#if collections.length}
    <div class="group" class:stacked>
      {#if stacked}<h3>Collection</h3>{/if}
      <div class="buttons">
        <select bind:value={bulkCollection} aria-label="Collection for bulk action">
          <option value="">Collection…</option>
          {#each collections as c (c.id)}<option value={c.id}>{c.title}</option>{/each}
        </select>
        <button class="btn" disabled={busy || !bulkCollection}
          onclick={() => bulk({ addTo: bulkCollection }, `Added to ${collectionTitle(bulkCollection)}`)}>Add</button>
        <button class="btn" disabled={busy || !bulkCollection}
          onclick={() => bulk({ removeFrom: bulkCollection }, `Removed from ${collectionTitle(bulkCollection)}`)}>Remove</button>
      </div>
    </div>
  {/if}
  <div class="group" class:stacked>
    {#if stacked}<h3>Location</h3>{/if}
    <div class="buttons">
      <button class="btn" disabled={busy} onclick={() => (stacked ? (sheet = 'place') : (pickingPlace = !pickingPlace))}>Set location…</button>
      <button class="btn" disabled={busy} onclick={() => bulk({ location: { mode: 'auto' } }, 'Location from GPS')}>Use GPS</button>
      <button class="btn" disabled={busy} onclick={() => bulk({ location: { mode: 'hidden' } }, 'Location hidden')}>Hide location</button>
    </div>
  </div>
{/snippet}

<div class="layout" class:with-editor={editing && !media.phone}>
  <section>
    <div class="toolbar">
      <input type="search" class="search" placeholder="Search caption, tags, place, camera…" bind:value={query} aria-label="Search" />
      <select class="filter" bind:value={filter} aria-label="Filter photos">
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
      {#if media.phone}
        <button class="btn" class:primary={selecting} onclick={() => (selecting ? clearSelection() : (selecting = true))}>
          {selecting ? 'Cancel' : 'Select'}
        </button>
      {:else}
        <label class="check"><input type="checkbox" checked={allShownSelected} onchange={selectAllShown} /> Select shown</label>
      {/if}
    </div>

    {#if !media.phone && selected.size}
      <div class="bulk" role="region" aria-label="Bulk actions">
        <strong>{selected.size} selected</strong>
        {@render bulkActions(false)}
        <button class="btn" onclick={clearSelection}>Clear</button>
      </div>
      {#if pickingPlace}
        <PlacePicker {galleryPlaces} oncancel={() => (pickingPlace = false)} onpick={setPlace} />
      {/if}
    {/if}

    {#if !photos.length}
      <p class="muted">No photos synced yet. Check the Sync tab.</p>
    {:else if !visiblePhotos.length}
      <p class="muted">No photos match.</p>
    {:else}
      <p class="count muted">{visiblePhotos.length} shown{media.phone ? '' : ' · Ctrl/⌘-click to select, Shift-click for a range'}</p>
    {/if}

    <ul class="grid" class:selecting>
      {#each visiblePhotos as p, i (p.id)}
        <li class:hidden={!p.visible} class:selected={selected.has(p.id)} class:current={p.id === editing?.id}>
          {#if !media.phone}
            <input type="checkbox" class="pick" checked={selected.has(p.id)} onchange={() => { toggle(p.id); lastIndex = i; }}
              aria-label={`Select photo ${i + 1}`} />
          {/if}
          <button class="thumb" onclick={(e) => tileClick(e, p, i)}
            aria-label={`${selecting ? (selected.has(p.id) ? 'Deselect' : 'Select') : 'Edit'} photo ${i + 1}${p.caption ? `: ${p.caption}` : ''}`}
            aria-pressed={selecting ? selected.has(p.id) : undefined}>
            <img src={p.src.thumb} alt="" loading="lazy" decoding="async" />
            {#if selected.has(p.id)}<span class="tick" aria-hidden="true">✓</span>{/if}
          </button>
          <div class="badges" aria-hidden="true">
            {#if !p.visible}<span class="badge">Hidden</span>{/if}
            {#if p.featured}<span class="badge">★</span>{/if}
            {#if !p.effectivePlace}<span class="badge" title="No location">⌀</span>{/if}
          </div>
          {#if p.caption && !media.phone}<p class="cap">{p.caption}</p>{/if}
        </li>
      {/each}
    </ul>
  </section>

  {#if editing}
    {#key editing.id}
      <PhotoEditor photo={editing} {collections} {galleryPlaces}
        selectedIds={[...selected]}
        position={editIndex >= 0 ? `${editIndex + 1} of ${navList.length}` : ''}
        hasPrev={editIndex > 0} hasNext={editIndex >= 0 && editIndex < navList.length - 1}
        onprev={() => step(-1)} onnext={() => step(1)}
        onsaved={saved} onrefresh={onchange} onclose={closePhoto} />
    {/key}
  {/if}
</div>

{#if showSelBar && !editing}
  <div class="selbar" role="region" aria-label="Selection">
    <strong>{selected.size} selected</strong>
    <button class="btn" onclick={selectAllShown}>{allShownSelected ? 'None' : 'All'}</button>
    <button class="btn primary" disabled={!selected.size} onclick={() => (sheet = 'actions')}>Actions</button>
    <button class="btn" onclick={clearSelection}>Done</button>
  </div>
{/if}

{#if sheet === 'actions'}
  <Sheet title={`${selected.size} photo${selected.size === 1 ? '' : 's'} selected`} onclose={() => (sheet = null)}>
    {@render bulkActions(true)}
    <button class="btn wide" onclick={clearSelection}>Clear selection</button>
  </Sheet>
{:else if sheet === 'place'}
  <Sheet title="Set location" onclose={() => (sheet = 'actions')}>
    <PlacePicker {galleryPlaces} framed={false} onpick={setPlace} />
  </Sheet>
{/if}

<style>
  .layout { display: grid; grid-template-columns: 1fr; gap: 16px; }
  .layout.with-editor { grid-template-columns: 1fr 400px; }
  .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
  .search { flex: 1 1 240px; }
  .filter { width: auto; max-width: 100%; }
  .bulk {
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    padding: 8px 12px; border: 1px solid var(--border); background: var(--surface);
    border-radius: 8px; margin-bottom: 10px; position: sticky; top: 60px; z-index: 5;
  }
  .group { display: contents; }
  .group .buttons { display: contents; }
  .group select { width: auto; }
  .count { margin: 0 0 8px; font-size: 13px; }

  .grid {
    list-style: none; padding: 0; margin: 0;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px;
  }
  li { position: relative; min-width: 0; }
  .thumb {
    display: block; position: relative; width: 100%; aspect-ratio: 1; padding: 0; border: 2px solid transparent;
    border-radius: 6px; overflow: hidden; background: var(--border); cursor: pointer;
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  li.hidden .thumb img { opacity: 0.35; }
  li.selected .thumb { border-color: var(--focus); }
  li.current .thumb { border-color: var(--accent); }
  .tick {
    position: absolute; left: 6px; bottom: 6px; width: 26px; height: 26px; border-radius: 50%;
    background: var(--focus); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 15px;
    border: 2px solid #fff;
  }
  .pick { position: absolute; top: 8px; left: 8px; z-index: 2; width: 20px; height: 20px; opacity: 0; }
  li:hover .pick, .pick:checked, .pick:focus-visible { opacity: 1; }
  .badges { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; pointer-events: none; }
  .badge { background: rgba(0, 0, 0, 0.65); color: #fff; font-size: 11px; padding: 1px 6px; border-radius: 999px; }
  .cap { margin: 4px 0 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Bottom sheet action groups */
  .group.stacked { display: block; margin-bottom: 16px; }
  .group.stacked h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); margin: 0 0 6px; }
  .group.stacked .buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .group.stacked select { grid-column: 1 / -1; width: 100%; }
  .wide { width: 100%; }

  @media (max-width: 700px) {
    .toolbar { display: grid; grid-template-columns: 1fr auto; }
    .search { grid-column: 1 / -1; }
    .filter { width: 100%; }
    .grid { grid-template-columns: repeat(3, 1fr); gap: 3px; margin: 0 -6px; }
    .thumb { border-radius: 2px; border-width: 3px; }
    .grid.selecting .thumb img { transform: scale(0.94); }
    li.selected .thumb img { transform: scale(0.88); }
    .badges { top: 4px; right: 4px; }
    .badge { font-size: 10px; padding: 0 5px; }
  }
  .selbar {
    position: fixed; left: 0; right: 0; z-index: 15;
    bottom: calc(var(--tabbar) + env(safe-area-inset-bottom));
    height: var(--selbar);
    display: flex; align-items: center; gap: 8px; padding: 0 10px;
    background: var(--surface); border-top: 1px solid var(--border);
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.08);
  }
  .selbar strong { flex: 1; }
</style>
