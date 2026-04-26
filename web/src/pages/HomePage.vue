<script setup lang="ts">
import ChatPanel from "../panels/chat/ChatPanel.vue";
import UserSettingsPanel from "../panels/userSettings/UserSettingsPanel.vue";
</script>

<template>
  <main class="home-page">
    <aside class="settings-area">
      <UserSettingsPanel />
    </aside>

    <section class="chat-area">
      <ChatPanel />
    </section>
  </main>
</template>

<style scoped>
.home-page {
    display: flex;
    width: 100%;
    height: 100vh;
    overflow: hidden;
}

.settings-area {
    width: 320px;
    min-width: 320px;
    border-right: 1px solid #e5e7eb;
    background: #ffffff;
}

.chat-area {
    flex: 1;
    min-width: 0;
    background: #f9fafb;
}
</style>
