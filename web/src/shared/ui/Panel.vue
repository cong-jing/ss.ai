<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<template>
  <section class="panel">
    <header v-if="title" class="panel-title">{{ title }}</header>
    <div class="panel-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.panel-title {
  padding: 12px;
  border-bottom: 1px solid #e5e7eb;
  font-weight: 600;
  background: #fff;
}

.panel-body {
  flex: 1;
  min-height: 0;
  padding: 12px;
}
</style>
