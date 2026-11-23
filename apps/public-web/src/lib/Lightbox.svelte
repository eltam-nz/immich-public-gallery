<script lang="ts">
  import type { PublicPhoto } from '@showcase/shared';
  import { formatDate, formatExposure } from './format';

  let {
    photos,
    index,
    onnavigate,
    onclose,
    onplace,
  }: {
    photos: PublicPhoto[];
    index: number;
    onnavigate: (i: number) => void;
    onclose: () => void;
    onplace: (placeId: string) => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let closeBtn = $state<HTMLButtonElement>();
  const photo = $derived(photos[index]!);
  const date = $derived(formatDate(photo.takenAt));
  const exposure = $derived(formatExposure(photo.exposure));
  const hasPrev = $derived(index > 0);
  const hasNext = $derived(index < photos.length - 1);

  $effect(() => {
    dialog.showModal();
    // Start on Close: predictable for keyboard and screen-reader users.
    closeBtn?.focus({ preventScroll: true });
    return () => dialog.close();
  });

  // Preload neighbours so Next/Previous feel instant.
  $effect(() => {
    for (const i of [index - 1, index + 1]) {
      const p = photos[i];
      if (p) new Image().src = p.src.preview;
    }
  });

  const prev = () => hasPrev && onnavigate(index - 1);
  const next = () => hasNext && onnavigate(index + 1);

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'ArrowRight') next();
  }

  // Swipe left/right on the photo.
  let startX = 0;
  let startY = 0;
  function touchstart(e: TouchEvent) {
    startX = e.touches[0]!.clientX;
    startY = e.touches[0]!.clientY;
  }
  function touchend(e: TouchEvent) {
    const dx = e.changedTouches[0]!.clientX - startX;
    const dy = e.changedTouches[0]!.clientY - startY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) next();
      else prev();
    }
  }
</script>

<dialog
  bind:this={dialog}
  {onkeydown}
  oncancel={(e) => { e.preventDefault(); onclose(); }}
  aria-label={`Photo ${index + 1} of ${photos.length}`}
>
  <div class="layout">
    <div class="stage" role="group" aria-label="Photo. Swipe left or right for the next or previous photo." ontouchstart={touchstart} ontouchend={touchend}>
      <img src={photo.src.preview} alt={photo.caption ?? photo.description ?? `Photo ${index + 1}`} />
    </div>

    <section class="info" aria-label="About this photo">
      <p class="pos">Photo {index + 1} of {photos.length}</p>
      {#if photo.caption}<p class="caption">{photo.caption}</p>{/if}
      {#if photo.description && photo.description !== photo.caption}<p>{photo.description}</p>{/if}
      <dl>
        {#if date}<dt>Taken</dt><dd>{date}</dd>{/if}
        {#if photo.location}
          <dt>Place</dt>
          <dd>
            <button class="linkish" onclick={() => onplace(photo.location!.placeId)}>
              {photo.location.name}, {photo.location.country}
            </button>
          </dd>
        {/if}
        {#if photo.collections.length}
          <dt>{photo.collections.length > 1 ? 'Albums' : 'Album'}</dt>
          <dd>{photo.collections.map((c) => c.title).join(', ')}</dd>
        {/if}
        {#if photo.camera}<dt>Camera</dt><dd>{photo.camera}</dd>{/if}
        {#if exposure.length}<dt>Settings</dt><dd>{exposure.join(' · ')}</dd>{/if}
      </dl>
      {#if photo.tags.length}
        <ul class="tags" aria-label="Tags">{#each photo.tags as t}<li>{t}</li>{/each}</ul>
      {/if}
    </section>

    <nav class="controls" aria-label="Photo controls">
      <button class="ctl" onclick={prev} disabled={!hasPrev}><span aria-hidden="true">‹</span> Previous</button>
      <button class="ctl close" onclick={onclose} bind:this={closeBtn}><span aria-hidden="true">✕</span> Close</button>
      <button class="ctl" onclick={next} disabled={!hasNext}>Next <span aria-hidden="true">›</span></button>
    </nav>
  </div>
</dialog>

<style>
  dialog {
    border: 0; padding: 0; margin: 0;
    width: 100vw; height: 100dvh; max-width: none; max-height: none;
    background: var(--photo-bg); color: #f5f5f5;
  }
  dialog::backdrop { background: var(--photo-bg); }
  .layout {
    height: 100%;
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) auto auto;
    grid-template-areas: 'stage' 'info' 'controls';
  }
  .stage {
    grid-area: stage;
    display: flex; align-items: center; justify-content: center;
    min-height: 0; padding: 0.5rem;
    touch-action: pan-y;
  }
  .stage img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .info {
    grid-area: info;
    padding: 0.75rem 1.25rem 0.5rem;
    max-height: 34dvh; overflow-y: auto;
    border-top: 0.0625rem solid #444;
  }
  .pos { margin: 0; color: #d4d4d4; }
  .caption { font-size: 1.2rem; font-weight: 600; margin: 0.25rem 0; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; margin: 0.5rem 0; }
  dt { color: #d4d4d4; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .linkish {
    background: none; border: 0; padding: 0; color: #a9c8ff; text-decoration: underline;
    cursor: pointer; text-align: left; min-height: 2.75rem;
  }
  .tags { list-style: none; padding: 0; margin: 0.5rem 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .tags li { border: 0.0625rem solid #777; padding: 0.15rem 0.75rem; border-radius: 999px; }
  .controls {
    grid-area: controls;
    display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    padding-bottom: max(0.6rem, env(safe-area-inset-bottom));
    background: #000;
  }
  .ctl {
    min-height: 3.25rem;
    border: 0.125rem solid #f5f5f5; border-radius: 999px;
    background: transparent; color: #f5f5f5;
    font-weight: 700; font-size: 1rem; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;
  }
  .ctl.close { background: #f5f5f5; color: #000; }
  .ctl:disabled { opacity: 0.3; cursor: default; }
  .ctl span { font-size: 1.4rem; line-height: 1; }

  /* Wide screens: details beside the photo. */
  @media (min-width: 62rem) {
    .layout {
      grid-template-columns: minmax(0, 1fr) 24rem;
      grid-template-rows: minmax(0, 1fr) auto;
      grid-template-areas: 'stage info' 'controls info';
    }
    .info { max-height: none; border-top: 0; border-left: 0.0625rem solid #444; padding: 1.5rem; }
    .controls { max-width: 40rem; width: 100%; justify-self: center; background: transparent; }
  }
</style>
