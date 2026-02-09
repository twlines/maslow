# P3.1: Extract ConversationRepository

## Goals

Extract conversation-related persistence methods from the monolithic `AppPersistence` service into a dedicated `ConversationRepository` module, following the repository pattern. `AppPersistence` delegates to the repository, so all existing consumers (primarily `AppServer`) continue to work without changes.

## Acceptance Criteria

- [x] `ConversationRepository.ts` created with `AppConversation` interface, `ConversationRepositoryService` interface, and `createConversationRepository` factory function
- [x] All 7 conversation methods extracted: `getActiveConversation`, `createConversation`, `updateConversationSession`, `updateConversationContext`, `archiveConversation`, `getRecentConversations`, `incrementMessageCount`
- [x] Repository owns the `conversations` table schema (CREATE TABLE + indexes)
- [x] Repository owns all conversation prepared statements
- [x] Repository owns the row-mapping logic (snake_case to camelCase)
- [x] `AppPersistence` imports and delegates to `ConversationRepository`
- [x] `AppConversation` type re-exported from `AppPersistence` for backward compatibility
- [x] No new TypeScript errors introduced (pre-existing errors unchanged)
- [x] No new lint errors introduced (pre-existing warnings unchanged)
- [x] All existing tests pass (68 passed, 8 skipped)

## Verification Steps

1. **Type-check**: Run `npm run type-check` (or `npx tsc --noEmit`). Verify the only errors are the pre-existing ones in `src/index.ts` (duplicate Heartbeat) and `src/services/AppServer.ts` (AuditLogFilters, search, getAuditLog, backupDatabase).

2. **Lint**: Run `npm run lint`. Verify no errors; only pre-existing `@typescript-eslint/no-explicit-any` warnings in `AppPersistence.ts`.

3. **Tests**: Run `npm run test`. All 68 tests should pass with 8 skipped.

4. **Import check**: Verify that `AppServer.ts` still imports `AppConversation` from `./AppPersistence.js` and it resolves correctly (re-exported from ConversationRepository).

5. **Schema check**: Verify that `ConversationRepository.ts` contains the full `conversations` table schema and that `AppPersistence.ts` no longer contains it.

6. **Delegation check**: Verify that `AppPersistence.ts` creates a `conversationRepo` via `createConversationRepository(db)` and delegates all 7 methods.

## Files Changed

- `src/services/ConversationRepository.ts` (NEW) — repository with interface, schema, prepared statements, factory function
- `src/services/AppPersistence.ts` (MODIFIED) — removed inline conversation code, delegates to ConversationRepository
