<template>
  <div class="field">
    <label :for="id">{{ label }}</label>
    <input :id="id" v-model="model" type="text">
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ id: string; label: string }>()
const model = defineModel<string>()
</script>
