# Character Template Plan

## Goal

Add a character creation template flow. A template is only a creation shortcut: when a user creates a character from a template, the character receives a snapshot of the template fields. The created character does not keep a template reference, and later template changes do not affect existing characters.

The creation dialog should support both preset templates and a custom character option. Template content should be shown in the current UI language only, while the repository should include Chinese, English, and Japanese versions for each of the initial three template concepts.

## Confirmed Product Decisions

- Template selection opens after the user clicks create/new character.
- Template content can be edited during creation before submitting.
- `interactionMode` is chosen at creation time and cannot be changed after the character is created.
- `language` can be changed after creation. It affects prompt language usage only.
- Add three starter template personas.
- Each starter template persona should have localized versions for `zh-CN`, `en-US`, and `ja-JP`.
- The frontend should display only the version matching the current UI language.

## Current Relevant Behavior

- `POST /v1/characters` creates the character and also auto-creates the first conversation, conversation actors, and per-character state.
- The current character PATCH endpoint allows `interactionMode` updates; this must change.
- SQLite already has a `characters.language` column and the persona-flow `Character` domain type already has `language`, but the contracts/server/web character projection does not fully expose it yet.
- Only `single_character_chat` is fully implemented; other interaction modes exist as shared contract values but are renderer placeholders/fallbacks.

## Proposed Data Shape

Template identity:

```ts
type CharacterTemplateId = string;
```

API-facing template:

```ts
interface CharacterTemplate {
  id: CharacterTemplateId;
  language: "zh-CN" | "en-US" | "ja-JP";
  interactionMode: InteractionMode;
  name: string;
  displayName: string | null;
  description: string;
  personaPrompt: string;
  greetingMessage: string | null;
}
```

Repository source format should use one file per template and per language:

```json
{
  "id": "neighbor-girl-zh-CN",
  "language": "zh-CN",
  "interactionMode": "single_character_chat",
  "sortOrder": 10,
  "name": "邻家女孩",
  "displayName": "小晴",
  "description": "...",
  "personaPrompt": "...",
  "greetingMessage": "..."
}
```

This keeps the runtime loader simple, makes language filtering explicit, and avoids mixing multiple locales in one asset file.

## Placement Options

### Option A: `apps/server`

Put template files and loading code under `apps/server`, for example:

- `apps/server/src/characterTemplates/templates/*.json`
- `apps/server/src/characterTemplates/characterTemplateService.ts`

Why this fits:

- Templates are an application-level creation shortcut, not prompt orchestration or chat domain logic.
- Created characters do not reference templates.
- The API is the only consumer for now.
- It keeps `persona-flow` focused on actual runtime persona/chat behavior.

Tradeoffs:

- If another app, such as `apps/qq-bot`, later wants the same template catalog, it would need to call server or duplicate logic.
- Deployment scripts must copy server template JSON assets.

### Option B: `packages/persona-flow`

Put template files and loading code under `packages/persona-flow`, for example:

- `packages/persona-flow/src/characterTemplates/templates/*.json`
- `packages/persona-flow/src/characterTemplates/listCharacterTemplates.ts`

Why this fits:

- Character fields are already a persona-flow domain concept.
- `persona-flow` already copies `templates` directories into `dist`.
- Multiple apps could reuse the same catalog without depending on server.

Tradeoffs:

- It expands the core package with a UI/application convenience concept.
- It may make templates look like a domain/store concept even though they are intentionally not persisted or referenced.

### Recommendation

Use Option A for the first implementation: keep character templates in `apps/server`.

The decisive reason is semantic, not technical: this feature is a shortcut for creating user-owned characters, and the created character is the real domain object. Since templates do not participate in prompt rendering, chat state, memory, persistence, or model execution, putting them in `persona-flow` would make the core package slightly less crisp.

If template reuse becomes necessary later, extract the catalog into a small package such as `packages/character-templates` rather than moving it into `persona-flow`.

## API Changes

Add to `packages/contracts/src/apis/character.api.ts`:

- `PromptLanguage = "zh-CN" | "en-US" | "ja-JP"`
- `Character.language: PromptLanguage`
- `CreateCharacterRequest.language?: PromptLanguage`
- `UpdateCharacterRequest.language?: PromptLanguage`
- `CharacterTemplate`
- `ListCharacterTemplatesResponse`
- `ApiListCharacterTemplates = GET /v1/character-templates`

Server behavior:

- `GET /v1/character-templates?language=zh-CN`
  - Returns only templates localized to the requested language.
  - If absent or unsupported, return an empty list.
- `POST /v1/characters`
  - Accepts `language`.
  - Creates the character from submitted fields only; no `templateId`.
- `PATCH /v1/characters/:id`
  - Allows `language`.
  - Rejects or ignores `interactionMode`. Prefer rejecting with `400` so callers notice stale behavior.

## Frontend Changes

Add a dedicated create popup, separate from the existing character picker popup:

- Existing picker remains focused on switching active characters.
- New create popup handles template/custom creation.

Expected create popup layout:

- Left side:
  - Template list.
  - Final option: custom character.
  - Each option displays name, short description, interaction mode, and language.
- Right side:
  - Editable fields for the selected template snapshot or custom character.
  - Name, display name, description, persona prompt, greeting message, interaction mode, language.
  - `interactionMode` is editable only during creation.
  - `language` is editable during creation and later in character edit.
- Footer:
  - Cancel.
  - Create.

Template loading:

- Frontend determines current UI language from the i18n state.
- Frontend calls `GET /v1/character-templates?language=<currentLanguage>`.
- It only renders the returned localized templates.

After successful creation:

- Append the returned character to local `characters`.
- Set it active through the existing active-character flow.
- Sync the edit draft and bump `contextVersion`.

Character edit panel:

- Remove `interactionMode` select from edit mode.
- Keep `interactionMode` visible in read mode.
- Add editable `language` field.

## Initial Template Concepts

Use three `single_character_chat` templates initially to avoid promising behavior that other modes do not fully implement yet:

- Neighbor girl: warm, lively, close, and lightly playful.
- Tsundere girl: proud and sharp on the surface, but obviously caring underneath.
- Elf mage: a fantasy-style companion from a sword-and-sorcery world.

Each concept should have `zh-CN`, `en-US`, and `ja-JP` localized content.

## Tests

Server:

- Lists templates by language.
- Template list does not expose all locales at once.
- Character creation accepts language.
- Character creation from submitted template fields has no template reference.
- PATCH can update language.
- PATCH cannot update interaction mode.

Web:

- Typecheck create popup and API wrappers.
- Verify create flow maps selected template into create request fields.
- Verify custom option starts with editable blank/default fields.

Build:

- Ensure template JSON files are available in server build/deploy output.

## Open Discussion

- Final placement: `apps/server` is recommended, but this should be confirmed before implementation.
- Should unsupported UI languages fall back to `en-US`, `zh-CN`, or the browser's closest supported locale?
- Should templates include avatar/image later? Current character contract does not expose avatar to web, so this plan leaves it out.
- Should non-`single_character_chat` templates be hidden until those modes are fully implemented?
