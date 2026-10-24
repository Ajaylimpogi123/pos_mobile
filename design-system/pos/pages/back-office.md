# Page override: back-office lists and the dashboard

These rules override MASTER for Order History, every admin list (products, categories, ingredients, inventory, purchasing, suppliers, customers, staff, shifts, printers) and the Dashboard. Canvas boards: "Web · Order History" and "Web · Dashboard".

## List pages
1. The band carries the page title (26/700, white) and a white subtitle (branch and business date), with the page actions on the right as outline buttons: date picker, **Export CSV**, and **Add …** (green pill) where the user may create.
2. **Optional:** a row of 4 stat cards overlapping the band. Use it only when the endpoint returns those figures; never compute money on the client.
3. **The data table card:** status tabs, then search, then the table, then "Showing n of N" and **Load more**.
   - Cursor pagination only.
   - Sorting and filtering go through query parameters the contract defines. Never fetch everything and filter on the client.
4. A row click, or Enter on a focused row, opens the detail as a right **sheet** on web (≥1280 px) or a full page below that. Destructive actions sit in the row ⋯ menu and confirm in a dialog.

## Forms (create and edit)
- No band. Use a white card at most 720 px wide, with grouped sections and a visible label above every field.
- Money inputs show "₱" as a prefix and are converted to centavos on submit.
- The sticky footer holds **Cancel** (outline) and **Save** (green pill).

## Dashboard
- The band carries the greeting ("Good afternoon, {first name}") and the branch and date.
- Stat cards: Net sales (green), Orders (blue), Average ticket (purple), and Low or out of stock (orange). The trend badge shows only when the API gives the comparison.
- Then **Net sales, last 7 days** (area, green; from `sales.last_7_days`, Q-041), **Top products** (horizontal bars), **Payment methods** (one stacked bar plus a legend with amounts and percentages), and **Stock alerts** (Low and Out badges, plus an "Open inventory" link).
- Sections the user's permissions hide are left out, never shown empty. Use real data only.
