# Cross Review Gate

**Status**: Passed for M0/M1 start after amendments  
**Date**: 2026-05-27  
**Review groups**: Software+Backend, Frontend+Voice, Product+API+Reality

## Review Result

The first handoff package was cross-reviewed by three independent specialist groups. The review found real blockers in the v0.1 docs. Those blockers have been amended in this folder.

## Blockers Found And Resolution

| Finding | Resolution |
| --- | --- |
| Version switch did not define how old ScrollClock migrates to new `scriptVersionId`. | Added version activation and anchor relocation flow in `04_realtime_event_protocol.md`. |
| `sequence`, `clientSeq`, `serverSeq`, and `roomRevision` responsibilities were unclear. | Canonicalized ordering: `clientSeq` for session input, `serverSeq` for replay, `roomRevision` for accepted room facts. ScrollClock has no separate sequence. |
| Player local control did not clearly create ScrollClock when accepted. | Added local control normalization table in `04_realtime_event_protocol.md`. |
| Voice match result could not convert cleanly to ScrollClock. | Added `matchedScrollAnchorId -> ScrollAnchor -> Anchor + offsetPx` bridge in `05_markdown_rendering_contract.md` and `06_voice_following_design.md`. |
| `speechText` and `SpokenIndexItem` were two competing indexes. | Canonicalized to `RenderBundle.speechIndex: SpeechIndexItem[]`. |
| Full P0 voice tests were too qualitative. | Added deterministic confidence fixture ranges in `08_test_acceptance_plan.md`. |
| CJK, mirror, fullscreen, and protocol replay tests needed stronger coverage. | Added visual/device/protocol tests in `08_test_acceptance_plan.md`. |

## Accepted Foundations

- The product model is valid: control side sends intent; player side executes and reports observed facts; room confirms shared state.
- Modular monolith is the right MVP architecture.
- `ScrollClock` as intent and `PlaybackState` as observed fact is accepted.
- Markdown is the sole user source format.
- `RenderBundle` and `speechIndex` are the shared base for rendering, anchors, and voice matching.
- One active voice source per room is accepted.
- M0-M5 milestone order is accepted.

## Current Development Gate

### Allowed Now

- M0 implementation may begin.
- M1 implementation may begin, and may close if Markdown contract tests pass.
- M2 can start after M0 room/realtime shell and M1 RenderBundle basics exist.

### Not Allowed Yet

- Do not implement complete P0 as one large sprint.
- Do not start production voice following before `speechIndex`, `scrollAnchorIndex`, and ScrollClock bridge are implemented.
- Do not treat multi-player orchestration as P0 beyond one primary player loop.

## Required First Engineering Slices

1. Room create/join + device/session + WS hello/welcome.
2. `ScriptEngine.parse(markdown) -> RenderBundle`.
3. `PlayerStage renders RenderBundle`.
4. `ScrollClock -> player local scroll -> playback.reportState`.

## Final Decision

The handoff package is now strong enough to enter formal programming through M0 and M1. Full P0 should proceed only through the documented milestone order and gates, not as a single undifferentiated build.
