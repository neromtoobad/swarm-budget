# Direction: hi-vis

The first pass (cream page, condensed type, flat ground plane, small cards) read as a plain dashboard. Replaced.

## References (principles only)
- saildrone.com: one confident medium-weight sans, big, calm; the machine is the hero.
- carbonrobotics.com: industrial robotics tone, equipment colours carry the brand.
- fuse-fintech.framer.website: product-page polish, soft layered panels, near-black ink, 16px controls.
- zipline.com (earlier pass): the landscape carries the mood.

## Ours
The farm is a crafted **diorama**: a floating slab of land with soil strata, lit like a product render, sitting in a
daylight sky. It fills the first screen. The interface floats over it as white panels.

- **Identity: hi-vis.** Safety yellow (#FFD426) on near-black ink, the colours of field equipment. Yellow is the
  only accent; green and red are kept for "accepted" and "refused".
- **Telegraph, literally.** A lattice mast and a line of telegraph poles stand on the farm. Each paid answer is a pulse
  that leaves the mast and lands on the machine that bought it. Nothing moves on the wire unless a real purchase happened.
- **The inspection is the hero moment.** When an answer lands, a card opens over the machine: who answered, what they
  said, then each guard check ticks in one by one, then a stamp: Accepted or Refused.
- **Machines as objects.** Kite (hi-vis spray quad with a boom and mist), Lark (white fixed-wing scout), Mule (six-wheel
  rover with a solar deck), Haul (reefer truck), Ledger (weather station). Their motion maps to real outcomes: Kite
  sprays only after an accepted "act", Haul leaves only when the drive fits the cold chain, the pivot irrigates only
  when Lark said so.
- **Type:** Host Grotesk (tested against 10 others on the real headline), Geist Mono for hashes and labels.
- **Copy:** literal. First line says what it does. Buttons are verbs.

## Tokens
- sky #D6E9FB → #F1F6FA, canvas #F3F5F2, panel #FFFFFF, ink #10150F, ink-2 #3F4A41, muted #6C776E
- hi #FFD426, ok #17914F, bad #E0412F, hold #B86E00
- radii 24 (panels) / 16 (cards) / 12 (controls) / 999 (chips)
- motion: 0.5s cubic-bezier(.22,1,.36,1) for moves, a small overshoot for pops, 180ms stagger for checks
