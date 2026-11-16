# Flutter panel: design system ("Rack")

The panel is a control surface that game-server operators keep open all day. Its look comes from the hardware it controls: a server rack. Units sit in rows, each with a status LED; readouts sit in an instrument strip; labels are condensed, like the printed legends on a chassis.

Read this before adding UI. Every rule exists to stop the panel drifting back into a generic dashboard template.

## Subject, audience, job

- **Subject:** game servers on machines you own or rent.
- **Audience:** server owners and admins. Technical, often running several servers, often glancing at the panel while doing something else.
- **Primary job:** see at a glance what is running and what needs attention, then act (start, stop, open the console) in one click.

## The one bold element: the LED rail

Anything with a status (a server, a node, a backup job) gets a **3px vertical rail on its left edge** in its status colour, plus a small LED dot next to its status word. That rail is the signature of the panel. Nothing else competes with it: no gradients, no glows, no coloured cards, no hover lifts.

```
▌● Survival          Paper     us-east-1      45%   2.2 GB
▌○ Creative          Paper     us-east-1       –      –
```

Use `<LedRail status=…>` and `<Led status=…>` from `components/status.tsx` for servers. For anything else with a state (nodes, extensions, backups, scan findings, updates), use `<Rail tone="ok | warn | error | info | off" pulse?>`. Don't invent other status treatments.

## Colour

Neutral graphite with no hue (the surfaces are deliberately not tinted blue), never pure or tinted near-black. Cyan is the existing Flutter brand colour and is used **sparingly**: primary actions, focus, the active nav item, links. Status colours belong to LEDs and status text only.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--background` (graphite) | `#1B1B1C` | `#F1F1F1` | Page |
| `--card` (chassis) | `#222223` | `#FFFFFF` | Raised surfaces: panels, menus, modals |
| `--sidebar` / `--well` (rail) | `#151516` | `#E7E7E8` | Sidebar, inset wells, console, readout strip |
| `--border` (seam) | `#323234` | `#D3D3D5` | Rules and outlines |
| `--foreground` (legend) | `#E8E8E9` | `#1C1C1E` | Text |
| `--muted-foreground` (dim) | `#9A9A9F` | `#5F5F64` | Secondary text |
| `--primary` (signal cyan) | `#2BB3EC` | `#0B7FB8` | Primary action, focus, active |
| `--status-running` | `#4CD38E` | `#178A53` | LED: running |
| `--status-warn` | `#F0B43C` | `#A86A12` | LED: starting, stopping |
| `--status-error` | `#EF5A52` | `#C9372F` | LED: failed, destructive |
| `--status-offline` | `#626267` | `#909095` | LED: offline |

## Type

| Role | Face | Notes |
|---|---|---|
| Display | **Barlow Semi Condensed** 600 | Page titles, section titles, unit names (server, node), the brand. Condensed like chassis legends. Sentence case. |
| Body / UI | **IBM Plex Sans** 400/500/600 | Everything else. 14px base. Tabular figures for numbers. |
| Data | **IBM Plex Mono** | Only for real machine text: console output, addresses, file paths, code, IDs. Never for labels. |

Scale (minor third): 12 · 13 · 14 · 16 · 20 · 25 · 31px. Body line height 1.55; display 1.15.

Banned: ALL-CAPS tracked labels, small monospace labels, accenting one word of a heading, labels above every section that repeat the heading.

## Shape and depth

Corners are small and **vary by role**, so hierarchy is visible:

| Element | Radius |
|---|---|
| Inputs, buttons, chips | 3px (`rounded-md`) |
| Panels, table frames | 4px (`rounded-lg`) |
| Menus, popovers, modals | 6px (`rounded-xl`) |
| LEDs, avatars, toggles | full circle |

No continuous "squircle" corners. No drop shadows on anything that sits in the page; only floating layers (menus, modals, toasts) get one shadow, defined once as `--shadow-float`. Separation comes from seams (borders) and the well/chassis contrast.

## Layout grammar

Three containers, no more. Pick by what the content is:

1. **Rack** (`<Rack>` / `<RackRow>`): a list of units of the same kind. Full-width rows separated by seams, inside one frame. Servers, nodes, users, backups, schedules, API keys. **Never a grid of cards.**
2. **Readout strip** (`<Readout>`): a few live numbers about one thing. One well, cells divided by vertical seams, like an instrument cluster. Never one card per number.
3. **Panel** (`<Card>`): a form or a block of settings. Used for forms only, and never more than one level deep.

Everything else is plain layout: headings, spacing, and seams. If you're about to wrap something in a box, ask which of the three it is. If none, don't box it.

Content is left-aligned. Page width: full-bleed for racks and the console; 72ch max for forms and prose.

## Motion

- Motion answers actions only: opening a menu, expanding a row, confirming a save.
- The one ambient motion is a **slow pulse on a `starting`/`stopping` LED**, because that state is genuinely changing. Respects reduced motion.
- No hover lifts, no fade-in-on-scroll, no animated gradients.

## Words

- Sentence case everywhere: "Shared with me", not "Shared with Me".
- Name things as users see them: "Servers", not "Server list".
- Buttons say what happens: "Start", "Save changes", "Create server". The toast uses the same verb: "Server created".
- No meta strings glued with middle dots. Lay values out as separate, labelled fields, or separate them with space.
- No arrows appended to link text.

## Review against the defaults (done before building)

The plan was checked against the usual generated-UI defaults, and changed where it drifted:

- **Near-black + one bright accent** was the first instinct (dark UI, cyan brand). Changed: the base is a mid graphite (not near-black) with three surface levels (rail, graphite, chassis), and cyan is restricted to actions and focus. The memorable element is the status rail, not the accent colour.
- **SaaS card kit** (what the panel had): replaced with the three-container grammar above; cards are for forms only.
- **Broadsheet hairlines and zero radius**: avoided; corners are small but present and vary by role.
- **Template chrome** (ALL-CAPS eyebrows, mono labels, `A · B · C`, `→`): banned in Words and Type.
- **Inter/Geist everywhere**: replaced with a condensed display face that has a reason to be here, and Plex for long-session legibility.

## Enforcement

`eslint.config.mjs` reports the class patterns this system bans (large radii, decorative shadows, gradients, uppercase tracked labels). Fix the code rather than disabling the rule; if a case is genuinely needed, explain it in a comment next to an `eslint-disable-next-line`.
