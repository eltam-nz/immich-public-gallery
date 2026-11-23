<script lang="ts">
  import type { AdminCollection, AdminPhoto, AdminPlace, PlaceRef } from '@showcase/shared';
  import { untrack } from 'svelte';
  import { api, formatDate, placeLabel, type LocationChoice } from './api';
  import PlacePicker from './PlacePicker.svelte';

  let {
    photo,
    collections,
    galleryPlaces,
    selectedIds,
    onsaved,
    onrefresh,
    onclose,
  }: {
    photo: AdminPhoto;
    collections: AdminCollection[];
    galleryPlaces: AdminPlace[];
    /** Other photos currently selected in the grid. */
    selectedIds: string[];
    onsaved: (p: AdminPhoto) => void;
    onrefresh: () => Promise<void>;
    onclose: () => void;
  } = $props();

  // Editable copy taken once; the component is re-created per photo ({#key}).
  const initial = untrack(() => photo);
  let visible = $state(initial.visible);
  let featured = $state(initial.featured);
  let caption = $state(initial.caption ?? '');
  let tags = $state(initial.tags.join(', '));
  let sort = $state(initial.sort === null ? '' : String(initial.sort));
  let member = $state<Set<string>>(new Set(initial.collections));
  let busy = $state(false);
  let message = $state<{ text: string; error?: boolean } | null>(null);

  let picking = $state(false);
  const others = $derived(selectedIds.filter((id) => id !== photo.id));

  async function setLocation(location: LocationChoice, done: string) {
    busy = true;
    message = null;
    picking = false;
    try {
      await api.updatePhoto(photo.id, { location });
      await onrefresh();
      message = { text: done };
    } catch (e) {
      message = { text: (e as Error).message, error: true };
    } finally {
      busy = false;
    }
  }

  // Copy this photo's place to the other selected photos.
  async function applyToSelected() {
    const place = photo.effectivePlace;
    if (!place || !others.length) return;
    busy = true;
    message = null;
    try {
      const { updated } = await api.bulk({ ids: others, location: { mode: 'place', placeId: place.id } });
      await onrefresh();
      message = { text: `${place.name} applied to ${updated} photo${updated === 1 ? '' : 's'}.` };
    } catch (e) {
      message = { text: (e as Error).message, error: true };
    } finally {
      busy = false;
    }
  }

  const sourceLabel = $derived(
    photo.locationMode === 'hidden' ? 'hidden' : photo.locationMode === 'place' ? 'set by you' : photo.gpsPlace ? 'from GPS' : '',
  );

  async function save() {
    busy = true;
    message = null;
    try {
      const updated = await api.updatePhoto(photo.id, {
        visible,
        featured,
        caption: caption.trim() || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        sort: sort.trim() === '' ? null : Number(sort),
      });
      const before = new Set(photo.collections);
      const add = [...member].filter((c) => !before.has(c));
      const remove = [...before].filter((c) => !member.has(c));
      for (const c of add) await api.bulk({ ids: [photo.id], addTo: c });
      for (const c of remove) await api.bulk({ ids: [photo.id], removeFrom: c });
      if (add.length || remove.length) await onrefresh();
      else onsaved(updated);
      message = { text: 'Saved.' };
    } catch (e) {
      message = { text: (e as Error).message, error: true };
    } finally {
      busy = false;
    }
  }

  async function setCover(collectionId: string) {
    busy = true;
    message = null;
    try {
      await api.updateCollection(collectionId, { coverPhotoId: photo.id });
      await onrefresh();
      message = { text: 'Cover updated.' };
    } catch (e) {
      message = { text: (e as Error).message, error: true };
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
</script>

<aside aria-label="Edit photo">
  <div class="head">
    <h2>Edit photo</h2>
    <button class="btn" onclick={onclose} aria-label="Close editor">Close</button>
  </div>
  <p class="status" class:error={message?.error} role="status">{message?.text ?? ''}</p>
  <img src={photo.src.preview} alt={photo.caption ?? ''} />

  <dl class="facts">
    <dt>Taken</dt><dd>{formatDate(photo.takenAt)}</dd>
    {#if photo.camera}<dt>Camera</dt><dd>{photo.camera}{photo.lens ? ` · ${photo.lens}` : ''}</dd>{/if}
    {#if photo.exactLocation}
      <dt>GPS</dt><dd>{photo.exactLocation.lat.toFixed(5)}, {photo.exactLocation.lon.toFixed(5)} <span class="muted">(private, never published)</span></dd>
    {/if}
    {#if photo.description}<dt>Immich</dt><dd>{photo.description}</dd>{/if}
  </dl>

  <section class="location" aria-label="Location">
    <h3>Location</h3>
    <p class="current">
      <strong>{photo.locationMode === 'hidden' ? 'Hidden' : placeLabel(photo.effectivePlace)}</strong>
      {#if sourceLabel}<span class="muted"> · {sourceLabel}</span>{/if}
    </p>
    <p class="muted small">The public site shows only the town or city, never exact GPS.</p>
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
    {#if picking}
      <PlacePicker {galleryPlaces} oncancel={() => (picking = false)}
        onpick={(p: PlaceRef) => setLocation({ mode: 'place', placeId: p.id }, `Location set to ${p.name}.`)} />
    {/if}
    {#if photo.effectivePlace && others.length}
      <button type="button" class="btn primary apply" disabled={busy} onclick={applyToSelected}>
        Apply {photo.effectivePlace.name} to {others.length} selected photo{others.length === 1 ? '' : 's'}
      </button>
    {:else if photo.effectivePlace}
      <p class="muted small">Tip: tick other photos in the grid to copy this place to them.</p>
    {/if}
  </section>

  <form onsubmit={(e) => { e.preventDefault(); save(); }}>
    <label class="check field"><input type="checkbox" bind:checked={visible} /> Visible on the public site</label>
    <label class="check field"><input type="checkbox" bind:checked={featured} /> Featured</label>

    <label class="field"><span>Caption</span><textarea bind:value={caption} maxlength="2000"></textarea></label>
    <label class="field"><span>Tags</span>
      <input type="text" bind:value={tags} placeholder="e.g. beach, sunset" />
      <small class="muted">Comma-separated.</small>
    </label>

    <label class="field"><span>Sort order</span>
      <input type="number" bind:value={sort} placeholder="Default: by date" step="1" />
      <small class="muted">Lower numbers come first. Leave empty to sort by date.</small>
    </label>

    {#if collections.length}
      <fieldset class="field">
        <legend>Collections</legend>
        {#each collections as c (c.id)}
          <div class="coll">
            <label class="check"><input type="checkbox" checked={member.has(c.id)} onchange={() => toggleMember(c.id)} /> {c.title}</label>
            {#if member.has(c.id) && photo.collections.includes(c.id)}
              {#if c.coverPhotoId === photo.id}<span class="muted small">Cover</span>
              {:else}<button type="button" class="link" disabled={busy} onclick={() => setCover(c.id)}>Use as cover</button>{/if}
            {/if}
          </div>
        {/each}
      </fieldset>
    {/if}

    <div class="actions">
      <button class="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  </form>
</aside>

<style>
  aside {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px;
    align-self: start; position: sticky; top: 72px; max-height: calc(100vh - 88px); overflow-y: auto;
  }
  @media (max-width: 900px) {
    /* Full-screen panel on phones instead of appearing below the grid. */
    aside { position: fixed; inset: 0; top: 0; max-height: none; border-radius: 0; border: 0; z-index: 20; }
  }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  h2 { font-size: 16px; margin: 0; }
  img { width: 100%; max-height: 260px; object-fit: contain; background: var(--border); border-radius: 6px; }
  .status { min-height: 1.5em; margin: -4px 0 8px; font-size: 13px; }
  .location { border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 8px 0 12px; margin-bottom: 16px; }
  h3 { font-size: 14px; margin: 4px 0; }
  .current { margin: 0; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .apply { margin-top: 10px; width: 100%; white-space: normal; }
  .facts { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; font-size: 13px; margin: 12px 0 16px; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  fieldset { border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; }
  legend { font-weight: 500; padding: 0 4px; }
  .coll { display: flex; justify-content: space-between; align-items: center; padding: 2px 0; }
  .link { background: none; border: 0; color: var(--focus); cursor: pointer; padding: 0; font-size: 13px; }
  .small { font-size: 12px; }
  .actions { display: flex; align-items: center; gap: 12px; }
  small { font-size: 12px; }
</style>
