<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useLocalStorage } from "../../shared/ui/useLocalStorage";
import { useToast } from "../../shared/ui/useToast";
import CharacterPickerPopup from "../character/CharacterPickerPopup.vue";
import CharacterCreatePopup from "../character/CharacterCreatePopup.vue";
import {
  activeCharacter,
  activeCharacterId,
  characters,
  editDraft,
  isDirty,
  isLoadingCharacters,
  isSavingCharacter,
  interactionModes,
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
import { t } from "../../shared/i18n/i18n";

const props = withDefaults(defineProps<{
  autoOpenCreateWhenEmpty?: boolean;
}>(), {
  autoOpenCreateWhenEmpty: false,
});

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
const showCreatePopup = ref(false);
const toast = useToast();

const characterOpen = useLocalStorage("ui.left.characterOpen", true);
const conversationOpen = useLocalStorage("ui.left.conversationOpen", true);
const actorOpen = useLocalStorage("ui.left.actorOpen", true);
const isCharacterEditing = ref(false);
const hasHandledInitialEmptyState = ref(false);

function handleCharacterToggleOpen() {
  characterOpen.value = !characterOpen.value;
}

function handleCharacterOpenPicker() {
  showPicker.value = true;
}

async function handleCharacterCreate() {
  showCreatePopup.value = true;
}

async function handleCharacterCreateFromPopup(payload: {
  name: string;
  displayName: string;
  description: string;
  personaPrompt: string;
  greetingMessage: string;
  interactionMode: "single_character_chat" | "group_chat" | "dm_narrator";
  language: "zh-CN" | "en-US" | "ja-JP";
}) {
  const created = await createCharacter(
    payload.name,
    payload.displayName,
    payload.description,
    payload.personaPrompt,
    payload.greetingMessage,
    payload.interactionMode,
    payload.language,
  );
  if (created) {
    showCreatePopup.value = false;
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
  const confirmed = window.confirm(t("sidebar.confirmDeleteConversation", { name: target?.title ?? id }));
  if (!confirmed) return;

  await deleteConversation(id);
  await loadActors();
}

async function handleConversationRename(conversationId: string, title: string | null) {
  if (!activeCharacterId.value) return;
  await updateTitle(conversationId, title);
  toast.success(t("sidebar.toastConversationSaved"));
}

function handleActorToggleOpen() {
  actorOpen.value = !actorOpen.value;
}

async function handleActorCreate() {
  await createActor(t("sidebar.newActorDefaultName"));
}

function handleActorSelect(id: string) {
  selectActor(id);
}

async function handleActorDelete(id: string) {
  const target = actors.value.find(actor => actor.id === id);
  const confirmed = window.confirm(t("sidebar.confirmDeleteActor", { name: target?.displayName ?? id }));
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

watch(
  [() => props.autoOpenCreateWhenEmpty, isLoadingCharacters, () => characters.value.length],
  ([autoOpenEnabled, loading, characterCount]) => {
    if (!autoOpenEnabled || loading || hasHandledInitialEmptyState.value) return;
    hasHandledInitialEmptyState.value = true;
    if (characterCount > 0) return;
    characterOpen.value = true;
    showPicker.value = false;
    showCreatePopup.value = true;
  },
  { immediate: true },
);
</script>

<template>
  <div class="sidebar">
    <CharacterSection
      :is-open="characterOpen"
      :active-character="activeCharacter"
      :is-editing="isCharacterEditing"
      :interaction-modes="interactionModes"
      :edit-draft="editDraft"
      :is-dirty="isDirty"
      :is-saving-character="isSavingCharacter"
      @character:toggle-open="handleCharacterToggleOpen"
      @character:open-picker="handleCharacterOpenPicker"
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

  <CharacterPickerPopup
    v-model="showPicker"
    @new-character="showPicker = false; handleCharacterCreate()"
  />
  <CharacterCreatePopup
    v-model="showCreatePopup"
    :interaction-modes="interactionModes"
    :is-saving="isSavingCharacter"
    @create-character="handleCharacterCreateFromPopup"
  />
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
