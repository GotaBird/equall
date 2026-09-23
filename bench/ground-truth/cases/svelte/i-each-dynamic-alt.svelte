<script lang="ts">
  export let photos: { src: string; alt: string }[] = []
</script>

<ul>
  {#each photos as photo}
    <li><img src={photo.src} alt={photo.alt}></li>
  {/each}
</ul>
