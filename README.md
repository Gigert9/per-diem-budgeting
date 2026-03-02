# BudgetApp (no-DB)

Small offline budgeting helper.

## What it does
- You enter a **base amount**.
- The app computes **spend per day** as:

$$\text{per_day} = \frac{\text{base}}{\text{remaining_days_in_month}}$$

Where **remaining days** includes today.

## Expenses
- You can add expenses for **today** (amount + optional note).
- Expenses do **not** change your saved base amount or the planned $/day number.
- They do update:
	- **Spent today**
	- **Remaining today** (planned per-day minus today’s spending)
	- **Spent this month**

Daily allowance behavior:
- If you **overspend** on a day, future days’ per-day allowance is **reduced** to compensate.
- If you **underspend**, future days’ per-day allowance does **not** increase (conservative mode).

## Run
From the repo root:

```powershell
py -m src.budget_app
```

(Uses only the Python standard library.)

## Build a Windows .exe
This uses PyInstaller to create a single executable you can run from your Desktop.

From the repo root:

```powershell
./build_exe.ps1
```

The exe will be created at:
- `dist\BudgetApp.exe`

The exe icon is set from:
- `Resources\\BA_Logo_Final.ico`

The build script generates a multi-size `.ico` from it at:
- `build\\BudgetApp.ico`

Notes:
- The app still stores its data in `%APPDATA%\BudgetApp\budgetapp.json`.
- If Windows SmartScreen warns about an unknown publisher, that’s normal for a locally-built unsigned exe.

## Mobile-friendly PWA (optional)
There is also a small web/PWA version under `web/` intended for iOS/Android.

It stores data locally in the browser (no server, no database) and supports:
- Install button (Android prompts install; iOS shows Add-to-Home-Screen steps)
- Offline use after the first load
- Update check on open (reloads once to apply updates)

### Run locally
From `web/`:

```powershell
npm install
npm run dev
```

### Build for static hosting
From `web/`:

```powershell
npm run build
```

Output is in `web\dist\`.

## Data storage (no database)
Settings are stored locally in a JSON file:
- Windows: `%APPDATA%\BudgetApp\budgetapp.json`
- Fallback: `~/.config/BudgetApp/budgetapp.json`

The file is created automatically on first run.
