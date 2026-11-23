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

  // Reorder with ↑/↓: swap with the neighbour, then renumber in steps of 10
  // (only collections whose number changes are updated).
  async function move(i: number, delta: number) {
    const order = [...collections];
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    const changes = order.map((c, k) => ({ c, sort: (k + 1) * 10 })).filter(({ c, sort }) => c.sort !== sort);
    await run(async () => {
      for (const { c, sort } of changes) await api.updateCollection(c.id, { sort });
    }, 'Order updated.');
  }
</script>

<section>
  <div class="head">
    <p class="muted intro">Collections are sub-albums inside the gallery; a photo can be in several. The public home page lists them in this order.</p>
    <button class="btn primary" onclick={startCreate}>+ New collection</button>
  </div>

  {#if !collections.length}
    <p class="muted">No collections yet.</p>
  {/if}

  <ul>
    {#each collections as c, i (c.id)}
      <li class:off={!c.visible}>
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
    display: grid; grid-template-columns: 64px 1fr auto auto; gap: 12px; align-items: center;
    padding: 8px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface);
  }
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
    li { grid-template-columns: 56px 1fr auto auto; gap: 8px; padding: 6px; }
    .cover { width: 56px; height: 56px; }
    .order { gap: 4px; }
  }
</style>
