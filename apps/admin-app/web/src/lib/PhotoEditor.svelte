<script lang="ts">
  import type { AdminCollection, AdminPhoto, AdminPlace, PlaceRef } from '@showcase/shared';
  import { untrack } from 'svelte';
  import { api, formatDate, placeLabel, type LocationChoice } from './api';
  import PlacePicker from './PlacePicker.svelte';
  import Sheet from './Sheet.svelte';
  import { editorGuard, media, notify } from './state.svelte';

  let {
    photo,
    collections,
    galleryPlaces,
    selectedIds,
    position,
    hasPrev,
    hasNext,
    onprev,
    onnext,
    onsaved,
    onrefresh,
    onclose,
  }: {
    photo: AdminPhoto;
    collections: AdminCollection[];
    galleryPlaces: AdminPlace[];
    /** Other photos currently selected in the grid. */
    selectedIds: string[];
    /** e.g. "3 of 48" within the current filter. */
    position: string;
    hasPrev: boolean;
    hasNext: boolean;
    onprev: () => void;
    onnext: () => void;
    onsaved: (p: AdminPhoto) => void;
    onrefresh: () => Promise<void>;
    onclose: () => void;
  } = $props();

  // Editable copy taken once; the component is re-created per photo ({#key}).
  const initial = untrack(() => photo);
  const tagText = (t: string[]) => t.join(', ');
  let visible = $state(initial.visible);
  let featured = $state(initial.featured);
  let caption = $state(initial.caption ?? '');
  let tags = $state(tagText(initial.tags));
  // bind:value on a number input gives a number, or null/undefined when empty.
  let sort = $state<number | null | undefined>(initial.sort);
  let member = $state<Set<string>>(new Set(initial.collections));
  let busy = $state(false);
  let picking = $state(false);

  const others = $derived(selectedIds.filter((id) => id !== photo.id));
  // Same normalisation as the server (trim, collapse spaces, no duplicates), so a
  // saved form never looks "unsaved".
  const parseTags = (s: string) => [
    ...new Set(s.split(',').map((t) => t.trim().replace(/\s+/g, ' ')).filter(Boolean)),
  ];
  const sortValue = $derived(typeof sort === 'number' && Number.isFinite(sort) ? Math.trunc(sort) : null);

  // Unsaved changes in the form (location changes save immediately).
  const dirty = $derived(
    visible !== photo.visible ||
      featured !== photo.featured ||
      (caption.trim() || null) !== (photo.caption ?? null) ||
      tagText(parseTags(tags)) !== tagText(photo.tags) ||
      sortValue !== photo.sort ||
      [...member].sort().join() !== [...photo.collections].sort().join(),
  );

  /** Leave this photo (close or move) unless the user wants to keep unsaved edits. */
  function leave(go: () => void) {
    if (dirty && !confirm('Discard unsaved changes to this photo?')) return;
    editorGuard.leaving = true; // already confirmed: don't ask again on the Back navigation
    go();
  }

  // Let the router ask before the browser/phone Back button discards edits.
  $effect(() => {
    editorGuard.dirty = dirty;
  });
  $effect(() => () => Object.assign(editorGuard, { dirty: false, leaving: false }));

  async function setLocation(location: LocationChoice, done: string) {
    busy = true;
    picking = false;
    try {
      await api.updatePhoto(photo.id, { location });
      await onrefresh();
      notify(done);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      busy = false;
    }
  }

  // Copy this photo's place to the other selected photos.
  async function applyToSelected() {
    const place = photo.effectivePlace;
    if (!place || !others.length) return;
    busy = true;
    try {
      const { updated } = await api.bulk({ ids: others, location: { mode: 'place', placeId: place.id } });
      await onrefresh();
      notify(`${place.name} applied to ${updated} photo${updated === 1 ? '' : 's'}.`);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      busy = false;
    }
  }

  const sourceLabel = $derived(
    photo.locationMode === 'hidden' ? 'hidden' : photo.locationMode === 'place' ? 'set by you' : photo.gpsPlace ? 'from GPS' : '',
  );

  async function save(thenNext = false) {
    busy = true;
    try {
      const updated = await api.updatePhoto(photo.id, {
        visible,
        featured,
        caption: caption.trim() || null,
        tags: parseTags(tags),
        sort: sortValue,
      });
      const before = new Set(photo.collections);
      const add = [...member].filter((c) => !before.has(c));
      const remove = [...before].filter((c) => !member.has(c));
      for (const c of add) await api.bulk({ ids: [photo.id], addTo: c });
      for (const c of remove) await api.bulk({ ids: [photo.id], removeFrom: c });
      if (add.length || remove.length) await onrefresh();
      else onsaved(updated);
      notify('Saved.');
      if (thenNext && hasNext) onnext();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      busy = false;
    }
  }

  async function setCover(collectionId: string) {
    busy = true;
    try {
      await api.updateCollection(collectionId, { coverPhotoId: photo.id });
      await onrefresh();
      notify('Cover updated.');
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      busy = false;
    }
  }

  function toggleMember(id: string) {
    const next = new Set(member);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    member = next;
  }

  // Desktop shortcuts: J/K previous/next (outside text fields), Ctrl/⌘+S save, Esc close.
  function onkeydown(e: KeyboardEvent) {
    const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!busy) save();
    } else if (!typing && !picking && e.key === 'Escape') leave(onclose);
    else if (!typing && e.key === 'j' && hasPrev) leave(onprev);
    else if (!typing && e.key === 'k' && hasNext) leave(onnext);
  }

  // Swipe left/right on the photo to move between photos (phones).
  let sx = 0;
  let sy = 0;
  const touchstart = (e: TouchEvent) => ([sx, sy] = [e.touches[0]!.clientX, e.touches[0]!.clientY]);
  function touchend(e: TouchEvent) {
    const dx = e.changedTouches[0]!.clientX - sx;
    const dy = e.changedTouches[0]!.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && hasNext) leave(onnext);
      else if (dx > 0 && hasPrev) leave(onprev);
    }
  }
</script>

<svelte:window {onkeydown} />

<aside aria-label="Edit photo">
  <header class="head">
    <button class="btn icon" onclick={() => leave(onclose)} aria-label="Close editor">✕</button>
    <h2>Edit photo {#if position}<span class="muted pos">{position}</span>{/if}</h2>
    <button class="btn icon" disabled={!hasPrev} onclick={() => leave(onprev)} aria-label="Previous photo" title="Previous (J)">‹</button>
    <button class="btn icon" disabled={!hasNext} onclick={() => leave(onnext)} aria-label="Next photo" title="Next (K)">›</button>
  </header>

  <div class="scroll">
    <div class="preview" role="group" aria-label="Photo preview. Swipe for the next or previous photo." ontouchstart={touchstart} ontouchend={touchend}>
      <img src={photo.src.preview} alt={photo.caption ?? ''} />
    </div>

    <dl class="facts">
      <dt>Taken</dt><dd>{formatDate(photo.takenAt)}</dd>
      {#if photo.camera}<dt>Camera</dt><dd>{photo.camera}{photo.lens ? ` · ${photo.lens}` : ''}</dd>{/if}
      {#if photo.exactLocation}
        <dt>GPS</dt><dd>{photo.exactLocation.lat.toFixed(5)}, {photo.exactLocation.lon.toFixed(5)} <span class="muted">(private)</span></dd>
      {/if}
      {#if photo.description}<dt>Immich</dt><dd>{photo.description}</dd>{/if}
    </dl>

    <form id="photo-form" onsubmit={(e) => { e.preventDefault(); save(); }}>
      <section>
        <h3>Visibility</h3>
        <label class="check"><input type="checkbox" bind:checked={visible} /> Visible on the public site</label>
        <label class="check"><input type="checkbox" bind:checked={featured} /> Featured</label>
      </section>

      <section>
        <h3>Caption & tags</h3>
        <label class="field"><span class="visually-hidden">Caption</span>
          <textarea bind:value={caption} maxlength="2000" placeholder="Caption"></textarea>
        </label>
        <label class="field"><span class="visually-hidden">Tags</span>
          <input type="text" bind:value={tags} placeholder="Tags, comma-separated" autocapitalize="none" />
        </label>
      </section>
    </form>

    <section class="location" aria-label="Location">
      <h3>Location</h3>
      <p class="current">
        <strong>{photo.locationMode === 'hidden' ? 'Hidden' : placeLabel(photo.effectivePlace)}</strong>
        {#if sourceLabel}<span class="muted"> · {sourceLabel}</span>{/if}
      </p>
      <p class="muted small">The public site shows only the town or city, never exact GPS. Location changes save straight away.</p>
      <div class="row">
        <button type="button" class="btn" disabled={busy} onclick={() => (picking = !picking)}>Choose a place…</button>
        {#if photo.gpsPlace && photo.locationMode !== 'auto'}
          <button type="button" class="btn" disabled={busy}
            onclick={() => setLocation({ mode: 'auto' }, `Using GPS: ${photo.gpsPlace?.name}.`)}>Use GPS ({photo.gpsPlace.name})</button>
        {:else if !photo.gpsPlace && photo.locationMode !== 'auto'}
          <button type="button" class="btn" disabled={busy} onclick={() => setLocation({ mode: 'auto' }, 'Location cleared.')}>Clear</button>
        {/if}
        {#if photo.locationMode !== 'hidden' && photo.effectivePlace}
          <button type="button" class="btn" disabled={busy} onclick={() => setLocation({ mode: 'hidden' }, 'Location hidden.')}>Hide location</button>
        {/if}
      </div>
      {#if picking && !media.phone}
        <PlacePicker {galleryPlaces} oncancel={() => (picking = false)}
          onpick={(p: PlaceRef) => setLocation({ mode: 'place', placeId: p.id }, `Location set to ${p.name}.`)} />
      {/if}
      {#if photo.effectivePlace && others.length}
        <button type="button" class="btn primary apply" disabled={busy} onclick={applyToSelected}>
          Apply {photo.effectivePlace.name} to {others.length} selected photo{others.length === 1 ? '' : 's'}
        </button>
      {:else if photo.effectivePlace}
        <p class="muted small">Tip: select other photos in the grid to copy this place to them.</p>
      {/if}
    </section>

    {#if collections.length}
      <section>
        <h3>Collections</h3>
        <ul class="colls">
          {#each collections as c (c.id)}
            <li>
              <label class="check"><input type="checkbox" form="photo-form" checked={member.has(c.id)} onchange={() => toggleMember(c.id)} /> {c.title}</label>
              {#if member.has(c.id) && photo.collections.includes(c.id)}
                {#if c.coverPhotoId === photo.id}<span class="muted small">Cover</span>
                {:else}<button type="button" class="link" disabled={busy} onclick={() => setCover(c.id)}>Use as cover</button>{/if}
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section>
      <h3>Sort order</h3>
      <label class="field"><span class="visually-hidden">Sort order</span>
        <input type="number" form="photo-form" bind:value={sort} placeholder="Default: by date" step="1" inputmode="numeric" />
        <small class="muted">Lower numbers come first. Leave empty to sort by date.</small>
      </label>
    </section>
  </div>

  <footer class="actions">
    {#if dirty}<span class="unsaved muted">Unsaved changes</span>{/if}
    {#if hasNext}
      <button class="btn" type="button" disabled={busy} onclick={() => save(true)}>Save & next</button>
    {/if}
    <button class="btn primary" type="submit" form="photo-form" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
  </footer>
</aside>

{#if picking && media.phone}
  <Sheet title="Choose a place" onclose={() => (picking = false)}>
    <PlacePicker {galleryPlaces} framed={false}
      onpick={(p: PlaceRef) => setLocation({ mode: 'place', placeId: p.id }, `Location set to ${p.name}.`)} />
  </Sheet>
{/if}

<style>
  aside {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    align-self: start; position: sticky; top: 64px; max-height: calc(100vh - 80px);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  h2 { font-size: 15px; margin: 0; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pos { font-weight: 400; font-size: 13px; margin-left: 4px; }
  /* min-height: 0 lets this flex child shrink and scroll instead of overflowing the panel */
  .scroll { overflow-y: auto; padding: 12px 14px; flex: 1; min-height: 0; overscroll-behavior: contain; }
  .preview { background: var(--border); border-radius: 6px; display: flex; justify-content: center; touch-action: pan-y; }
  .preview img { max-width: 100%; max-height: 260px; object-fit: contain; display: block; }
  .facts { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; font-size: 13px; margin: 12px 0 4px; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  section { border-top: 1px solid var(--border); padding: 10px 0 6px; margin-top: 8px; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); margin: 0 0 6px; }
  .current { margin: 0; }
  .small { font-size: 12px; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .apply { margin-top: 10px; width: 100%; white-space: normal; }
  .colls { list-style: none; margin: 0; padding: 0; }
  .colls li { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .link { background: none; border: 0; color: var(--focus); cursor: pointer; padding: 0 4px; font-size: 13px; min-height: var(--tap); }
  .actions {
    display: flex; align-items: center; gap: 8px; justify-content: flex-end;
    padding: 8px 10px; border-top: 1px solid var(--border); background: var(--surface);
  }
  .unsaved { margin-right: auto; font-size: 13px; }
  small { font-size: 12px; }

  /* Phones: a full-screen sheet with a sticky header and footer. */
  @media (max-width: 700px) {
    aside {
      position: fixed; inset: 0; top: 0; max-height: none; border-radius: 0; border: 0; z-index: 30;
      /* 'start' (desktop) would size the fixed panel to its content instead of the screen */
      align-self: stretch; height: 100dvh;
      padding-top: env(safe-area-inset-top);
    }
    .preview img { max-height: 40vh; }
    .actions { padding-bottom: max(8px, env(safe-area-inset-bottom)); }
    .actions .btn { flex: 1; }
    .unsaved { display: none; }
  }
</style>
