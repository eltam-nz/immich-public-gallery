<script lang="ts">
  import { toast } from './state.svelte';
</script>

<div class="toast-region" role="status" aria-live="polite">
  {#if toast.text}
    {#key toast.id}<p class="toast" class:error={toast.error}>{toast.text}</p>{/key}
  {/if}
</div>

<style>
  .toast-region {
    position: fixed; left: 0; right: 0; z-index: 50; pointer-events: none;
    bottom: calc(16px + env(safe-area-inset-bottom));
    display: flex; justify-content: center; padding: 0 16px;
  }
  .toast {
    margin: 0; padding: 10px 16px; border-radius: 10px; max-width: 32rem;
    background: var(--fg); color: var(--bg); font-size: 14px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
  }
  .toast.error { background: var(--danger); color: #fff; }
  @media (max-width: 700px) {
    /* Above the bottom tab bar and the selection bar. */
    .toast-region { bottom: calc(var(--tabbar) + var(--selbar) + 12px + env(safe-area-inset-bottom)); }
  }
</style>
