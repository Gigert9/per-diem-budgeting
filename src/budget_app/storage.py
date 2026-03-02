from __future__ import annotations

import json
import os
from dataclasses import asdict
from datetime import date
from pathlib import Path

from .logic import BudgetState, Expense, expenses_for_month, sum_expenses


def _data_path() -> Path:
    # Prefer %APPDATA% on Windows, fallback to ~/.config
    appdata = os.environ.get("APPDATA")
    if appdata:
        base_dir = Path(appdata) / "BudgetApp"
    else:
        base_dir = Path.home() / ".config" / "BudgetApp"
    base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir / "budgetapp.json"


def data_path() -> Path:
    """Public accessor for the app's JSON config/data file path."""
    return _data_path()


def ensure_state_file(state: BudgetState | None = None) -> bool:
    """Ensure the config/data JSON file exists.

    Returns True if it created the file.
    """
    path = _data_path()
    if path.exists():
        return False
    if state is None:
        state = BudgetState()
    try:
        payload = asdict(state)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError:
        return False
    return True


def load_state() -> BudgetState:
    path = _data_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return BudgetState()
    except (OSError, json.JSONDecodeError):
        return BudgetState()

    base_amount = raw.get("base_amount", 0.0)
    try:
        base_amount = float(base_amount)
    except (TypeError, ValueError):
        base_amount = 0.0

    expenses: list[Expense] = []
    raw_expenses = raw.get("expenses", [])
    if isinstance(raw_expenses, list):
        for item in raw_expenses:
            if not isinstance(item, dict):
                continue
            date_str = item.get("date")
            amount = item.get("amount")
            note = item.get("note", "")
            if not isinstance(date_str, str):
                continue
            try:
                amount_f = float(amount)
            except (TypeError, ValueError):
                continue
            if not isinstance(note, str):
                note = str(note)
            expenses.append(Expense(date=date_str, amount=amount_f, note=note))

    # Optional persisted fields (backward compatible).
    monthly_bases_raw = raw.get("monthly_bases", {})
    monthly_bases: dict[str, float] = {}
    if isinstance(monthly_bases_raw, dict):
        for k, v in monthly_bases_raw.items():
            if not isinstance(k, str):
                continue
            try:
                monthly_bases[k] = float(v)
            except (TypeError, ValueError):
                continue

    last_rollover_month = raw.get("last_rollover_month", "")
    if not isinstance(last_rollover_month, str):
        last_rollover_month = ""

    last_month_key = raw.get("last_month_key", "")
    if not isinstance(last_month_key, str):
        last_month_key = ""

    last_month_saved = raw.get("last_month_saved", 0.0)
    try:
        last_month_saved = float(last_month_saved)
    except (TypeError, ValueError):
        last_month_saved = 0.0

    return BudgetState(
        base_amount=base_amount,
        expenses=expenses,
        monthly_bases=monthly_bases,
        last_rollover_month=last_rollover_month,
        last_month_key=last_month_key,
        last_month_saved=last_month_saved,
    )


def _month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _prev_month_key(d: date) -> str:
    if d.month == 1:
        return f"{d.year - 1:04d}-12"
    return f"{d.year:04d}-{d.month - 1:02d}"


def rollover_month_if_needed(state: BudgetState, *, today: date | None = None) -> bool:
    """Compute and persist "amount saved last month" once per calendar month.

    Returns True if state was modified.
    """
    if today is None:
        today = date.today()

    current_key = _month_key(today)
    if state.last_rollover_month == current_key:
        return False

    prev_key = _prev_month_key(today)
    prev_year = int(prev_key[0:4])
    prev_month = int(prev_key[5:7])

    prev_spent = sum_expenses(expenses_for_month(state.expenses, prev_year, prev_month))
    prev_base = state.monthly_bases.get(prev_key, state.base_amount)
    prev_saved = float(prev_base) - float(prev_spent)

    state.last_month_key = prev_key
    state.last_month_saved = prev_saved
    state.last_rollover_month = current_key
    return True


def save_state(state: BudgetState) -> None:
    path = _data_path()
    payload = asdict(state)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
