<script lang="ts">
  import type { PublicPhoto } from '@showcase/shared';
  import { formatDate, formatExposure, formatPlace } from './format';

  let {
    photos,
    index,
    onnavigate,
    onclose,
  }: {
    photos: PublicPhoto[];
    index: number;
    onnavigate: (i: number) => void;
    onclose: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  const photo = $derived(photos[index]!);
  const date = $derived(formatDate(photo.takenAt));
  const exposure = $derived(formatExposure(photo.exposure));
  const place = $derived(formatPlace(photo.location));

  $effect(() => {
    dialog.showModal();
    return () => dialog.close();
  });

  // Preload neighbours for snappy navigation.
  $effect(() => {
    for (const i of [index - 1, index + 1]) {
      const p = photos[i];
      if (p) new Image().src = p.src.preview;
    }
  });

  const prev = () => index > 0 && onnavigate(index - 1);
  const next = () => index < photos.length - 1 && onnavigate(index + 1);

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'ArrowRight') next();
  }
</script>

<dialog bind:this={dialog} {onkeydown} oncancel={(e) => { e.preventDefault(); onclose(); }}>
  <div class="stage">
    <img src={photo.src.preview} alt={photo.caption ?? photo.description ?? ''} />
    <button class="nav prev" onclick={prev} disabled={index === 0} aria-label="Previous">‹</button>
    <button class="nav next" onclick={next} disabled={index === photos.length - 1} aria-label="Next">›</button>
    <button class="close" onclick={onclose} aria-label="Close">×</button>
  </div>
  <aside>
    {#if photo.caption}<p class="caption">{photo.caption}</p>{/if}
    {#if photo.description && photo.description !== photo.caption}<p>{photo.description}</p>{/if}
    <dl>
      {#if date}<dt>Taken</dt><dd>{date}</dd>{/if}
      {#if place}<dt>Place</dt><dd>{place}</dd>{/if}
      {#if photo.camera}<dt>Camera</dt><dd>{photo.camera}</dd>{/if}
      {#if photo.lens}<dt>Lens</dt><dd>{photo.lens}</dd>{/if}
      {#if exposure.length}<dt>Settings</dt><dd>{exposure.join(' · ')}</dd>{/if}
      {#if photo.collection}<dt>Collection</dt><dd>{photo.collection.title}</dd>{/if}
    </dl>
    {#if photo.tags.length}
      <ul class="tags">{#each photo.tags as t}<li>{t}</li>{/each}</ul>
    {/if}
    <p class="pos">{index + 1} / {photos.length}</p>
  </aside>
</dialog>

<style>
  dialog {
    border: 0;
    padding: 0;
    margin: 0;
    width: 100vw;
    height: 100dvh;
    max-width: none;
    max-height: none;
    background: var(--overlay);
    color: #e7e5e4;
  }
  dialog[open] {
    display: grid;
    grid-template-columns: 1fr 320px;
  }
  dialog::backdrop { background: transparent; }
  .stage {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: 24px;
  }
  .stage img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .nav, .close {
    position: absolute;
    background: rgba(0, 0, 0, 0.35);
    color: #fff;
    border: 0;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    font-size: 28px;
    line-height: 1;
    cursor: pointer;
  }
  .nav { top: 50%; transform: translateY(-50%); }
  .nav:disabled { opacity: 0; pointer-events: none; }
  .prev { left: 16px; }
  .next { right: 16px; }
  .close { top: 16px; right: 16px; }
  aside {
    padding: 64px 24px 24px;
    overflow-y: auto;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
  }
  .caption { font-size: 18px; font-weight: 500; margin-top: 0; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 16px 0; }
  dt { color: #a8a29e; }
  dd { margin: 0; }
  .tags { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
  .tags li { background: rgba(255, 255, 255, 0.1); padding: 2px 10px; border-radius: 999px; font-size: 13px; }
  .pos { color: #a8a29e; font-size: 13px; }
  @media (max-width: 900px) {
    dialog[open] { grid-template-columns: 1fr; grid-template-rows: 1fr auto; }
    .stage { padding: 8px; }
    aside { padding: 16px; border-left: 0; max-height: 40dvh; }
  }
</style>
