import type { Character } from "../../../stores/character/character.js";
import type { UserProfile } from "../../../stores/user/userProfile.js";

export type SingleCharacterChatPromptViewModel = {
    character: {
        displayName: string;
        description: string;
        personaPrompt: string;
    };
    userProfile: {
        name: string;
        bio: string;
    };
};

export function buildPromptViewModel(input: {
    character: Character | null;
    userProfile: UserProfile | null;
}): SingleCharacterChatPromptViewModel {
    const characterName = input.character?.displayName || input.character?.name || "Character";

    return {
        character: {
            displayName: characterName,
            description: input.character?.description ?? "",
            personaPrompt: input.character?.personaPrompt ?? "",
        },
        userProfile: {
            name: input.userProfile?.name || input.userProfile?.userId || "User",
            bio: input.userProfile?.bio ?? "",
        },
    };
}
