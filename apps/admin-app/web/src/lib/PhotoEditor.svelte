<script lang="ts">
  import type { AdminCollection, AdminPhoto } from '@showcase/shared';
  import { untrack } from 'svelte';
  import { api, formatDate, GPS_OPTIONS, gpsLabel } from './api';

  let {
    photo,
    collections,
    defaultGps,
    onsaved,
    onrefresh,
    onclose,
  }: {
    photo: AdminPhoto;
    collections: AdminCollection[];
    defaultGps: number;
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
  let gps = $state(initial.gpsPrecision === null ? 'default' : String(initial.gpsPrecision));
  let sort = $state(initial.sort === null ? '' : String(initial.sort));
  let member = $state<Set<string>>(new Set(initial.collections));
  let busy = $state(false);
  let message = $state<{ text: string; error?: boolean } | null>(null);

  const effectiveGps = $derived(gps === 'default' ? defaultGps : Number(gps));

  async function save() {
    busy = true;
    message = null;
    try {
      const updated = await api.updatePhoto(photo.id, {
        visible,
        featured,
        caption: caption.trim() || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        gpsPrecision: gps === 'default' ? null : Number(gps),
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
  <img src={photo.src.preview} alt={photo.caption ?? ''} />

  <dl class="facts">
    <dt>Taken</dt><dd>{formatDate(photo.takenAt)}</dd>
    {#if photo.place}<dt>Place</dt><dd>{photo.place}</dd>{/if}
    {#if photo.camera}<dt>Camera</dt><dd>{photo.camera}{photo.lens ? ` · ${photo.lens}` : ''}</dd>{/if}
    {#if photo.exactLocation}
      <dt>GPS</dt><dd>{photo.exactLocation.lat.toFixed(5)}, {photo.exactLocation.lon.toFixed(5)} <span class="muted">(private)</span></dd>
    {/if}
    {#if photo.description}<dt>Immich</dt><dd>{photo.description}</dd>{/if}
  </dl>

  <form onsubmit={(e) => { e.preventDefault(); save(); }}>
    <label class="check field"><input type="checkbox" bind:checked={visible} /> Visible on the public site</label>
    <label class="check field"><input type="checkbox" bind:checked={featured} /> Featured</label>

    <label class="field"><span>Caption</span><textarea bind:value={caption} maxlength="2000"></textarea></label>
    <label class="field"><span>Tags</span>
      <input type="text" bind:value={tags} placeholder="e.g. beach, sunset" />
      <small class="muted">Comma-separated.</small>
    </label>

    <label class="field"><span>Published location</span>
      <select bind:value={gps}>
        <option value="default">Site default ({gpsLabel(defaultGps)})</option>
        {#each GPS_OPTIONS as o (o.value)}<option value={String(o.value)}>{o.label}</option>{/each}
      </select>
      <small class="muted">
        {#if !photo.exactLocation}This photo has no GPS data.
        {:else if effectiveGps < 0}Coordinates are not published; place names still are.
        {:else}Published rounded to {effectiveGps} decimal place{effectiveGps === 1 ? '' : 's'}.{/if}
      </small>
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
      {#if message}<span class:error={message.error} role="status">{message.text}</span>{/if}
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
