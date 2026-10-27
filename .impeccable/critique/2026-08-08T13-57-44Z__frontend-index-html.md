---
target: Synod companion interface
total_score: 15
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-08T13-57-44Z
slug: frontend-index-html
---
# Synod critique snapshot

## Scope

`frontend/index.html` and the companion interaction flow, with special attention to voice input and session lifecycle.

## Independent evidence

- UI detector: no automated visual findings.
- Whisper service: an authenticated `GET /voice/status` reported `available: true`; a bundled PCM transcription returned a valid result. The backend is installed and functional.
- The live client still sends cumulative PCM every 2.6 seconds, suppresses updates while a Whisper request is in flight, waits for it on final stop, and has no abort or client timeout.
- No archive/new-session API, database state, or user control is implemented. Completed-session prompts silently inherit their conversation linkage.

## Priority corrections

1. Replace the optimistic single “Whisper is ready” claim with microphone, listening, transcribing, and ready-to-send states; add labelled Stop, Cancel, retry, clear diagnostics, a real readiness probe, and cancellable/debounced requests.
2. Implement non-destructive session archive/restore plus a prominent New conversation action that clears session/context linkage. Let users explicitly choose Continue or Start fresh after completion.
3. Separate avatar output voice (“Hear Synod”) from microphone input (“Talk” / “Stop recording”), default dictation to review-before-send, and expose voice controls before Advanced.
4. Add authenticated HTTPS Chrome device-permission E2E coverage, archive lifecycle tests, and resilient timeouts/retry paths.

## UX direction

Keep the distinctive visual identity but prioritize the companion loop: speak → verify transcript → choose send/cancel → save/close. Reduce presenter/canvas emphasis while an active conversation or error needs attention. Use human navigation language: Chat, Sessions, Knowledge, Settings.
