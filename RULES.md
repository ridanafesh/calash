# Calash — Official Game Rules

## Overview

Calash is a rummy-style card game for **2 to 4 players**. Players collect melds (sequences and sets) on the table and try to empty their hand before opponents while accumulating the highest score. The first player to reach **1,000 cumulative points** across rounds wins the game.

---

## Components

| Item | Quantity |
|---|---|
| Standard 52-card decks | 2 |
| Jokers | 2 |
| **Total cards** | **106** |

---

## Setup

### Dealers and Turn Order

- One player is designated the **dealer** for the first round.
- After each round the player to the **left** of the previous dealer becomes the new dealer.
- Cards are distributed and play proceeds **counterclockwise**.

### Dealing

1. The dealer distributes cards **counterclockwise**, one at a time.
2. Each player receives **14 cards**.
3. The player **immediately to the dealer's right** receives **15 cards** and takes the **first turn**.
4. The remaining cards form the face-down **hidden deck** (draw pile).
5. No card is placed on the discard pile at the start — the first player opens the discard pile by discarding.

---

## Turn Structure

On each turn a player must perform the following steps **in order**:

### Step 1 — Draw or Take

Choose **one** of:

**A. Draw from the hidden deck**
Take the top card from the face-down deck. You now hold it; proceed to Step 2.

**B. Take from the discard pile**
Take cards from the face-up discard pile, subject to the constraints below.

> **Discard pile rules:**
> After taking, **exactly 1 card must remain** on the discard pile.
>
> | Pile size | Allowed moves |
> |---|---|
> | 1 | Cannot take (pile must keep 1 card) |
> | 2 | Take 1, leave 1 ✓ |
> | 3 | Take 2, leave 1 ✓ |
> | 4 | Take 3, leave 1 ✓  **or** take all 4 and immediately return 1 card from your hand to the pile ✓ |
> | 4 | Take 2, leave 2 ✗ **(not allowed)** |
> | 5+ | Take all but the bottom card (pile size − 1), leave 1 ✓ |
>
> **Important:** A player who takes from the discard pile **cannot go down on that same turn**.

### Step 2 — Optional actions (if eligible)

After drawing or taking, you may perform any combination of the following:

- **Go down** (open) — place your initial melds on the table (see [Going Down](#going-down--opening))
- **Add to existing melds** — play cards from your hand onto any meld already on the table (only if you have already gone down)
- **Place new melds** — add an entirely new valid meld to the table (only if you have already gone down)

### Step 3 — Discard

Place exactly **1 card** from your hand face-up on the discard pile. Your turn ends.

> Exception: if placing a card finishes your hand entirely (see [Round End](#round-end)), you do not need to discard.

---

## Valid Melds

All melds must contain **at least 3 cards** and **at most 1 joker**.

### Sequence

A run of consecutive ranks, all **same suit**.

| Rule | Detail |
|---|---|
| Minimum length | 3 cards |
| Suit | All same suit (joker acts as any suit it fills) |
| Rank order | 2 – 3 – 4 – 5 – 6 – 7 – 8 – 9 – 10 – J – Q – K – A |
| Ace as low | **A – 2 – 3** ✓ |
| Ace as high | **Q – K – A** ✓ |
| Circular wrap | **K – A – 2** ✗ (not allowed) |

### Set

Three or four cards of the **same rank**, each a **different suit**.

| Rule | Detail |
|---|---|
| Size | 3 or 4 cards |
| Rank | All same rank |
| Suits | All different (no two cards share a suit) |

### Joker Rules

- A joker is a **wildcard** that substitutes for any card in a meld.
- **At most 1 joker per meld.**
- A joker may appear in a sequence or a set.

| Example | Valid? |
|---|---|
| 8♥ – 9♥ – Joker (acts as 10♥) | ✓ |
| Joker – 8♦ – Joker | ✗ (two jokers) |

---

## Going Down (Opening)

"Going down" means placing your **first** set of melds on the table.

### First player to go down

The total value of all melds placed must be **≥ 75 points**.

### Every subsequent player

Must open with melds totaling at least **5 more than the current highest exposed table total**.

> **Example:**
> - Player A goes down with 80 points. Highest table total = 80.
> - Player B must open with ≥ 85.
> - Player A later adds cards, bringing their table total to 96. Highest = 96.
> - Player C (still unopened) must now open with ≥ 101.

### Restrictions

- A player **cannot go down on the same turn** they took cards from the discard pile.
- All melds placed at opening must be **valid** at the moment of going down.

---

## After Going Down

Once a player has gone down, on **subsequent turns** they may:

1. **Add cards to existing melds** — extend any meld on the table (including other players' melds if the result is still valid).
2. **Place new melds** — put down additional valid melds from their hand.

These actions happen during Step 2 of the turn, after drawing.

---

## Card Values

| Card(s) | Point value |
|---|---|
| Ace | 25 |
| Joker | 25 |
| 10, J, Q, K | 10 |
| 2 | 2 |
| 3 | 3 |
| 4 | 4 |
| 5 | 5 |
| 6 | 6 |
| 7 | 7 |
| 8 | 8 |
| 9 | 9 |

---

## Scoring

At the end of each round, each player's score is calculated as:

```
round score = (total value of cards on the table) − (total value of cards still in hand)
```

- The player who **finishes first** (empties their hand) receives an additional **+20 bonus**.
- Scores may be **negative** (if a player has high-value cards stuck in hand).
- Scores **carry across rounds** — cumulative negative totals are possible.

---

## Round End

A round ends when **either** of the following occurs:

1. **A player empties their hand** — they play or discard their last card.
2. **The hidden deck is exhausted** — no cards remain to draw from.

When the deck runs out, the round ends immediately (no more turns). All players' hands are counted as negative.

---

## Winning the Game

The first player whose **cumulative score reaches 1,000 or more** wins the game.

If multiple players cross 1,000 in the same round, the player with the highest cumulative total wins.

---

## Rule Clarifications & Edge Cases

### Ace in sequences
Ace is explicitly **dual-value**: it may serve as rank 1 (before 2) or rank 14 (after K), but **not both in the same sequence**.

| Sequence | Valid? | Reason |
|---|---|---|
| A – 2 – 3 | ✓ | Ace is low |
| Q – K – A | ✓ | Ace is high |
| K – A – 2 | ✗ | Circular wrap not allowed |

### Two-deck duplicates
Because the game uses two full decks, two cards with the same rank and suit exist. Both may appear on the table in **different melds**, but the same physical card cannot appear twice.

### Joker in a set
When a joker substitutes in a set, it represents the missing suit. The meld still counts as having only the suits of the real cards plus one wildcard.

### Adding to opponent melds
The rules do not restrict which player's melds you may extend — any card that legally extends a meld on the table may be played there. The card's value then counts toward the **owner of the meld** for scoring purposes.

> ⚠️ *Implementation note:* "adding to opponent melds" scoring attribution will be specified in a future rules update. For the MVP, all cards added to table melds count for the player who placed them.

---

## Quick Reference

| Item | Value |
|---|---|
| Players | 2 – 4 |
| Total cards | 106 (2 × 52 + 2 jokers) |
| Cards per player | 14 (first player gets 15) |
| First go-down minimum | 75 |
| Subsequent go-down minimum | highest table total + 5 |
| Finish bonus | +20 |
| Win condition | ≥ 1,000 cumulative points |
