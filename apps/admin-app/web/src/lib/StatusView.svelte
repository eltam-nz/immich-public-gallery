<script lang="ts">
  import type { AdminStatus } from '@showcase/shared';
  import { api } from './api';
  import { media } from './state.svelte';

  let { status, onchange }: { status: AdminStatus; onchange: () => Promise<void> } = $props();

  let syncing = $state(false);
  let message = $state<{ text: string; error?: boolean } | null>(null);

  const last = $derived(status.lastSync);
  const lastAt = $derived(last ? new Date(last.at).toLocaleString() : null);

  async function syncNow() {
    syncing = true;
    message = { text: 'Sync requested. Waiting for it to finish…' };
    const before = last?.at;
    try {
      await api.sync();
      // The public API runs the sync; poll until the result changes (max ~2 min).
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        await onchange();
        if (status.lastSync?.at && status.lastSync.at !== before) {
          message = { text: 'Sync finished.' };
          return;
        }
      }
      message = { text: 'Sync is taking a while; refresh later to see the result.' };
    } catch (e) {
      message = { text: (e as Error).message, error: true };
    } finally {
      syncing = false;
    }
  }
</script>

<section>
  <div class="cards">
    <div class="card"><span class="n">{status.counts.photos}</span><span class="muted">photos synced</span></div>
    <div class="card"><span class="n">{status.counts.hidden}</span><span class="muted">hidden</span></div>
    <div class="card"><span class="n">{status.counts.collections}</span><span class="muted">collections</span></div>
  </div>

  {#if status.videos.ready + status.videos.processing + status.videos.failed > 0}
    <p class="videos">
      <strong>Videos:</strong> {status.videos.ready} ready{#if status.videos.processing} · {status.videos.processing} processing{/if}{#if status.videos.failed} · <span class="error">{status.videos.failed} couldn't be processed</span>{/if}{#if status.videos.large} · ⚠ {status.videos.large} over {status.videoWarnMB} MB{/if}
    </p>
  {/if}

  <h2>Last sync from Immich</h2>
  {#if last}
    <dl>
      <dt>When</dt><dd>{lastAt}</dd>
      <dt>Result</dt><dd class={last.ok ? 'ok' : 'error'}>{last.ok ? 'OK' : 'Problems'}</dd>
      <dt>Photos in the shared album</dt><dd>{last.assets}</dd>
      <dt>Images updated</dt><dd>{last.imagesUpdated}</dd>
      <dt>Removed</dt><dd>{last.removed}</dd>
      {#if last.immichVersion}<dt>Immich version</dt><dd>{last.immichVersion}</dd>{/if}
    </dl>
    {#if last.errors.length}
      <h3>Errors</h3>
      <ul class="errors">{#each last.errors as e}<li>{e}</li>{/each}</ul>
    {/if}
  {:else}
    <p class="muted">No sync has run yet.</p>
  {/if}

  <p class="muted">The gallery syncs automatically every few minutes. Use “Sync now” after changing the album in Immich.</p>
  <div class="row">
    <button class="btn primary" onclick={syncNow} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button>
    {#if message}<span class:error={message.error} role="status">{message.text}</span>{/if}
  </div>
</section>

{#if media.phone}
  <p class="who muted">Signed in as {status.email}{#if status.publicSiteUrl} · <a href={status.publicSiteUrl} target="_blank" rel="noopener noreferrer">View site ↗</a>{/if}</p>
{/if}

<style>
  section { max-width: 720px; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
  .card { border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 14px; display: grid; }
  .n { font-size: 26px; font-weight: 600; }
  h2 { font-size: 16px; }
  h3 { font-size: 14px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  .ok { color: var(--ok); }
  .errors { color: var(--danger); font-size: 13px; padding-left: 18px; }
  .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .who { margin-top: 32px; font-size: 13px; }
  .videos { margin: -8px 0 20px; }
  .who a { color: inherit; display: inline-flex; align-items: center; min-height: var(--tap); padding: 0 4px; }
  @media (max-width: 700px) {
    .cards { gap: 8px; }
    .card { padding: 10px; }
    .n { font-size: 22px; }
    .row .btn { width: 100%; }
    dl { grid-template-columns: 1fr auto; }
  }
</style>
