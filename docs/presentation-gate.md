# Presentation demo gate — walkthrough record (2026-06-11)

Scripted browser run against the orchestrator (mock media, EchoDM), driving
a screen tab plus raw-WS box/host clients. Every stage observed live via
DOM probes + screenshots; clean console throughout.

| Stage | Observed |
|---|---|
| 1. Arrival | First screen join plays the establishing card ("The Moonlit Cellar" / DREAD), settles to play layout with location pill (sigil · name · mood), night-blues backdrop, caption band seeded with Pip's opening. *(Fix landed during the gate: the first-join establishing was being missed — now seeded on mount.)* |
| 2. A check | Declaration → caption shows Pip's call → tap-grid roll → "[the roll lands — success]" visual cue + outcome caption. |
| 3. Combat | Host start_combat → HUD strip "ROUND 1 · wizard · rogue · fighter · cleric", active lit, "[steel is drawn — initiative]" cue. |
| 4. Travel | "retreat upstairs" → Counting-House establishing card, pill + backdrop flip to lamp-gold, map inset appears for re-orientation. |
| 5. X-card | Anonymous box xcard → calm full-screen "the thread of fate frays and reweaves…" + caption twin; content rewound. |
| 6. A11y parity | Settings {captions large, high contrast, reduced motion}: live captions at 30.4px on pure black; establishing card renders with animation:none; ambient particles disabled. Haptic patterns fire per setting (vibration API; no-op on desktop). |

Known cosmetic: the *seeded* (catch-up) caption on a fresh join can lose a
navigation race and not display; live narration always captions. Tracked,
not gating.

Earlier per-item verifications (committed with their iterations): mini-map
fog states and pulse, tap-grid auto-submit, reveal banner flow via hub
tests, HUD overlap fix at narrow widths.
