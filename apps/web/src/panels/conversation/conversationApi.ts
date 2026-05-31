import type { ConversationInfo, ConversationActor } from '@ss-ai/contracts'
import {
    apiListConversations, apiCreateConversation,
    apiSelectConversation, apiDeleteConversation,
} from '../userProfile/userProfileApi'
import { throwApiRequestError } from '../../shared/api/throwApiRequestError'

export type { ConversationInfo }
export { apiListConversations, apiCreateConversation, apiSelectConversation, apiDeleteConversation }

export type { ConversationActor }

/** Stub – PATCH endpoint not yet implemented on the server. */
export async function apiUpdateConversationTitle(
    characterId: string,
    conversationId: string,
    title: string | null,
): Promise<void> {
    const res = await fetch(
        `/v1/characters/${encodeURIComponent(characterId)}/conversations/${encodeURIComponent(conversationId)}`,
        {
            method: 'PATCH',
            credentials: "same-origin",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
        },
    )
    if (!res.ok) {
        await throwApiRequestError(res)
    }
}

export async function apiListConversationActors(conversationId: string): Promise<{ actors: ConversationActor[] }> {
    const res = await fetch(`/v1/conversations/${encodeURIComponent(conversationId)}/actors`, {
        credentials: "same-origin",
    })
    if (!res.ok) {
        await throwApiRequestError(res)
    }
    return res.json() as Promise<{ actors: ConversationActor[] }>
}

export async function apiCreateConversationActor(
    conversationId: string,
    input: { displayName: string; profileSnapshotJson?: string | null },
): Promise<{ actor: ConversationActor }> {
    const res = await fetch(`/v1/conversations/${encodeURIComponent(conversationId)}/actors`, {
        method: 'POST',
        credentials: "same-origin",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    })
    if (!res.ok) {
        await throwApiRequestError(res)
    }
    return res.json() as Promise<{ actor: ConversationActor }>
}

export async function apiUpdateConversationActor(
    conversationId: string,
    actorId: string,
    input: { displayName?: string; profileSnapshotJson?: string | null },
): Promise<{ actor: ConversationActor }> {
    const res = await fetch(`/v1/conversations/${encodeURIComponent(conversationId)}/actors/${encodeURIComponent(actorId)}`, {
        method: 'PATCH',
        credentials: "same-origin",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    })
    if (!res.ok) {
        await throwApiRequestError(res)
    }
    return res.json() as Promise<{ actor: ConversationActor }>
}

export async function apiDeleteConversationActor(conversationId: string, actorId: string): Promise<void> {
    const res = await fetch(`/v1/conversations/${encodeURIComponent(conversationId)}/actors/${encodeURIComponent(actorId)}`, {
        method: 'DELETE',
        credentials: "same-origin",
    })
    if (!res.ok) {
        await throwApiRequestError(res)
    }
}
