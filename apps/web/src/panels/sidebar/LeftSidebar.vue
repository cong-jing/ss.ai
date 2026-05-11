<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useLocalStorage } from "../../shared/ui/useLocalStorage";
import { useToast } from "../../shared/ui/useToast";
import CharacterPickerPopup from "../character/CharacterPickerPopup.vue";
import {
  activeCharacter,
  activeCharacterId,
  editDraft,
  isDirty,
  isSavingCharacter,
  useCharacterViewModel,
} from "./viewmodels/useCharacterViewModel";
import {
  activeConversationId,
  conversations,
  isLoadingConversations,
  useConversationViewModel,
} from "./viewmodels/useConversationViewModel";
import {
  actors,
  selectedActorId,
  isLoadingActors,
  isSavingActor,
  useActorViewModel,
} from "./viewmodels/useActorViewModel";
import CharacterSection from "./sections/CharacterSection.vue";
import ConversationSection from "./sections/ConversationSection.vue";
import ActorSection from "./sections/ActorSection.vue";

const {
  load: loadCharacters,
  create: createCharacter,
  save: saveCharacter,
  remove: removeCharacter,
  syncDraft,
} = useCharacterViewModel();
const {
  load: loadConversations,
  createConversation,
  selectConversation,
  deleteConversation,
  updateTitle,
} = useConversationViewModel();
const {
  load: loadActors,
  select: selectActor,
  createActor,
  deleteActor,
} = useActorViewModel();

const showPicker = ref(false);
const newCharacterName = ref("");
const toast = useToast();

const characterOpen = useLocalStorage("ui.left.characterOpen", true);
const conversationOpen = useLocalStorage("ui.left.conversationOpen", true);
const actorOpen = useLocalStorage("ui.left.actorOpen", true);
const isCharacterEditing = ref(false);

function handleCharacterToggleOpen() {
  characterOpen.value = !characterOpen.value;
}

function handleCharacterOpenPicker() {
  showPicker.value = true;
}

function handleCharacterUpdateNewName(value: string) {
  newCharacterName.value = value;
}

async function handleCharacterCreate() {
  const created = await createCharacter(newCharacterName.value, "", "", "", "");
  if (created) {
    newCharacterName.value = "";
    isCharacterEditing.value = true;
    await loadConversations();
    await loadActors();
  }
}

async function handleCharacterPickerCreate() {
  const created = await createCharacter("New Character", "", "", "", "");
  showPicker.value = false;
  if (created) {
    isCharacterEditing.value = true;
    await loadConversations();
    await loadActors();
  }
}

function handleCharacterStartEdit() {
  isCharacterEditing.value = true;
}

function handleCharacterCancelEdit() {
  syncDraft();
  isCharacterEditing.value = false;
}

async function handleCharacterSave() {
  await saveCharacter();
  isCharacterEditing.value = false;
}

async function handleCharacterRemove() {
  if (!activeCharacter.value) return;
  await removeCharacter();
  isCharacterEditing.value = false;
}

function handleConversationToggleOpen() {
  conversationOpen.value = !conversationOpen.value;
}

async function handleConversationSelect(id: string) {
  await selectConversation(id);
  await loadActors();
}

async function handleConversationCreate() {
  await createConversation();
  await loadActors();
}

async function handleConversationDelete(id: string) {
  const target = conversations.value.find(conversation => conversation.id === id);
  const confirmed = window.confirm(`删除对话 "${target?.title ?? id}"？`);
  if (!confirmed) return;

  await deleteConversation(id);
  await loadActors();
}

async function handleConversationRename(conversationId: string, title: string | null) {
  if (!activeCharacterId.value) return;
  await updateTitle(conversationId, title);
  toast.success("Conversation title saved");
}

function handleActorToggleOpen() {
  actorOpen.value = !actorOpen.value;
}

async function handleActorCreate() {
  await createActor("new actor");
}

function handleActorSelect(id: string) {
  selectActor(id);
}

async function handleActorDelete(id: string) {
  const target = actors.value.find(actor => actor.id === id);
  const confirmed = window.confirm(`删除 Actor "${target?.displayName ?? id}"？`);
  if (!confirmed) return;

  await deleteActor(id);
}

onMounted(() => {
  void loadCharacters();
  if (activeCharacterId.value) {
    void loadConversations();
    void loadActors();
  }
});

watch(activeCharacterId, (id) => {
  isCharacterEditing.value = false;
  if (!id) {
    conversations.value = [];
    activeConversationId.value = null;
    actors.value = [];
    selectedActorId.value = null;
    return;
  }
  void loadConversations().then(() => loadActors());
});

watch(activeConversationId, () => {
  void loadActors();
});
</script>

<template>
  <div class="sidebar">
    <CharacterSection
      :is-open="characterOpen"
      :active-character="activeCharacter"
      :is-editing="isCharacterEditing"
      :edit-draft="editDraft"
      :is-dirty="isDirty"
      :is-saving-character="isSavingCharacter"
      :new-character-name="newCharacterName"
      @character:toggle-open="handleCharacterToggleOpen"
      @character:open-picker="handleCharacterOpenPicker"
      @character:update-new-name="handleCharacterUpdateNewName"
      @character:create="handleCharacterCreate"
      @character:start-edit="handleCharacterStartEdit"
      @character:cancel-edit="handleCharacterCancelEdit"
      @character:save="handleCharacterSave"
      @character:remove="handleCharacterRemove"
    />

    <ConversationSection
      :is-open="conversationOpen"
      :active-character-id="activeCharacterId"
      :is-loading-conversations="isLoadingConversations"
      :conversations="conversations"
      :active-conversation-id="activeConversationId"
      @conversation:toggle-open="handleConversationToggleOpen"
      @conversation:create="handleConversationCreate"
      @conversation:select="handleConversationSelect"
      @conversation:rename="handleConversationRename"
      @conversation:delete="handleConversationDelete"
    />

    <ActorSection
      :is-open="actorOpen"
      :active-conversation-id="activeConversationId"
      :is-loading-actors="isLoadingActors"
      :is-saving-actor="isSavingActor"
      :actors="actors"
      :selected-actor-id="selectedActorId"
      @actor:toggle-open="handleActorToggleOpen"
      @actor:create="handleActorCreate"
      @actor:select="handleActorSelect"
      @actor:delete="handleActorDelete"
    />
  </div>

  <CharacterPickerPopup v-model="showPicker" @new-character="handleCharacterPickerCreate" />
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: auto;
  background: #f8fafc;
  padding: 8px;
  gap: 8px;
}
</style>
