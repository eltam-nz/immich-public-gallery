<script lang="ts">
  import type { AdminCollection } from '@showcase/shared';
  import { api } from './api';

  let { collections, onchange }: { collections: AdminCollection[]; onchange: () => Promise<void> } = $props();

  let newTitle = $state('');
  let newSlug = $state('');
  let editing = $state<string | null>(null);
  let draft = $state({ title: '', slug: '', description: '', visible: true, sort: '0' });
  let busy = $state(false);
  let message = $state<{ text: string; error?: boolean } | null>(null);

  const slugify = (s: string) =>
    s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 64);

  async function run(fn: () => Promise<unknown>, done: string) {
    busy = true;
    message = null;
    try {
      await fn();
      await onchange();
      message = { text: done };
      return true;
    } catch (e) {
      message = { text: (e as Error).message, error: true };
      return false;
    } finally {
      busy = false;
    }
  }

  async function create() {
    const title = newTitle.trim();
    if (!title) return;
    const ok = await run(
      () => api.createCollection({ title, slug: newSlug.trim() || slugify(title) || null }),
      `Created “${title}”. Add photos from the Photos tab.`,
    );
    if (ok) newTitle = newSlug = '';
  }

  function startEdit(c: AdminCollection) {
    editing = c.id;
    draft = { title: c.title, slug: c.slug ?? '', description: c.description ?? '', visible: c.visible, sort: String(c.sort) };
  }

  async function saveEdit(id: string) {
    const ok = await run(
      () =>
        api.updateCollection(id, {
          title: draft.title,
          slug: draft.slug.trim() || null,
          description: draft.description,
          visible: draft.visible,
          sort: Number(draft.sort) || 0,
        }),
      'Saved.',
    );
    if (ok) editing = null;
  }

  async function remove(c: AdminCollection) {
    if (!confirm(`Delete the collection “${c.title}”? Its photos stay in the gallery.`)) return;
    await run(() => api.deleteCollection(c.id), `Deleted “${c.title}”.`);
  }

  const toggleVisible = (c: AdminCollection) =>
    run(() => api.updateCollection(c.id, { visible: !c.visible }), c.visible ? 'Hidden.' : 'Shown.');
</script>

<section>
  <form class="create" onsubmit={(e) => { e.preventDefault(); create(); }}>
    <label class="field"><span>New collection</span>
      <input type="text" bind:value={newTitle} placeholder="Title, e.g. Summer 2024" maxlength="200" required />
    </label>
    <label class="field"><span>URL name <small class="muted">(optional)</small></span>
      <input type="text" bind:value={newSlug} placeholder={slugify(newTitle) || 'summer-2024'} maxlength="64" />
    </label>
    <button class="btn primary" type="submit" disabled={busy || !newTitle.trim()}>Create</button>
  </form>
  {#if message}<p class:error={message.error} role="status">{message.text}</p>{/if}

  {#if !collections.length}
    <p class="muted">No collections yet. Collections are sub-albums inside the gallery; a photo can be in several.</p>
  {/if}

  <ul>
    {#each collections as c (c.id)}
      <li class:off={!c.visible}>
        <div class="cover">{#if c.cover}<img src={c.cover} alt="" />{/if}</div>
        {#if editing === c.id}
          <form class="edit" onsubmit={(e) => { e.preventDefault(); saveEdit(c.id); }}>
            <label class="field"><span>Title</span><input type="text" bind:value={draft.title} maxlength="200" required /></label>
            <label class="field"><span>URL name</span><input type="text" bind:value={draft.slug} maxlength="64" /></label>
            <label class="field"><span>Description</span><textarea bind:value={draft.description} maxlength="2000"></textarea></label>
            <label class="field"><span>Sort order</span><input type="number" bind:value={draft.sort} step="1" /></label>
            <label class="check field"><input type="checkbox" bind:checked={draft.visible} /> Visible on the public site</label>
            <div class="row">
              <button class="btn primary" type="submit" disabled={busy}>Save</button>
              <button class="btn" type="button" onclick={() => (editing = null)}>Cancel</button>
            </div>
          </form>
        {:else}
          <div class="info">
            <strong>{c.title}</strong>
            <span class="muted">{c.count} photo{c.count === 1 ? '' : 's'}{c.slug ? ` · /?c=${c.slug}` : ''}{c.visible ? '' : ' · hidden'}</span>
            {#if c.description}<p>{c.description}</p>{/if}
          </div>
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

<style>
  section { max-width: 900px; }
  .create { display: grid; grid-template-columns: 2fr 1fr auto; gap: 12px; align-items: end; margin-bottom: 8px; }
  @media (max-width: 640px) { .create { grid-template-columns: 1fr; } }
  ul { list-style: none; padding: 0; margin: 16px 0 0; display: grid; gap: 10px; }
  li {
    display: grid; grid-template-columns: 72px 1fr auto; gap: 16px; align-items: center;
    padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface);
  }
  li.off { opacity: 0.6; }
  .cover { width: 72px; height: 72px; border-radius: 6px; background: var(--border); overflow: hidden; }
  .cover img { width: 100%; height: 100%; object-fit: cover; }
  .info { display: grid; gap: 2px; min-width: 0; }
  .info p { margin: 4px 0 0; font-size: 13px; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  .edit { grid-column: 2 / 4; }
  @media (max-width: 640px) {
    li { grid-template-columns: 56px 1fr; }
    .cover { width: 56px; height: 56px; }
    li > .row { grid-column: 1 / 3; }
    .edit { grid-column: 1 / 3; }
  }
</style>
