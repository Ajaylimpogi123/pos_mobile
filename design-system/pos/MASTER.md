# POS Design System — MASTER

**Status:** APPROVED by the user on 2026-10-07. It replaces Sage Emerald (2026-09-30).
**Applies to:** the web POS and back-office (`web/`) **and** the tablet app (`mobile/`).
**Visual reference:** canvas https://claude.ai/artifact/2CQHv3ZNFbAeaiWmWhQGGD. It has four boards: Web POS (Sell), Web Order History, Web Dashboard, and Tablet POS.
**Source of the look:** the legacy app `C:\xampp\htdocs\pos`, which uses shadcn/ui "new-york" with the neutral base and Figtree. This spec keeps that look. It darkens the legacy colours that fail WCAG AA, and it adds the modules and features of this system.

**How to use this file:** read it before building or restyling any screen. When a page file exists in `pages/`, its rules override this one for that page. Guidance searches go through the project skill `ui-ux-pro-max`, run as `C:\laragon\bin\python\python-3.10\python.exe .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain ux` or with `--stack shadcn`. Search results are advice. This file wins.

---

## 1. Tokens

Every colour, radius, shadow and font comes from these tokens. Components never hard-code a hex value.

- **web:** CSS variables in `web/src/styles/theme.css`, mapped to Tailwind (shadcn's variable names where they exist).
- **tablet:** `mobile/src/constants/theme.ts`.

### 1.1 Neutral (shadcn neutral base)

| Token        | Hex       | Use                                                                                                 |
| ------------ | --------- | --------------------------------------------------------------------------------------------------- |
| `sidebar`    | `#FAFAFA` | App background behind the sidebar and the inset panel                                               |
| `inset`      | `#F7F7F7` | The inset content panel (shadcn `muted`)                                                            |
| `card`       | `#FFFFFF` | Cards, inputs, popovers                                                                             |
| `text`       | `#252525` | Body text (shadcn `foreground`)                                                                     |
| `primary`    | `#343434` | Dark neutral buttons such as "New sale", and the active tab                                         |
| `on-primary` | `#FAFAFA` | Text on `primary`                                                                                   |
| `muted-text` | `#6B6B6B` | Secondary text. **Changed:** legacy `#8E8E8E` was 3.3:1                                             |
| `border`     | `#EBEBEB` | Every hairline, input border and table rule                                                         |
| `accent`     | `#EFEFEF` | Hover background, active sidebar item, avatar tile                                                  |
| `subtle`     | `#F9FAFB` | Summary boxes (the cart totals)                                                                     |
| `ring`       | `#15803D` | Focus ring: 2 px, offset 2 px, on **every** interactive element (5.0:1; legacy `#22C55E` was 2.3:1) |

### 1.2 Brand green (actions, money, active state)

| Token         | Hex                                                              | Use                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `green`       | `#15803D`                                                        | Primary actions ("+ Add", Checkout, Save), prices, money totals, positive figures. **Changed:** legacy `green-600 #16A34A` was 3.3:1 with white text; this is 5.0:1 |
| `green-hover` | `#166534`                                                        | Hover and pressed state                                                                                                                                             |
| `green-soft`  | `#F0FDF4`                                                        | Bottom of the active category tile gradient, success tint                                                                                                           |
| `green-line`  | `#16A34A`                                                        | The 4 px bottom border of the active category tile and hover borders (3.3:1; legacy `green-500` was 2.3:1)                                                          |
| `green-chip`  | `#BBF7D0`                                                        | The active category icon circle                                                                                                                                     |
| `band`        | `linear-gradient(135deg, #047857 0%, #6EE7B7 55%, #4ADE80 100%)` | The decorative header band (§2.3)                                                                                                                                   |

### 1.3 Status (badge = tinted background + border + dot + word)

| Status                        | Text / dot | Background | Border    | Meaning                    |
| ----------------------------- | ---------- | ---------- | --------- | -------------------------- |
| Completed / OK / In stock     | `#15803D`  | `#F0FDF4`  | `#BBF7D0` | Done, healthy              |
| Needs review / Low / Pending  | `#B45309`  | `#FFFBEB`  | `#FDE68A` | Needs attention            |
| Voided / Out / Failed / Error | `#B91C1C`  | `#FEF2F2`  | `#FECACA` | Stopped, destructive       |
| Refunded / Processing / Info  | `#1D4ED8`  | `#EFF6FF`  | `#BFDBFE` | Informational, in progress |

Every pair is at least 4.5:1. Status is never shown by colour alone: a badge always has the dot **and** the word.

### 1.4 Stat-card accents (from the legacy dashboard)

Each stat card's figure uses one of these. They are for figures only, never for actions.
| Accent | Hex | Tint (icon square) |
|---|---|---|
| Sales | `#15803D` | `#F0FDF4` |
| Orders | `#2563EB` | `#EFF6FF` |
| Average / trend | `#9333EA` | `#FAF5FF` |
| Stock / refunds | `#C2410C` | `#FFF7ED` |

`#C2410C` replaces the legacy `orange-600`, which was 3.6:1.

**Chart series**, in this order and never cycled: `#15803D` (green), `#2563EB` (blue), `#D97706` (amber). Area fills use the series colour at 18 % opacity.

**Destructive actions** use `#DC2626` (text and outline) and `#B91C1C` for a filled button.

### 1.5 Type

- **Font:** **Figtree**, weights 400/500/600/700/800.
    - web: Google Fonts `<link>`, `font-display: swap`.
    - tablet: `@expo-google-fonts/figtree`, with `fontFamily` set per weight. Plus Jakarta Sans is retired.
- **Numbers:** all money, quantities and counts use `font-variant-numeric: tabular-nums` (RN: `fontVariant: ['tabular-nums']`) so columns line up.
- **Scale:**

    | Use                    | Size / weight               |
    | ---------------------- | --------------------------- |
    | Body                   | 15 (web), 16 (tablet) / 400 |
    | Secondary              | 13–14 / 400                 |
    | Labels and buttons     | 14–15 / 500–600             |
    | Card title             | 16–20 / 600–700             |
    | Page title on the band | 26 / 700                    |
    | Money total            | 18–32 / 700                 |

    Nothing is smaller than 12.

### 1.6 Shape and depth

- **Radius:**
    - 12 px for cards, the inset panel and summary boxes
    - 8 px for inputs, tiles, outline buttons and table badges (6 px)
    - **fully round (999 px)** for primary pill buttons ("+ Add", Checkout) and the steppers
- **Shadows:**
    - cards: `0 1px 2px rgba(0,0,0,.05)`
    - the inset panel: `0 1px 3px rgba(0,0,0,.08)`
    - the active category tile: `0 4px 8px rgba(0,0,0,.08)`

    Nothing heavier.

- **Spacing:** a 4 px base. Card padding is 14–20, page padding 24 (web) or 16 (tablet), grid gaps 12–16.

### 1.7 Motion

150–200 ms ease-out on hover, press and tab changes. A press scales to 0.98, as in legacy. Honour `prefers-reduced-motion` and the RN reduce-motion setting by dropping scale and transitions. Nothing animates layout size.

---

## 2. Layout

### 2.1 App shell (web)

This is the shadcn **inset sidebar**:

- **Sidebar:** 256 px, `sidebar` background, collapsible to icons.
    - Header: the **logo**, `public/images/logo/tiumay.png` (Mama Bing's Fried Chicken), 64 px and round, centred.
    - Below the logo: a dark `primary` **New sale** button.
    - Navigation: 36 px items with a 16 px lucide icon and a label.
    - Footer: the user tile (initials, name, role and terminal).
- **Inset panel:**
    - 8 px margin, 12 px radius, `inset` background.
    - Header bar: 48 px with a bottom border, holding the sidebar toggle, a vertical separator, the page title (16/500) and optional right-aligned status text.
- **Nav groups and order:**
    - (no heading) Dashboard, POS, Order History, Shifts
    - **Catalogue:** Products, Categories, Ingredients
    - **Stock:** Inventory, Purchasing, Suppliers
    - **People & reports:** Customers, Staff, Reports, Printers & settings

    Items the user lacks permission for are hidden. All items are defined once in `web/src/constants/modules.ts`.

- **Below 1024 px:** the sidebar becomes an off-canvas drawer. Below 768 px, toolbars wrap and tables scroll inside their card.

### 2.2 App shell (tablet)

- The sidebar is collapsed to a **64 px icon rail**: logo, icons with labels for screen readers, user tile at the bottom.
- The inset panel and its 48 px header follow §2.1. The header also shows the sync state: a dot plus "Online · synced", "Offline · 3 pending" and so on, and it is always visible.
- Rotation re-lays out in place. Layout decisions come only from `useResponsive()`.

### 2.3 The header band

- A **decorative** `band` gradient, absolutely positioned at the top of the content area: 280 px tall on web, 200 px on tablet, 6 px radius. Content cards overlap it.
- It is `aria-hidden` and never carries meaning.
- White text is allowed **only over its left, darker part** (page title, the "Search" label, subtitles), and only at 14 px/600 or larger. Everything else sits on white cards.
- The band appears on POS, Order History, Dashboard and the main list pages. Forms and detail pages have no band.

---

## 3. Components

| Component               | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primary pill button** | `green` fill, white 15–16/600 text, fully round. Height 40 (card action), 48 (web Checkout) or 52 (tablet Checkout). The disabled state is `#E5E7EB` with `#4B5563` text and the reason in the label ("Out of Stock")                                                                                                                                                                                                                                                                                     |
| **Dark button**         | `primary` fill, `on-primary` text, 8 px radius, 36 px tall ("New sale")                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Outline button**      | White, 1 px `border`, 8 px radius, 36 px tall (44 on tablet), 14/500, `accent` on hover                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Search**              | A white input joined to an outline **Search** button (legacy button-group). It has a visible label (white on the band). `/` focuses it on web                                                                                                                                                                                                                                                                                                                                                             |
| **Category tile**       | Legacy tab tiles, 136 px wide (112 on tablet). **Inactive:** gradient `#F3F4F6`→`#F9FAFB` with a 4 px `#D1D5DB` **top** border. **Active:** gradient white→`green-soft`, a 4 px `green-line` **bottom** border and a shadow. Contents: an icon in a 40 px circle (`green-chip` when active), the name (15/500) and the count ("4 items", 12, `#4B5563`). They sit in a white card and use `role="tab"`                                                                                                    |
| **Product card**        | White card with 14 px padding. Contents: a square image (or a `#F3F4F6` placeholder with a utensils icon), a stock badge top-right (Low or Out), the name (16/700, `#374151`), the price (16/700, `green`), a round − / quantity / + stepper, and a full-width pill **+ Add (n)** button. On tablet the stepper is dropped: tapping **+ Add** adds one, and quantity is changed in the cart                                                                                                               |
| **Current Order card**  | White card, sticky on web and always visible on tablet. From top to bottom: header "Current Order" (20/700) with an "n items" neutral badge; Table and Customer outline buttons; line boxes (8 px radius, border) holding the name, a note or unit price, × remove, the unit price in green, a round stepper and the line total in green; a `subtle` summary box with Subtotal, a red **Discount** row (SC/PWD and Amount buttons) and a bordered **Total** in green; then the **Checkout (₱total)** pill |
| **Stat card**           | White card, 20 px padding. A 36 px icon square in the accent tint, an optional trend badge (outline, ▲/▼ plus text, green or red), a label in `muted-text`, the value at 24–26/700 in the accent colour, and a one-line footnote                                                                                                                                                                                                                                                                          |
| **Data table**          | shadcn Table plus TanStack DataTable inside a white card. The toolbar holds segmented status tabs (a `#F5F5F5` track with a white active tab) and a search box. Header cells are 40 px tall, `muted-text`, 500. Rows have 12 px padding, a `border` rule and `#FAFAFA` on hover. Numbers are right-aligned and tabular. A row-actions (⋯) button with an `aria-label` ends each row. "Showing n of N" and **Load more** (cursor) sit at the bottom. Wide tables scroll inside the card                    |
| **Status badge**        | §1.3: 24 px tall, 6 px radius, 1 px border, 6 px dot, 12/600 word                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Charts**              | Recharts on web and the existing `src/components/charts/*` on tablet. Series follow §1.4, with one y-axis, a legend for 2+ series, tooltips, and a **View as table** toggle. The empty state uses real data only                                                                                                                                                                                                                                                                                          |
| **Dialogs**             | shadcn Dialog: white, 12–16 px radius, `rgba(0,0,0,.5)` backdrop, focus trapped, `Esc` closes. Confirmations of destructive actions name the action ("Void order") and use the destructive colour                                                                                                                                                                                                                                                                                                         |
| **Toasts**              | shadcn Sonner, bottom-right on web and top on tablet. Success, error and info carry an icon plus text                                                                                                                                                                                                                                                                                                                                                                                                     |

---

## 4. Interaction and accessibility (from ui-ux-pro-max, priorities 1–2)

- **Contrast:** text is at least 4.5:1, large text (24 px, or 19 px bold) at least 3:1, and UI parts at least 3:1. Every token pair above has been checked.
- **Focus:** a visible ring on every control, never hidden behind sticky headers (use `scroll-padding-top` set to the header height).
- **Targets:** at least 44×44 on web and 48×48 on tablet for primary actions, with 8 px or more between them.
- **Labels:**
    - Every input has a visible label, or an `aria-label` when its purpose is shown visually (search).
    - Icon-only buttons have an `aria-label`.
    - Decorative icons and the band are `aria-hidden`.
- **Forms:** each 422 message sits under its field (`aria-describedby`). After a failed submit, a focusable error summary at the top links to the fields. Submit is disabled while in flight.
- **Feedback:** use skeletons for first loads, `aria-busy`, and no flashing spinners for quick work. Every list has loading, empty, error-with-Retry and Load-more states.
- **Keyboard (web cashier):**
    - `/` focuses search
    - `Enter` adds the highlighted product
    - `F2` opens Checkout
    - `Esc` closes dialogs

    Shortcuts are shown as `kbd` hints.

- **No emoji as icons.** Icons are lucide on web (`lucide-react`) and the same glyph set on tablet (`lucide-react-native`, or the closest Ionicons equivalent until it is added).

## 5. Pre-delivery checklist

- [ ] Only tokens: no raw hex in components
- [ ] Figtree loaded; numbers tabular
- [ ] Focus ring visible on every control; Tab order follows the visual order
- [ ] Contrast checked for any new pair
- [ ] Loading / empty / error / load-more states present
- [ ] 422 errors under fields; 401 → login
- [ ] Works at 1440, 1280, 1024 and 768 (web); tablet portrait and landscape; no horizontal page scroll
- [ ] `prefers-reduced-motion` respected
- [ ] Band is decorative only; white text only on its dark side

---

## 6. Clarifications (2026-10-13, from the platform-parity audit)

These settle points the spec left open. They win over §1–§5 and the page files where they differ.

- **Out of stock on Sell (user decision):** the red "Out of stock" badge is advisory. The product stays tappable on both platforms. Online, the server's `422` blocks the sale with its message; offline, it always sells (PROJECT_MEMORY §11 #7). There is no disabled "Out of Stock" button. "Unavailable" products (`is_available: false`) are the only disabled state: a red "Unavailable" badge and a disabled **Unavailable** button. "Check stock" (recipe) is an amber badge and stays sellable.
- **Tablet lists (user decision):** back-office lists show the §3 data-table card in **landscape**, and cards in **portrait and on phones**. Both have the same status tabs, search, "Showing n" and **Load more**.
- **Navigation:** both apps keep their extra modules inside the §2.1 groups, in this order:
  - (no heading): Dashboard, POS, Order History, Needs review, Shifts, Tables (only when dine-in is on)
  - **Catalogue:** Products, Categories, Ingredients, Units
  - **Stock:** Inventory, Purchasing (requests, orders, receiving), Suppliers
  - **People & reports:** Customers, Staff, Roles, Reports
  - **Settings:** Printers & settings, This terminal / This tablet, Devices, Error log, Sync queue (tablet)
  - The tablet rail is 64 px; on a tablet in landscape it may open the full 256 px panel as an overlay. A dark, icon-only **New sale** button sits under the logo in the rail.
- **Search:** list searches filter as you type, debounced, and need no joined Search button. Only Sell keeps the input-plus-button group. On web, `/` focuses the page's search on every list page.
- **"Showing n of N":** cursor lists have no total, so the footer reads "Showing n". It reads "Showing n of N" only where the API returns a total.
- **Tags vs status:** a badge that shows a **state** (§1.3) always has the dot and the word. A **tag** that isn't a state (stock mode, SC/PWD, "Default kitchen", "PIN set", role facts) is a neutral or outline badge with no dot and no status tint. Both are 24 px tall.
- **Band:** it also appears on Reports, Roles, Units, Devices, Error log and Tables (they are list pages). Its subtitle is the branch and business date, and the text block is capped at half the band width so white text stays on the dark side. On tablets with less than 600 px of height, the band shrinks to 120 px.
- **Targets:** §3's 36 px visual heights stand. Icon-only buttons, steppers, row ⋯ buttons, cart controls and dialog close buttons get a 44 px (web) or 48 px (tablet) hit area, through padding or a hit slop.
- **Header (tablet):** 48 px tall on tablets, 56 px on phones. Its icon controls may be 44 px with a hit slop to 48.
- **Toasts:** save success, "Sent to kitchen", "Sent" (a print job reached the printer; never "Printed", as the printer gives no confirmation) and "Copied" are toasts. Errors that need action (print failed with Retry, 409 conflicts, offline) stay as banners or dialogs.
- **Detail views:** detail pages that hold forms or many actions (Inventory and Ingredient stock detail, purchase requests and orders, Receive) stay full pages. Read-mostly details (orders, shifts, devices, errors) use the right sheet at ≥1280 px on web.
- **Exempt:** printed paper documents (PR/PO PDFs, receipts) are outside the 12 px minimum. Forms with wide line-item tables (purchase request, Receive, PO detail) may be wider than 720 px. Login keeps its own layout: the band as decoration, the logo, and a white card.
- **Extra button variants:** the tablet's `tonal` becomes the outline button and `ghost` becomes a quiet text button (`green` text, no fill). No new variants.
