# Verification: Add environment-based API config to mobile app

## Card Goals
Replace hardcoded localhost API config in the mobile app with environment-based configuration using Expo's `Constants.expoConfig.extra`.

## Acceptance Criteria

- [ ] `app.json` contains `extra.MASLOW_API_HOST` defaulting to `"localhost"`
- [ ] `app.json` contains `extra.MASLOW_API_PORT` defaulting to `3117`
- [ ] `_layout.tsx` imports `Constants` from `expo-constants`
- [ ] `_layout.tsx` imports `configure` from `../services/api`
- [ ] `configure()` is called at module scope (before component render) with values from `Constants.expoConfig.extra`
- [ ] Fallback behavior: if `extra` values are missing, `configure()` falls back to its internal defaults (`localhost:3117`)
- [ ] No type errors introduced (run `npx tsc --noEmit` in `apps/mobile/`)
- [ ] No new lint errors (run `npm run lint`)

## Verification Steps

1. **Static checks**:
   ```bash
   cd apps/mobile
   npx tsc --noEmit    # should have no new errors
   npm run lint         # should have no new errors
   ```

2. **Runtime check (default config)**:
   - Run the app with `npx expo start`
   - Confirm it connects to `localhost:3117` as before (default behavior unchanged)

3. **Runtime check (custom config)**:
   - Edit `app.json` to set `MASLOW_API_HOST` to a different value (e.g., `"192.168.1.100"`)
   - Restart the app
   - Confirm API calls target the new host

4. **Edge cases**:
   - Remove the `extra` field entirely from `app.json` — app should still work (falls back to defaults)
   - Set `MASLOW_API_PORT` to a different number — confirm WebSocket and REST both use it

## Files Changed

- `apps/mobile/app.json` — added `extra` field with `MASLOW_API_HOST` and `MASLOW_API_PORT`
- `apps/mobile/app/_layout.tsx` — import `Constants` and `configure`, call `configure()` at module scope
