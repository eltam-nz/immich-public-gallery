<script lang="ts">
  import type { AdminCollection } from '@showcase/shared';
  import { api } from './api';
  import Sheet from './Sheet.svelte';
  import { media, notify } from './state.svelte';

  let { collections, onchange }: { collections: AdminCollection[]; onchange: () => Promise<void> } = $props();

  // Sheet state: creating, editing a collection, or the phone "more" menu for one.
  let mode = $state<null | { kind: 'create' } | { kind: 'edit'; c: AdminCollection } | { kind: 'menu'; c: AdminCollection }>(null);
  let draft = $state({ title: '', slug: '', description: '', visible: true });
  let busy = $state(false);

  const slugify = (s: string) =>
    s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 64);

  async function run(fn: () => Promise<unknown>, done: string) {
    busy = true;
    try {
      await fn();
      await onchange();
      notify(done);
      return true;
    } catch (e) {
      notify((e as Error).message, true);
      return false;
    } finally {
      busy = false;
    }
  }

  function startCreate() {
    draft = { title: '', slug: '', description: '', visible: true };
    mode = { kind: 'create' };
  }

  function startEdit(c: AdminCollection) {
    draft = { title: c.title, slug: c.slug ?? '', description: c.description ?? '', visible: c.visible };
    mode = { kind: 'edit', c };
  }

  async function submit() {
    const title = draft.title.trim();
    if (!title || !mode) return;
    if (mode.kind === 'create') {
      const ok = await run(
        () => api.createCollection({ title, slug: draft.slug.trim() || slugify(title) || null, description: draft.description, visible: draft.visible }),
        `Created “${title}”. Add photos from the Photos tab.`,
      );
      if (ok) mode = null;
    } else if (mode.kind === 'edit') {
      const id = mode.c.id;
      const ok = await run(
        () => api.updateCollection(id, { title, slug: draft.slug.trim() || null, description: draft.description, visible: draft.visible }),
        'Saved.',
      );
      if (ok) mode = null;
    }
  }

  async function remove(c: AdminCollection) {
    mode = null;
    if (!confirm(`Delete the collection “${c.title}”? Its photos stay in the gallery.`)) return;
    await run(() => api.deleteCollection(c.id), `Deleted “${c.title}”.`);
  }

  const toggleVisible = (c: AdminCollection) => {
    mode = null;
    return run(() => api.updateCollection(c.id, { visible: !c.visible }), c.visible ? `“${c.title}” hidden.` : `“${c.title}” shown.`);
  };

  // Reorder with ↑/↓: swap with the neighbour and save the whole order in one
  // request (the server renumbers in steps of 10 inside a transaction).
  async function move(i: number, delta: number) {
    const order = collections.map((c) => c.id);
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    await run(() => api.orderCollections(order), 'Order updated.');
  }

  // Desktop: drag a collection by its handle onto another to move it there.
  let dragFrom = $state<number | null>(null);
  let dragOver = $state<number | null>(null);
  async function drop(to: number) {
    const from = dragFrom;
    dragFrom = dragOver = null;
    if (from === null || from === to) return;
    const order = collections.map((c) => c.id);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved!);
    await run(() => api.orderCollections(order), 'Order updated.');
  }
</script>

<section>
  <div class="head">
    <div>
      <h2>Public order</h2>
      <p class="muted intro">
        The home page shows collections in this order. {media.phone ? 'Use ↑ ↓ to move one.' : 'Drag ⠿ or use ↑ ↓ to move one.'}
        <strong>Featured photography</strong> (photos ticked Featured) always appears after them.
      </p>
    </div>
    <button class="btn primary" onclick={startCreate}>+ New collection</button>
  </div>

  {#if !collections.length}
    <p class="muted">No collections yet.</p>
  {/if}

  <ul>
    {#each collections as c, i (c.id)}
      <li class:off={!c.visible} class:dragover={dragOver === i && dragFrom !== i}
        ondragover={(e) => { if (dragFrom !== null) { e.preventDefault(); dragOver = i; } }}
        ondragleave={() => dragOver === i && (dragOver = null)}
        ondrop={(e) => { e.preventDefault(); drop(i); }}>
        <span class="pos" aria-label={`Position ${i + 1}`}>{i + 1}</span>
        {#if !media.phone}
          <span class="handle" draggable="true" role="button" tabindex="-1" aria-hidden="true" title="Drag to reorder"
            ondragstart={(e) => { dragFrom = i; e.dataTransfer?.setData('text/plain', c.id); }}
            ondragend={() => (dragFrom = dragOver = null)}>⠿</span>
        {/if}
        <div class="cover">{#if c.cover}<img src={c.cover} alt="" loading="lazy" />{/if}</div>
        <div class="info">
          <strong>{c.title}</strong>
          <span class="muted meta">{c.count} photo{c.count === 1 ? '' : 's'}{c.visible ? '' : ' · hidden'}</span>
          {#if c.slug}<span class="muted meta">/?c={c.slug}</span>{/if}
          {#if c.description && !media.phone}<p>{c.description}</p>{/if}
        </div>
        <div class="order">
          <button class="btn icon" disabled={busy || i === 0} onclick={() => move(i, -1)} aria-label={`Move ${c.title} up`}>↑</button>
          <button class="btn icon" disabled={busy || i === collections.length - 1} onclick={() => move(i, 1)} aria-label={`Move ${c.title} down`}>↓</button>
        </div>
        {#if media.phone}
          <button class="btn icon more" onclick={() => (mode = { kind: 'menu', c })} aria-label={`More actions for ${c.title}`}>⋯</button>
        {:else}
          <div class="row">
            <button class="btn" disabled={busy} onclick={() => toggleVisible(c)}>{c.visible ? 'Hide' : 'Show'}</button>
            <button class="btn" onclick={() => startEdit(c)}>Edit</button>
            <button class="btn danger" disabled={busy} onclick={() => remove(c)}>Delete</button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>

{#if mode?.kind === 'menu'}
  {@const c = mode.c}
  <Sheet title={c.title} onclose={() => (mode = null)}>
    <div class="menu">
      <button class="btn" onclick={() => startEdit(c)}>Edit details</button>
      <button class="btn" disabled={busy} onclick={() => toggleVisible(c)}>{c.visible ? 'Hide from public site' : 'Show on public site'}</button>
      <button class="btn danger" disabled={busy} onclick={() => remove(c)}>Delete collection</button>
    </div>
  </Sheet>
{:else if mode?.kind === 'create' || mode?.kind === 'edit'}
  <Sheet title={mode.kind === 'create' ? 'New collection' : `Edit “${mode.c.title}”`} onclose={() => (mode = null)}>
    <form id="coll-form" onsubmit={(e) => { e.preventDefault(); submit(); }}>
      <label class="field"><span>Title</span>
        <input type="text" bind:value={draft.title} maxlength="200" required placeholder="e.g. Summer 2024" />
      </label>
      <label class="field"><span>URL name <small class="muted">(optional)</small></span>
        <input type="text" bind:value={draft.slug} maxlength="64" placeholder={slugify(draft.title) || 'summer-2024'} autocapitalize="none" />
      </label>
      <label class="field"><span>Description</span><textarea bind:value={draft.description} maxlength="2000"></textarea></label>
      <label class="check"><input type="checkbox" bind:checked={draft.visible} /> Visible on the public site</label>
    </form>
    {#snippet footer()}
      <button class="btn" type="button" onclick={() => (mode = null)}>Cancel</button>
      <button class="btn primary" type="submit" form="coll-form" disabled={busy || !draft.title.trim()}>
        {mode?.kind === 'create' ? 'Create' : 'Save'}
      </button>
    {/snippet}
  </Sheet>
{/if}

<style>
  section { max-width: 900px; }
  .head { display: flex; gap: 16px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .intro { margin: 0; font-size: 13px; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  li {
    display: grid; grid-template-columns: auto auto 64px 1fr auto auto; gap: 12px; align-items: center;
    padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface);
    box-shadow: var(--shadow);
  }
  li.dragover { outline: 2px dashed var(--focus); outline-offset: 2px; }
  h2 { font-size: 16px; margin: 0 0 2px; }
  .pos {
    display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%;
    background: var(--accent-soft); color: var(--accent-strong); font-weight: 700; font-size: 13px;
  }
  .handle { cursor: grab; color: var(--muted); font-size: 20px; padding: 0 2px; user-select: none; }
  li.off { opacity: 0.6; }
  .cover { width: 64px; height: 64px; border-radius: 6px; background: var(--border); overflow: hidden; }
  .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .info { display: grid; min-width: 0; }
  .info strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .info p { margin: 4px 0 0; font-size: 13px; }
  .order, .row { display: flex; gap: 6px; }
  .menu { display: grid; gap: 8px; }

  @media (max-width: 700px) {
    .head { flex-direction: column; align-items: stretch; }
    .head .btn { width: 100%; }
    li { grid-template-columns: auto 56px 1fr auto auto; gap: 8px; padding: 6px 8px; }
    .pos { width: 24px; height: 24px; font-size: 12px; }
    .cover { width: 56px; height: 56px; }
    .order { gap: 4px; }
  }
</style>
