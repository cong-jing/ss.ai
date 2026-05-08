<script setup lang="ts">
import { computed } from 'vue'
import TextInput from './TextInput.vue'

interface ProviderOption {
    provider: string
    availableModels: string[]
}

const props = defineProps<{
    provider: string
    model: string
    providers: ProviderOption[]
    disabled?: boolean
    providerPlaceholder?: string
}>()

const emit = defineEmits<{
    'update:provider': [string]
    'update:model': [string]
}>()

const availableModels = computed(
    () => props.providers.find(p => p.provider === props.provider)?.availableModels ?? []
)

function onProviderChange(val: string) {
    emit('update:provider', val)
    emit('update:model', '')
}
</script>

<template>
  <div class="model-selector">
    <select
      class="ms-select"
      :value="provider"
      :disabled="disabled || providers.length === 0"
      @change="onProviderChange(($event.target as HTMLSelectElement).value)"
    >
      <option value="">{{ providerPlaceholder ?? '— inherit —' }}</option>
      <option v-for="p in providers" :key="p.provider" :value="p.provider">{{ p.provider }}</option>
    </select>

    <template v-if="provider">
      <select
        v-if="availableModels.length > 0"
        class="ms-select"
        :value="model"
        :disabled="disabled"
        @change="emit('update:model', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">— select model —</option>
        <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
      </select>
      <TextInput
        v-else
        :model-value="model"
        placeholder="model name"
        :disabled="disabled"
        @update:model-value="emit('update:model', $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.model-selector {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ms-select {
  width: 100%;
  min-height: 32px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 13px;
  font-family: inherit;
  background: #fff;
  color: #111827;
}

.ms-select:focus {
  outline: none;
  border-color: #6b7280;
}

.ms-select:disabled {
  background: #f9fafb;
  color: #9ca3af;
}
</style>
