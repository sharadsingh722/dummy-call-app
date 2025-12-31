## Project
- Stack: React Native CLI (`react-native@0.83.x`), TypeScript.
- Target in this repo: **Android incoming call notifications via Firebase**.

## Product Requirements (PRD)
- Canonical PRD: `MyApp/docs/PRD-firebase-call-notification.md`
- Implementations must meet PRD acceptance criteria, especially:
  - Call invite shows as an Android **system call**
  - Uses **system default ringtone**
  - **Accept/Decline** actions are idempotent and reliable

## Implementation Guardrails
- Prefer production-grade primitives:
  - Firebase: `@react-native-firebase/app`, `@react-native-firebase/messaging`
  - Call registration/UI: `react-native-callkeep`
  - Notification fallback/actions: `@notifee/react-native`
- Keep scope minimal: only what's needed to validate incoming call + accept/decline end-to-end.
- Don't hardcode secrets; `google-services.json` is provided externally and should not be committed unless explicitly requested.

## Dev Commands
- Install: `npm i`
- Run Android: `npm run android`
- Start Metro: `npm start`
- Lint: `npm run lint`
- Tests: `npm test`
