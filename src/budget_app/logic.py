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


def compute_days_in_month(today: date | None = None) -> int:
    """Total number of days in the current month."""
    if today is None:
        today = date.today()

    if today.month == 12:
        first_next = date(today.year + 1, 1, 1)
    else:
        first_next = date(today.year, today.month + 1, 1)

    first_this = date(today.year, today.month, 1)
    days = (first_next - first_this).days
    return max(1, days)


def compute_spend_per_day(base_amount: float, days_in_month: int) -> float:
    if days_in_month <= 0:
        days_in_month = 1
    return base_amount / float(days_in_month)


def compute_overspend_debt_for_month(
    expenses: list[Expense],
    *,
    year: int,
    month: int,
    through_date_exclusive: date,
    baseline_per_day: float,
) -> float:
    """Sum overspending debt for prior days in the month.

    Debt is computed as:
        sum(max(0, spent_that_day - baseline_per_day))

    This intentionally does NOT let underspending "bank" credit.
    """
    prefix = f"{year:04d}-{month:02d}-"
    cutoff_iso = through_date_exclusive.isoformat()
    totals_by_date: dict[str, float] = {}

    for e in expenses:
        if not isinstance(e.date, str) or not e.date.startswith(prefix):
            continue
        if e.date >= cutoff_iso:
            continue
        try:
            amt = float(e.amount)
        except (TypeError, ValueError):
            continue
        totals_by_date[e.date] = totals_by_date.get(e.date, 0.0) + amt

    debt = 0.0
    for total in totals_by_date.values():
        overspend = total - float(baseline_per_day)
        if overspend > 0:
            debt += overspend
    return debt


def compute_conservative_carryover_per_day(
    base_amount: float,
    *,
    days_in_month: int,
    remaining_days_incl_today: int,
    overspend_debt: float,
) -> float:
    """Compute per-day allowance using a "no reward" model.

    - Baseline (static): base_amount / days_in_month
    - Underspending does not increase future allowance.
    - Overspending creates a debt that reduces future allowance.

    The overspend debt should exclude today's expenses; it represents how much
    the user exceeded the baseline on prior days.
    """
    if days_in_month <= 0:
        days_in_month = 1
    if remaining_days_incl_today <= 0:
        remaining_days_incl_today = 1

    baseline = compute_spend_per_day(base_amount, days_in_month)
    debt = float(overspend_debt)
    if debt < 0:
        debt = 0.0

    penalty = debt / float(remaining_days_incl_today)
    allowed = baseline - penalty
    if allowed < 0:
        allowed = 0.0
    return allowed


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
