from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta


@dataclass
class Expense:
    date: str  # ISO: YYYY-MM-DD
    amount: float
    note: str = ""


@dataclass
class RecurringExpense:
    id: str
    amount: float
    day: int   # day of month (1–31) when the expense occurs
    note: str = ""


@dataclass
class DeletedExpense:
    date: str
    amount: float
    note: str
    deleted_at: str  # ISO datetime string, used for 24h pruning


@dataclass
class MonthSummary:
    base: float
    spent: float
    saved: float


@dataclass
class BudgetState:
    base_amount: float = 0.0
    expenses: list[Expense] = field(default_factory=list)

    # Per-month base amounts ("planned to spend") captured when the user hits Save.
    # Keys are "YYYY-MM".
    monthly_bases: dict[str, float] = field(default_factory=dict)

    # Month rollover bookkeeping.
    last_rollover_month: str = ""
    last_month_key: str = ""
    last_month_saved: float = 0.0

    # Recurring expenses pre-deducted from the monthly base.
    recurring: list[RecurringExpense] = field(default_factory=list)

    # Recently deleted expenses buffer for undo (pruned after 24h).
    recently_deleted: list[DeletedExpense] = field(default_factory=list)

    # Compact per-month summaries for historical view (up to 12 months).
    monthly_summaries: dict[str, MonthSummary] = field(default_factory=dict)

    # UI theme preference.
    theme: str = "light"


# ── Date helpers ─────────────────────────────────────────────────────────────

def compute_remaining_days_in_month(today: date | None = None) -> int:
    """Remaining days in current month including today."""
    if today is None:
        today = date.today()
    if today.month == 12:
        first_next = date(today.year + 1, 1, 1)
    else:
        first_next = date(today.year, today.month + 1, 1)
    last_this = first_next - timedelta(days=1)
    return max(1, (last_this - today).days + 1)


def compute_days_in_month(today: date | None = None) -> int:
    """Total number of days in the current month."""
    if today is None:
        today = date.today()
    if today.month == 12:
        first_next = date(today.year + 1, 1, 1)
    else:
        first_next = date(today.year, today.month + 1, 1)
    first_this = date(today.year, today.month, 1)
    return max(1, (first_next - first_this).days)


# ── Expense helpers ───────────────────────────────────────────────────────────

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


# ── Budget calculations ───────────────────────────────────────────────────────

def compute_recurring_total(recurring: list[RecurringExpense]) -> float:
    """Sum of all recurring expense amounts."""
    total = 0.0
    for r in recurring:
        try:
            total += float(r.amount)
        except (TypeError, ValueError):
            continue
    return total


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
    include_through_date: bool = False,
) -> float:
    """Sum overspending debt for prior days in the month.

    include_through_date=True includes through_date_exclusive itself (used for
    projected allowance calculation).
    """
    prefix = f"{year:04d}-{month:02d}-"
    cutoff_iso = through_date_exclusive.isoformat()
    totals_by_date: dict[str, float] = {}

    for e in expenses:
        if not isinstance(e.date, str) or not e.date.startswith(prefix):
            continue
        if include_through_date:
            if e.date > cutoff_iso:
                continue
        else:
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
    """Compute per-day allowance using a "no reward" model."""
    if days_in_month <= 0:
        days_in_month = 1
    if remaining_days_incl_today <= 0:
        remaining_days_incl_today = 1
    baseline = compute_spend_per_day(base_amount, days_in_month)
    debt = max(0.0, float(overspend_debt))
    penalty = debt / float(remaining_days_incl_today)
    return max(0.0, baseline - penalty)


def compute_projected_allowance(
    expenses: list[Expense],
    base_amount: float,
    *,
    year: int,
    month: int,
    today: date,
    days_in_month: int,
    remaining_days_incl_today: int,
) -> float:
    """Allowance for tomorrow if the user stops spending today.

    Includes today's expenses in the debt and uses remaining_days - 1 as the
    future window.
    """
    baseline_per_day = compute_spend_per_day(base_amount, days_in_month)
    debt_including_today = compute_overspend_debt_for_month(
        expenses,
        year=year,
        month=month,
        through_date_exclusive=today,
        baseline_per_day=baseline_per_day,
        include_through_date=True,
    )
    remaining_after_today = max(1, remaining_days_incl_today - 1)
    return compute_conservative_carryover_per_day(
        base_amount,
        days_in_month=days_in_month,
        remaining_days_incl_today=remaining_after_today,
        overspend_debt=debt_including_today,
    )


def compute_streak(
    expenses: list[Expense],
    year: int,
    month: int,
    today: date,
    baseline_per_day: float,
) -> int:
    """Count consecutive days from yesterday backwards where spend <= baseline."""
    prefix = f"{year:04d}-{month:02d}-"
    today_iso = today.isoformat()
    totals_by_date: dict[str, float] = {}

    for e in expenses:
        if not isinstance(e.date, str) or not e.date.startswith(prefix):
            continue
        if e.date >= today_iso:
            continue
        try:
            amt = float(e.amount)
        except (TypeError, ValueError):
            continue
        totals_by_date[e.date] = totals_by_date.get(e.date, 0.0) + amt

    streak = 0
    day = today.day - 1  # start at yesterday
    while day >= 1:
        iso = f"{year:04d}-{month:02d}-{day:02d}"
        spent = totals_by_date.get(iso, 0.0)
        if spent > baseline_per_day:
            break
        streak += 1
        day -= 1
    return streak
