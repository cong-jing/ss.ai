<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    heightMode?: 'fill' | 'auto' | 'fixed'
    padding?: 'default' | 'none'
  }>(),
  {
    heightMode: 'fill',
    padding: 'default',
  }
)
</script>

<template>
  <section
    class="panel"
    :class="[
      `panel--height-${heightMode}`,
      `panel--padding-${padding}`,
    ]"
  >
    <header v-if="title || $slots['header-actions']" class="panel-title">
      <span class="panel-title-text">{{ title }}</span>
      <div v-if="$slots['header-actions']" class="panel-title-actions">
        <slot name="header-actions" />
      </div>
    </header>

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
  min-width: 0;
  min-height: 0;

  box-sizing: border-box;
}

/* 默认：填满父容器，适合主布局里的 panel */
.panel--height-fill {
  height: 100%;
  overflow: hidden;
}

/* 自动高度，适合普通内容块，不负责内部滚动 */
.panel--height-auto {
  height: auto;
  min-height: auto;
  overflow: visible;
}

/* 固定高度模式：具体高度由外部 class / style 决定 */
.panel--height-fixed {
  overflow: hidden;
}

.panel-title {
  flex: 0 0 auto;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
  font-weight: 600;
  background: #fff;

  box-sizing: border-box;
}

.panel-title-text {
  flex: 1;
}

.panel-title-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: normal;
}

.panel-body {
  flex: 1 1 auto;

  min-width: 0;
  min-height: 0;

  overflow: hidden;

  display: flex;
  flex-direction: column;

  box-sizing: border-box;
}

.panel--padding-default .panel-body {
  padding: 12px;
}

.panel--padding-none .panel-body {
  padding: 0;
}

.panel--height-auto .panel-body {
  flex: 0 0 auto;
  min-height: auto;
  overflow: visible;
}
</style>