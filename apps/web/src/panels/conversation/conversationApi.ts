import type { ConversationInfo, ConversationActor } from '@ss-ai/contracts'
import {
    apiListConversations, apiCreateConversation,
    apiSelectConversation, apiDeleteConversation,
} from '../scenario/scenarioApi'

export type { ConversationInfo }
export { apiListConversations, apiCreateConversation, apiSelectConversation, apiDeleteConversation }

export type { ConversationActor }

/** Stub – PATCH endpoint not yet implemented on the server. */
export async function apiUpdateConversationTitle(
    _characterId: string,
    _conversationId: string,
    _title: string | null,
): Promise<void> {
    throw new Error('Update conversation title: not implemented yet')
}

export async function apiListConversationActors(conversationId: string): Promise<{ actors: ConversationActor[] }> {
    const res = await fetch(`/v1/conversations/${encodeURIComponent(conversationId)}/actors`)
    if (!res.ok) {
        const err = await res.json() as { message?: string }
        throw new Error(err.message ?? `Request failed: ${res.status}`)
    }
    return res.json() as Promise<{ actors: ConversationActor[] }>
}

export async function apiCreateConversationActor(
    conversationId: string,
    input: { displayName: string; profileSnapshotJson?: string | null },
): Promise<{ actor: ConversationActor }> {
    const res = await fetch(`/v1/conversations/${encodeURIComponent(conversationId)}/actors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    })
    if (!res.ok) {
        const err = await res.json() as { message?: string }
        throw new Error(err.message ?? `Request failed: ${res.status}`)
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    })
    if (!res.ok) {
        const err = await res.json() as { message?: string }
        throw new Error(err.message ?? `Request failed: ${res.status}`)
    }
    return res.json() as Promise<{ actor: ConversationActor }>
}

export async function apiDeleteConversationActor(conversationId: string, actorId: string): Promise<void> {
    const res = await fetch(`/v1/conversations/${encodeURIComponent(conversationId)}/actors/${encodeURIComponent(actorId)}`, {
        method: 'DELETE',
    })
    if (!res.ok) {
        const err = await res.json() as { message?: string }
        throw new Error(err.message ?? `Request failed: ${res.status}`)
    }
}
