# BudgetApp (no-DB)

Small offline budgeting helper.

## What it does

### Daily spending limit
You enter a **monthly budget**. The app computes a flat daily limit:

```
daily limit = (monthly budget − recurring expenses) / days in month
```

This number is fixed for the entire month — it does **not** drift up or down as days pass.

### No-reward model
- If you **underspend** today, the surplus disappears. Tomorrow’s limit is the same flat amount.
- If you **overspend** today, a **"Tomorrow’s daily limit"** warning appears showing a reduced limit for tomorrow and the remaining days of the month (to compensate for today’s overage). This line is hidden when you are within today’s limit.

### Recurring expenses
Add fixed monthly costs (rent, subscriptions, etc.) with a day-of-month. Their total is pre-deducted from the monthly budget before the daily limit is calculated, so recurring costs never compete with your discretionary spending.

### Today tab
- Log expenses with an optional note. Each entry updates **Spent today** and **Remaining today** live.
- Delete any expense and optionally **undo** within 24 hours.

### History tab
Add, edit, or delete expenses for any day in the **current month**. Useful for catching up on days you forgot to log.

### Streak
A streak counter shows how many consecutive days (counting back from yesterday) you stayed at or under the daily limit. Today’s spending doesn’t break the streak until tomorrow.

### Trend tab
A text chart of every day so far this month, showing spending vs the daily limit (OK / OVER), plus a **Past months** summary table (up to 12 months) with budget, spent, and saved.

### Recovery warning
If your total spending this month exceeds the full monthly budget, a warning appears: *"Monthly budget exceeded by $X — Y days left."* This is the only condition that triggers a recovery message — staying under the daily limit keeps it silent.

### Month rollover
On the first open of a new month the app automatically records last month’s result: how much of the budget was spent and how much was saved (or overspent). This feeds the **Amount saved last month** metric and the Trend history.

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

### Deploy to GitHub Pages
This repo includes a GitHub Actions workflow that builds `web/` and publishes `web/dist` to GitHub Pages.

Steps:
1. Push to GitHub.
2. In GitHub: **Settings → Pages**
3. Set **Source** to **GitHub Actions**.
4. Push any commit to `main` (or manually run the workflow).

Your site URL will be:
- `https://<your-username>.github.io/<repo-name>/`

### Install on phones
- iOS (Safari): open the Pages URL → Share → **Add to Home Screen**
- Android (Chrome): open the Pages URL → tap **Install** in the app

## Data storage (no database)
Settings are stored locally in a JSON file:
- Windows: `%APPDATA%\BudgetApp\budgetapp.json`
- Fallback: `~/.config/BudgetApp/budgetapp.json`

The file is created automatically on first run
