from __future__ import annotations

import json
import os
from dataclasses import asdict
from datetime import date, datetime, timezone
from pathlib import Path

from .logic import (
    BudgetState,
    DeletedExpense,
    Expense,
    MonthSummary,
    RecurringExpense,
    expenses_for_month,
    sum_expenses,
)


def _data_path() -> Path:
    appdata = os.environ.get("APPDATA")
    if appdata:
        base_dir = Path(appdata) / "BudgetApp"
    else:
        base_dir = Path.home() / ".config" / "BudgetApp"
    base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir / "budgetapp.json"


def data_path() -> Path:
    return _data_path()


def ensure_state_file(state: BudgetState | None = None) -> bool:
    path = _data_path()
    if path.exists():
        return False
    if state is None:
        state = BudgetState()
    try:
        path.write_text(json.dumps(_state_to_dict(state), indent=2), encoding="utf-8")
    except OSError:
        return False
    return True


def _state_to_dict(state: BudgetState) -> dict:
    """Convert BudgetState to a JSON-serialisable dict."""
    d = asdict(state)
    # monthly_summaries values are dicts (from asdict on MonthSummary dataclass)
    return d


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
    for item in raw.get("expenses", []):
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

    monthly_bases: dict[str, float] = {}
    for k, v in raw.get("monthly_bases", {}).items():
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

    recurring: list[RecurringExpense] = []
    for item in raw.get("recurring", []):
        if not isinstance(item, dict):
            continue
        rid = item.get("id")
        if not isinstance(rid, str) or not rid:
            import uuid
            rid = str(uuid.uuid4())
        try:
            r_amount = float(item.get("amount", 0))
            r_day = int(item.get("day", 0))
        except (TypeError, ValueError):
            continue
        if r_amount <= 0 or r_day < 1 or r_day > 31:
            continue
        r_note = item.get("note", "")
        if not isinstance(r_note, str):
            r_note = ""
        recurring.append(RecurringExpense(id=rid, amount=r_amount, day=r_day, note=r_note))

    recently_deleted: list[DeletedExpense] = []
    cutoff = _utc_now_iso()
    for item in raw.get("recently_deleted", []):
        if not isinstance(item, dict):
            continue
        deleted_at = item.get("deleted_at", "")
        if not isinstance(deleted_at, str) or not deleted_at:
            continue
        # Prune items older than 24 hours
        if not _within_24h(deleted_at, cutoff):
            continue
        d_date = item.get("date", "")
        d_amount = item.get("amount", 0)
        d_note = item.get("note", "")
        if not isinstance(d_date, str):
            continue
        try:
            d_amount_f = float(d_amount)
        except (TypeError, ValueError):
            continue
        recently_deleted.append(DeletedExpense(
            date=d_date, amount=d_amount_f,
            note=str(d_note) if not isinstance(d_note, str) else d_note,
            deleted_at=deleted_at,
        ))

    monthly_summaries: dict[str, MonthSummary] = {}
    for k, v in raw.get("monthly_summaries", {}).items():
        if not isinstance(k, str) or not isinstance(v, dict):
            continue
        try:
            ms = MonthSummary(
                base=float(v.get("base", 0)),
                spent=float(v.get("spent", 0)),
                saved=float(v.get("saved", 0)),
            )
            monthly_summaries[k] = ms
        except (TypeError, ValueError):
            continue

    theme = raw.get("theme", "light")
    if theme not in ("light", "dark"):
        theme = "light"

    return BudgetState(
        base_amount=base_amount,
        expenses=expenses,
        monthly_bases=monthly_bases,
        last_rollover_month=last_rollover_month,
        last_month_key=last_month_key,
        last_month_saved=last_month_saved,
        recurring=recurring,
        recently_deleted=recently_deleted,
        monthly_summaries=monthly_summaries,
        theme=theme,
    )


def _utc_now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _within_24h(deleted_at: str, now_iso: str) -> bool:
    """Return True if deleted_at is within the last 24 hours of now_iso."""
    try:
        dt_deleted = datetime.fromisoformat(deleted_at.replace("Z", "+00:00"))
        dt_now = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
        from datetime import timedelta
        return (dt_now - dt_deleted) <= timedelta(hours=24)
    except (ValueError, TypeError):
        return False


def _month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _prev_month_key(d: date) -> str:
    if d.month == 1:
        return f"{d.year - 1:04d}-12"
    return f"{d.year:04d}-{d.month - 1:02d}"


def rollover_month_if_needed(state: BudgetState, *, today: date | None = None) -> bool:
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

    state.monthly_summaries[prev_key] = MonthSummary(
        base=float(prev_base), spent=float(prev_spent), saved=float(prev_saved)
    )

    # Keep at most 12 months of summaries
    keys = sorted(state.monthly_summaries.keys())
    for old_key in keys[:-12]:
        del state.monthly_summaries[old_key]

    return True


def save_state(state: BudgetState) -> None:
    path = _data_path()
    path.write_text(json.dumps(_state_to_dict(state), indent=2), encoding="utf-8")
