# Page override: POS (Sell)

These rules override MASTER for the selling screen. Canvas boards: "Web · POS (Sell)" and "Tablet · POS (landscape)".

## Layout
- **Web:** inset shell with the band. Content is a two-column wrap: the menu (`flex: 2 1 600px`) and the Current Order card (`flex: 1 1 340px`, max 440, sticky at 8 px). Below about 1000 px the order card moves under the menu, with a sticky bottom bar showing the total and **Checkout**.
- **Tablet landscape:** icon rail, then the menu, then the Current Order card fixed at 360 px. **The cart is never hidden.**
- **Tablet portrait:** the menu sits above the cart, and a pinned bottom bar shows "n items · ₱total · Checkout".

## Menu column (top to bottom)
1. **Search:** "Search" label in white on the band, then the input-plus-button group.
2. **Category tiles** in a white card, starting with "All · n". A horizontal scroll is allowed here only.
3. **Product grid:**
   - web: `repeat(auto-fill, minmax(190px, 1fr))`, gap 16
   - tablet: 4 columns in landscape and 3 in portrait, gap 12

## Product card states
- **Normal:** green **+ Add (n)**.
- **Low stock:** an amber "Low stock" badge on the image; still sellable.
- **Out of stock or unavailable:** a red "Out of stock" badge and a disabled **Out of Stock** button. Offline sales are never blocked by stock (PROJECT_MEMORY §11 #7); the badge is advisory there.
- Adding gives instant feedback: the button briefly reads "Added ✓", and the cart line highlights for 600 ms.

## Current Order card
- Lines are shown newest first. Each line has a 44 px thumbnail, its name, its note or unit price, × remove, a stepper and its line total.
- The **Discount** row opens the existing discount sheet (amount, % within the cashier's limit, manager PIN above it, SC/PWD).
- The **Total** is the client checksum. The server recomputes it. After checkout the confirmed server total is what is displayed.
- **Checkout (₱total)** opens payment (cash, GCash, split), then a success view showing the print status of each job.

## Keyboard (web)
| Key | Action |
|---|---|
| `/` | Focus search |
| `↑ ↓ ← →` | Move between products |
| `Enter` | Add the highlighted product |
| `F2` | Open Checkout |
| `Esc` | Close |
