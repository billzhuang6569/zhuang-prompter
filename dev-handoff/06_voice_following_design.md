# Voice Following Design

**Status**: Draft v0.1  
**Goal**: Determine where the speaker is in the script and advance the player safely.

## Boundary

Voice following is not a subtitle tool. It should help the teleprompter infer "where the guest is reading" and convert that into player-side scrolling.

MVP rules:

- One active voice source per room.
- Voice source can be control side or one player side.
- Stage Cue and Cue Marker metadata do not enter speech matching.
- Bound Stage Cue text does enter speech matching.
- Low confidence should hold position, not jump.
- Manual control always overrides voice following.

## Voice Source

Control side selects `voice.sourceDeviceId`.

Preference:

1. Player device closest to the guest.
2. Control microphone in local extension-screen setups.
3. On remote shoots,现场 player microphone if available.

```ts
type VoiceSourceStatus =
  | "idle"
  | "requestingPermission"
  | "active"
  | "permissionDenied"
  | "disconnected"
  | "asrUnavailable";
```

Switching source stops the old source immediately and asks the new source for microphone permission.

## Audio And ASR Flow

```text
Microphone
-> browser capture
-> local chunking / optional VAD
-> realtime ASR channel
-> partial/final transcript
-> nearby script matching
-> voice.matchResult
-> room state
-> player smooth advancement
```

Requirements:

- Ask microphone permission only after the user enables voice following.
- Device remains usable if permission is denied.
- Do not log raw audio or full transcript in ordinary logs.
- Partial transcript may preview candidates; final transcript is used for stable advance.

## Transcript Format

```json
{
  "type": "voiceTranscript",
  "roomId": "room_123456",
  "sourceDeviceId": "player_01",
  "scriptVersionId": "ver_001",
  "segmentId": "seg_00042",
  "isFinal": true,
  "text": "今天我们先看一个问题",
  "normalizedText": "今天我们先看一个问题",
  "startMs": 12840,
  "endMs": 15320,
  "words": [
    { "text": "今天", "startMs": 12840, "endMs": 13120, "confidence": 0.91 }
  ],
  "asrConfidence": 0.86,
  "receivedAt": 1780000000000
}
```

Rules:

- `text` preserves original transcript.
- `normalizedText` is used for matching.
- `isFinal=false` does not trigger large advancement.
- `words` may be empty if provider does not support word timestamps.
- `scriptVersionId` mismatch requires discard or rematch after version update.

## Spoken Index

```ts
type SpeechIndexItem = {
  speechSegmentId: string;
  scriptVersionId: string;
  paragraphIndex: number;
  sourceRange: { start: number; end: number };
  displayRange: { startPx?: number; endPx?: number };
  rawText: string;
  normalizedText: string;
  textHash: string;
  scrollAnchorId: string;
  nearbyMarkerId?: string;
};
```

This is the same `speechIndex` emitted by `RenderBundle` in `05_markdown_rendering_contract.md`; voice follow must not build a separate spoken index with different anchors.

Normalization:

- Remove most punctuation.
- Normalize full-width/half-width forms.
- Normalize English case.
- Collapse whitespace.
- Preserve numbers, acronyms, and proper nouns when possible.
- Never modify Markdown source.

## Matching Strategy

Do not global-search the full script by default. Search near current playback anchor.

```text
Transcript
-> normalize
-> nearby candidate window
-> fuzzy match
-> confidence calculation
-> matched anchor / range
-> scroll target
-> ScrollClock or match state
```

Initial algorithms can be lightweight:

- n-gram overlap
- edit distance
- longest common subsequence
- token hit rate
- ordering consistency
- distance penalty from current anchor

## Search Window

```ts
type SearchWindow = {
  centerAnchorId: string;
  backwardParagraphs: number;
  forwardParagraphs: number;
  maxChars: number;
  expanded: boolean;
};
```

Default:

- 1-2 paragraphs backward.
- 3-5 paragraphs forward.
- Maximum character cap to avoid long-script false matches.

Expand only after consecutive low-confidence results. Marker jump and manual takeover reset the center anchor.

## Confidence

```ts
type VoiceMatchLevel = "locked" | "probable" | "uncertain" | "lost";
```

Factors:

- ASR confidence.
- Transcript length.
- Script hit rate.
- Ordering consistency.
- Edit distance.
- Distance from current anchor.
- Cross-marker/cross-section jump.
- Continuity with previous match.
- Partial vs final transcript.

Behavior:

- `locked`: may advance player.
- `probable`: small correction only.
- `uncertain`: display only, no advance.
- `lost`: prompt for manual takeover.

## Handling Real Speech

- Repeated sentence: choose nearest reasonable candidate, do not jump far backward.
- Missing words: allow segment/order matching, require repeated evidence before large advance.
- Changed words: tolerate limited edit distance; lower confidence for names/numbers.
- Noise or side talk: do not advance; enter `uncertain` or `lost`.

## Match Result Event

```json
{
  "type": "voice.matchResult",
  "roomId": "room_123456",
  "sourceDeviceId": "player_01",
  "scriptVersionId": "ver_001",
  "transcriptSegmentId": "seg_00042",
  "matchedScrollAnchorId": "anchor_p_012",
  "matchedSpeechSegmentId": "speech_012",
  "targetOffsetPx": 1820,
  "confidence": 0.88,
  "level": "locked",
  "shouldAdvance": true,
  "reason": "nearby_final_match",
  "updatedAt": 1780000000000
}
```

High-confidence match should advance smoothly, not jump abruptly, then player reports real PlaybackState.

ScrollClock bridge:

- `locked` creates a new ScrollClock using the matched scroll anchor and target offset.
- `probable` may only make a small correction within the current viewport.
- `uncertain` and `lost` never create ScrollClock.
- Version mismatch clears the match and requires rebuilding `RenderBundle`.

## Manual Takeover Cooldown

Manual takeover triggers:

- Control pause.
- Control manual scroll.
- Player manual scroll.
- Speed change.
- Marker jump.
- Resync.
- Script version switch.

```ts
type VoiceFollowLock = {
  mode: "auto" | "manualCooldown" | "relocking";
  cooldownUntil: number;
  relockAnchorId: string;
};
```

MVP default cooldown: 2-5 seconds.

During cooldown:

- Do not auto-advance.
- Continue showing transcript.
- Relock near manual position after cooldown.
- If relock fails repeatedly, stay in manual mode.

## Fallbacks And Privacy

Fallback:

- Permission denied: keep normal control/player use.
- ASR unavailable: disable voice auto-advance, keep fixed/manual modes.
- Network disconnected: player keeps current screen and local state.
- Low confidence: stop auto-advance, show uncertain state.
- Version changed: clear old matches and rebuild spoken index.
- Voice source disconnected: prompt control side to choose another source.

Privacy:

- Non-active devices must not capture audio.
- Stop capture when voice following is off.
- Old source stops immediately when source changes.
- Do not store raw audio long-term in MVP.
- Do not log full transcript in error logs.
- Room outsiders cannot access transcript or voice state.
