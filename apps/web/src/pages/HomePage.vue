<script setup lang="ts">
import ChatPanel from "../panels/chat/ChatPanel.vue";
import UserPreferencePanel from "../panels/userPreference/UserPreferencePanel.vue";
import ScenarioPanel from "../panels/scenario/ScenarioPanel.vue";
</script>

<template>
  <main class="home-page">
    <aside class="settings-area">
      <UserPreferencePanel />
    </aside>

    <section class="chat-area">
      <ChatPanel />
    </section>

    <aside class="info-area">
      <ScenarioPanel />
    </aside>
  </main>
</template>

<style scoped>
.home-page {
    display: flex;
    width: 100%;
    height: 100vh;
    min-height: 0;
    overflow: hidden;
}

.settings-area {
    width: 280px;
    min-width: 280px;
    border-right: 1px solid #e5e7eb;
    background: #ffffff;
}
.chat-area {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #f9fafb;
}

.info-area {
    width: 280px;
    min-width: 280px;
    border-left: 1px solid #e5e7eb;
    background: #ffffff;
    overflow-y: auto;
}
</style>
