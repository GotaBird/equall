<script lang="ts">
  let email = ''
</script>

<form>
  <label for="svelte-email">Email</label>
  <input id="svelte-email" type="email" bind:value={email}>
</form>
