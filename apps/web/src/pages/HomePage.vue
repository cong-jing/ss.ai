<script setup lang="ts">
import { onMounted } from "vue";
import ChatPanel from "../panels/chat/ChatPanel.vue";
import CharacterPanel from "../panels/character/CharacterPanel.vue";
import ConversationList from "../panels/conversation/ConversationList.vue";
import UserPreferencePopup from "../panels/userPreference/UserPreferencePopup.vue";
import { useCharacterViewModel } from "../panels/character/useCharacterViewModel";

const { load } = useCharacterViewModel();

onMounted(() => {
  void load();
});
</script>

<template>
  <main class="home-page">

    <!-- LEFT: Conversation list -->
    <aside class="conversations-area">
      <ConversationList />
    </aside>

    <!-- CENTER: Chat -->
    <section class="chat-area">
      <ChatPanel />
    </section>

    <!-- RIGHT: Character editor + Settings trigger -->
    <aside class="info-area">
      <div class="info-scrollable">
        <CharacterPanel />
      </div>
      <UserPreferencePopup />
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

.conversations-area {
    width: 220px;
    min-width: 220px;
    border-right: 1px solid #e5e7eb;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    overflow: hidden;
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
    width: 260px;
    min-width: 260px;
    border-left: 1px solid #e5e7eb;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.info-scrollable {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
}
</style>

