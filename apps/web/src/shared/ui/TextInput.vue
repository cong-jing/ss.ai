<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: string;
  id?: string;
  type?: string;
  placeholder?: string;
  autocomplete?: string;
}>(), {
  type: "text",
  placeholder: ""
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

function onInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}
</script>

<template>
  <input
    :id="props.id"
    class="text-input"
    :type="props.type"
    :value="props.modelValue"
    :placeholder="props.placeholder"
    :autocomplete="props.autocomplete"
    @input="onInput"
  />
</template>

<style scoped>
.text-input {
  width: 100%;
  min-height: 36px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 6px 8px;
  font: inherit;
}
</style>
