<script lang="ts">
  // A bottom sheet on phones and a centred dialog on larger screens. Built on
  // <dialog> for focus handling and Esc; render it only while open.
  import type { Snippet } from 'svelte';

  let {
    title,
    onclose,
    children,
    footer,
  }: { title: string; onclose: () => void; children: Snippet; footer?: Snippet } = $props();

  let dialog: HTMLDialogElement;
  let unmounting = false;

  $effect(() => {
    dialog.showModal();
    return () => {
      unmounting = true;
      dialog.close();
    };
  });

  // Browsers may close a modal on Esc without a cancel event (e.g. repeated Esc
  // presses); treat any close we didn't cause as a request to close the sheet.
  function closed() {
    if (!unmounting) onclose();
  }

  // Clicking the dimmed backdrop (the dialog element itself) closes the sheet.
  function backdrop(e: MouseEvent) {
    if (e.target === dialog) onclose();
  }
</script>

<dialog
  bind:this={dialog}
  aria-label={title}
  oncancel={(e) => { e.preventDefault(); onclose(); }}
  onclose={closed}
  onclick={backdrop}
>
  <div class="sheet">
    <header>
      <span class="handle" aria-hidden="true"></span>
      <h2>{title}</h2>
      <button type="button" class="btn icon" onclick={onclose} aria-label="Close">✕</button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</dialog>

<style>
  dialog {
    padding: 0; border: 0; background: transparent; color: var(--fg);
    max-width: 32rem; width: calc(100% - 2rem); max-height: 85dvh;
  }
  dialog::backdrop { background: rgba(0, 0, 0, 0.45); }
  .sheet {
    background: var(--surface); border-radius: 12px; display: flex; flex-direction: column;
    max-height: 85dvh; overflow: hidden; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  }
  header { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px 16px; border-bottom: 1px solid var(--border); position: relative; }
  h2 { font-size: 16px; margin: 0; flex: 1; }
  .handle { display: none; }
  .body { padding: 12px 16px 16px; overflow-y: auto; overscroll-behavior: contain; }
  footer { padding: 10px 16px; border-top: 1px solid var(--border); display: flex; gap: 8px; justify-content: flex-end; }

  @media (max-width: 700px) {
    dialog { width: 100%; max-width: none; margin: auto 0 0; }
    .sheet { border-radius: 16px 16px 0 0; padding-bottom: env(safe-area-inset-bottom); }
    header { padding-top: 18px; }
    .handle {
      display: block; position: absolute; top: 6px; left: 50%; transform: translateX(-50%);
      width: 40px; height: 4px; border-radius: 2px; background: var(--border);
    }
    footer > :global(*) { flex: 1; }
  }
</style>
