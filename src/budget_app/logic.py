from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta


@dataclass
class Expense:
    date: str  # ISO: YYYY-MM-DD
    amount: float
    note: str = ""


@dataclass
class BudgetState:
    base_amount: float = 0.0
    expenses: list[Expense] = field(default_factory=list)

    # Per-month base amounts ("planned to spend") captured when the user hits Save.
    # Keys are "YYYY-MM".
    monthly_bases: dict[str, float] = field(default_factory=dict)

    # Month rollover bookkeeping.
    last_rollover_month: str = ""  # "YYYY-MM" of last rollover check
    last_month_key: str = ""  # "YYYY-MM" that last_month_saved applies to
    last_month_saved: float = 0.0


def compute_remaining_days_in_month(today: date | None = None) -> int:
    """Remaining days in current month including today."""
    if today is None:
        today = date.today()

    # first day of next month
    if today.month == 12:
        first_next = date(today.year + 1, 1, 1)
    else:
        first_next = date(today.year, today.month + 1, 1)

    last_this = first_next - timedelta(days=1)
    remaining = (last_this - today).days + 1
    return max(1, remaining)


def compute_spend_per_day(base_amount: float, remaining_days: int) -> float:
    if remaining_days <= 0:
        remaining_days = 1
    return base_amount / float(remaining_days)


def compute_conservative_carryover_per_day(
    base_amount: float, remaining_days: int, spent_so_far_this_month: float
) -> float:
    """Compute daily allowance with conservative carryover.

    - Never increases above the baseline per-day (underspend does not reward).
    - Decreases when prior spending implies a deficit (overspend penalizes).

    Callers should typically pass *month spend excluding today's expenses* so the
    penalty applies to future days, not retroactively to today.
    """
    if remaining_days <= 0:
        remaining_days = 1

    baseline = compute_spend_per_day(base_amount, remaining_days)

    remaining_budget = float(base_amount) - float(spent_so_far_this_month)
    fair = remaining_budget / float(remaining_days)
    if fair < 0:
        fair = 0.0

    return min(baseline, fair)


def expenses_for_date(expenses: list[Expense], target: date) -> list[Expense]:
    target_iso = target.isoformat()
    return [e for e in expenses if e.date == target_iso]


def expenses_for_month(expenses: list[Expense], year: int, month: int) -> list[Expense]:
    prefix = f"{year:04d}-{month:02d}-"
    return [e for e in expenses if isinstance(e.date, str) and e.date.startswith(prefix)]


def sum_expenses(expenses: list[Expense]) -> float:
    total = 0.0
    for e in expenses:
        try:
            total += float(e.amount)
        except (TypeError, ValueError):
            continue
    return total
