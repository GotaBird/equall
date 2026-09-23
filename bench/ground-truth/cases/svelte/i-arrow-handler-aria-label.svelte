<script lang="ts">
  let open = false
  export let label = 'Toggle menu'
</script>

<button type="button" on:click={() => (open = !open)} aria-expanded={open} aria-label={label}>
  <svg aria-hidden="true" width="16" height="16"><path d="M1 3h14" /></svg>
</button>
