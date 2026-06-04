import type {
    AppStores,
    Character,
    Conversation,
    ConversationActor,
    Message,
    UserCharacterState,
    UserPreferences,
    UserProviderCredential,
    UserProfile,
} from "../../src/index.js";

class InMemoryCharacterStore {
    private readonly records = new Map<string, Character>();

    async createCharacter(character: Character): Promise<void> {
        this.records.set(character.id, { ...character });
    }

    async getCharacterById(input: { userId: string; characterId: string }): Promise<Character | null> {
        const found = this.records.get(input.characterId);
        if (!found || found.userId !== input.userId) {
            return null;
        }
        return { ...found };
    }

    async listCharacters(input: { userId: string; status?: "active" | "archived"; limit?: number }): Promise<Character[]> {
        const filtered = [...this.records.values()]
            .filter(record => record.userId === input.userId)
            .filter(record => !input.status || record.status === input.status)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        if (typeof input.limit === "number") {
            return filtered.slice(0, input.limit).map(record => ({ ...record }));
        }
        return filtered.map(record => ({ ...record }));
    }

    async updateCharacter(input: { userId: string; characterId: string; patch: Partial<Omit<Character, "id" | "userId" | "createdAt">> }): Promise<void> {
        const found = await this.getCharacterById({ userId: input.userId, characterId: input.characterId });
        if (!found) {
            return;
        }
        this.records.set(input.characterId, {
            ...found,
            ...input.patch,
        });
    }

    async archiveCharacter(input: { userId: string; characterId: string; updatedAt: string }): Promise<void> {
        await this.updateCharacter({
            userId: input.userId,
            characterId: input.characterId,
            patch: { status: "archived", updatedAt: input.updatedAt },
        });
    }
}

class InMemoryConversationStore {
    private readonly records = new Map<string, Conversation>();

    async listConversations(input: { userId: string; characterId: string }): Promise<Conversation[]> {
        return [...this.records.values()]
            .filter(record => record.userId === input.userId && record.characterId === input.characterId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(record => ({ ...record }));
    }

    async getConversationById(input: { userId: string; conversationId: string }): Promise<Conversation | null> {
        const found = this.records.get(input.conversationId);
        if (!found || found.userId !== input.userId) {
            return null;
        }
        return { ...found };
    }

    async createConversation(conversation: Conversation): Promise<{ selfActorId: string; systemActorId: string }> {
        this.records.set(conversation.id, { ...conversation });
        return { selfActorId: crypto.randomUUID(), systemActorId: crypto.randomUUID() };
    }

    async deleteConversation(input: { userId: string; conversationId: string }): Promise<void> {
        const found = await this.getConversationById(input);
        if (!found) {
            return;
        }
        this.records.delete(input.conversationId);
    }

    async updateConversationTitle(input: { userId: string; conversationId: string; title: string | null; updatedAt: string }): Promise<void> {
        const found = await this.getConversationById({ userId: input.userId, conversationId: input.conversationId });
        if (!found) {
            return;
        }
        this.records.set(input.conversationId, {
            ...found,
            title: input.title,
            updatedAt: input.updatedAt,
        });
    }

    seed(conversation: Conversation): void {
        this.records.set(conversation.id, { ...conversation });
    }
}

class InMemoryConversationActorStore {
    private readonly records = new Map<string, ConversationActor>();

    async getActorById(id: string): Promise<ConversationActor | null> {
        const found = this.records.get(id);
        return found ? { ...found } : null;
    }

    async listConversationActors(input: { conversationId: string; activeOnly?: boolean }): Promise<ConversationActor[]> {
        return [...this.records.values()]
            .filter(record => record.conversationId === input.conversationId)
            .filter(record => !input.activeOnly || record.leftAt === null)
            .map(record => ({ ...record }));
    }

    async addConversationActor(input: {
        conversationId: string;
        role: ConversationActor["role"];
        sourceType: ConversationActor["sourceType"];
        displayName: string;
        userProfileId?: string | null;
        characterId?: string | null;
        profileSnapshotJson?: string | null;
    }): Promise<ConversationActor> {
        const now = new Date().toISOString();
        const created: ConversationActor = {
            id: crypto.randomUUID(),
            conversationId: input.conversationId,
            role: input.role,
            sourceType: input.sourceType,
            displayName: input.displayName,
            userProfileId: input.userProfileId ?? null,
            characterId: input.characterId ?? null,
            profileSnapshotJson: input.profileSnapshotJson ?? null,
            leftAt: null,
            createdAt: now,
            updatedAt: now,
        };
        this.records.set(created.id, created);
        return { ...created };
    }

    async updateConversationActor(input: {
        id: string;
        displayName?: string;
        profileSnapshotJson?: string | null;
        leftAt?: string | null;
    }): Promise<void> {
        const found = this.records.get(input.id);
        if (!found) {
            return;
        }
        this.records.set(input.id, {
            ...found,
            ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
            ...(input.profileSnapshotJson !== undefined ? { profileSnapshotJson: input.profileSnapshotJson } : {}),
            ...(input.leftAt !== undefined ? { leftAt: input.leftAt } : {}),
            updatedAt: new Date().toISOString(),
        });
    }

    async createActor(actor: ConversationActor): Promise<void> {
        this.records.set(actor.id, { ...actor });
    }

    seed(actor: ConversationActor): void {
        this.records.set(actor.id, { ...actor });
    }
}

class InMemoryChatStore {
    private readonly messages: Message[] = [];
    private readonly states = new Map<string, UserCharacterState>();

    async appendMessage(message: Message): Promise<void> {
        this.messages.push({ ...message });
    }

    async appendAssistantTurn(input: { message: Message; events: NonNullable<Message["turnEvents"]> }): Promise<void> {
        this.messages.push({
            ...input.message,
            turnEvents: input.events.map(event => ({ ...event })),
        });
    }

    async getRecentMessages(input: { userId?: string; conversationId: string; limit: number }): Promise<Message[]> {
        return this.messages
            .filter(message => message.conversationId === input.conversationId)
            .slice(-input.limit)
            .map(message => ({
                ...message,
                ...(message.turnEvents ? { turnEvents: message.turnEvents.map(event => ({ ...event })) } : {}),
            }));
    }

    async deleteMessage(input: { conversationId: string; messageId: string }): Promise<void> {
        const idx = this.messages.findIndex(message => message.conversationId === input.conversationId && message.id === input.messageId);
        if (idx >= 0) {
            this.messages.splice(idx, 1);
        }
    }

    async getCharacterState(input: { userId: string; characterId: string }): Promise<UserCharacterState | null> {
        const key = `${input.userId}::${input.characterId}`;
        return this.states.get(key) ?? null;
    }

    async upsertCharacterState(state: UserCharacterState): Promise<void> {
        const key = `${state.userId}::${state.characterId}`;
        this.states.set(key, { ...state });
    }

    listByConversation(conversationId: string): Message[] {
        return this.messages
            .filter(message => message.conversationId === conversationId)
            .map(message => ({
                ...message,
                ...(message.turnEvents ? { turnEvents: message.turnEvents.map(event => ({ ...event })) } : {}),
            }));
    }
}

class InMemoryUserProfileStore {
    private readonly records = new Map<string, UserProfile>();

    async getUserProfile(userId: string): Promise<UserProfile | null> {
        const found = this.records.get(userId);
        return found ? { ...found } : null;
    }

    async upsertUserProfile(profile: UserProfile): Promise<void> {
        this.records.set(profile.userId, { ...profile });
    }

    seed(profile: UserProfile): void {
        this.records.set(profile.userId, { ...profile });
    }
}

class InMemoryUserPreferencesStore {
    private readonly records = new Map<string, UserPreferences>();

    async getUserPreferences(userId: string): Promise<UserPreferences | null> {
        const found = this.records.get(userId);
        return found ? { ...found } : null;
    }

    async upsertUserPreferences(preferences: UserPreferences): Promise<void> {
        this.records.set(preferences.userId, { ...preferences });
    }

    async setCurrentCharacter(input: { userId: string; characterId: string | null; updatedAt: string }): Promise<void> {
        const prev = this.records.get(input.userId) ?? {
            userId: input.userId,
            modelAssignments: {},
            createdAt: input.updatedAt,
            updatedAt: input.updatedAt,
        };
        this.records.set(input.userId, {
            ...prev,
            currentCharacterId: input.characterId,
            updatedAt: input.updatedAt,
        });
    }

    async setModelAssignment(input: { userId: string; modelCallPurpose: import("@ss-ai/contracts").ModelCallPurpose; assignment: { provider: string; model: string }; updatedAt: string }): Promise<void> {
        const prev = this.records.get(input.userId) ?? {
            userId: input.userId,
            modelAssignments: {},
            createdAt: input.updatedAt,
            updatedAt: input.updatedAt,
        };
        this.records.set(input.userId, {
            ...prev,
            modelAssignments: {
                ...prev.modelAssignments,
                [input.modelCallPurpose]: input.assignment,
            },
            updatedAt: input.updatedAt,
        });
    }

    seed(preferences: UserPreferences): void {
        this.records.set(preferences.userId, { ...preferences });
    }
}

class InMemoryUserProviderCredentialStore {
    private readonly records = new Map<string, UserProviderCredential>();

    private key(input: { userId: string; provider: string }): string {
        return `${input.userId}::${input.provider}`;
    }

    async getCredential(input: { userId: string; provider: string }): Promise<UserProviderCredential | null> {
        const found = this.records.get(this.key(input));
        return found ? { ...found } : null;
    }

    async upsertCredential(credential: UserProviderCredential): Promise<void> {
        this.records.set(this.key(credential), { ...credential });
    }

    async deleteCredential(input: { userId: string; provider: string }): Promise<void> {
        this.records.delete(this.key(input));
    }

    async listCredentials(userId: string): Promise<UserProviderCredential[]> {
        return [...this.records.values()]
            .filter(record => record.userId === userId)
            .map(record => ({ ...record }));
    }

    seed(credential: UserProviderCredential): void {
        this.records.set(this.key(credential), { ...credential });
    }
}

export interface PersonaFlowTestFixture {
    stores: AppStores;
    seed: {
        character: (character: Character) => void;
        conversation: (conversation: Conversation) => void;
        actor: (actor: ConversationActor) => void;
        message: (message: Message) => Promise<void>;
        userProfile: (profile: UserProfile) => void;
        userPreferences: (preferences: UserPreferences) => void;
        providerCredential: (credential: UserProviderCredential) => void;
    };
    inspect: {
        messages: (conversationId: string) => Message[];
    };
}

export function createTestFixture(): PersonaFlowTestFixture {
    const character = new InMemoryCharacterStore();
    const conversation = new InMemoryConversationStore();
    const conversationActor = new InMemoryConversationActorStore();
    const chat = new InMemoryChatStore();
    const userProfile = new InMemoryUserProfileStore();
    const userPreferences = new InMemoryUserPreferencesStore();
    const providerCredential = new InMemoryUserProviderCredentialStore();

    const stores: AppStores = {
        character,
        conversation,
        conversationActor,
        chat,
        userProfile,
        userPreferences,
        providerCredential,
    };

    return {
        stores,
        seed: {
            character: (value) => {
                void character.createCharacter(value);
            },
            conversation: (value) => {
                conversation.seed(value);
            },
            actor: (value) => {
                conversationActor.seed(value);
            },
            message: async (value) => {
                await chat.appendMessage(value);
            },
            userProfile: (value) => {
                userProfile.seed(value);
            },
            userPreferences: (value) => {
                userPreferences.seed(value);
            },
            providerCredential: (value) => {
                providerCredential.seed(value);
            },
        },
        inspect: {
            messages: (conversationId) => chat.listByConversation(conversationId),
        },
    };
}
