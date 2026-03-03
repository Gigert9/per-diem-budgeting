import type { BudgetState, Expense } from './types'

export function todayIso(): string {
  // Use local date (not UTC) to match Python's date.today() and user expectations.
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function monthKeyFromIso(isoDate: string): string {
  return isoDate.slice(0, 7)
}

export function currentMonthKey(): string {
  return monthKeyFromIso(todayIso())
}

export function prevMonthKey(monthKey: string): string {
  const year = Number(monthKey.slice(0, 4))
  const month = Number(monthKey.slice(5, 7))
  if (month === 1) return `${String(year - 1).padStart(4, '0')}-12`
  return `${String(year).padStart(4, '0')}-${String(month - 1).padStart(2, '0')}`
}

export function computeRemainingDaysInMonth(fromIso: string): number {
  // IMPORTANT: do not use millisecond diffs across calendar dates.
  // DST transitions (e.g. March) can make a "day" be 23/25 hours and
  // produce off-by-one results. Use pure calendar math instead.
  const [y, m, d] = fromIso.split('-').map(Number)
  const daysInMonth = computeDaysInMonth(fromIso)
  const remaining = daysInMonth - d + 1
  return Math.max(1, remaining)
}

export function computeDaysInMonth(fromIso: string): number {
  const [y, m] = fromIso.split('-').map(Number)
  // Use UTC so local DST offset changes cannot affect the result.
  // JS months are 0-based; day 0 gives the last day of the previous month.
  const lastDayUtc = new Date(Date.UTC(y, m, 0))
  return lastDayUtc.getUTCDate()
}

export function sumExpenses(expenses: Expense[]): number {
  return expenses.reduce((acc, e) => acc + (Number.isFinite(e.amount) ? e.amount : 0), 0)
}

export function expensesForDate(expenses: Expense[], isoDate: string): Expense[] {
  return expenses.filter((e) => e.date === isoDate)
}

export function expensesForMonth(expenses: Expense[], monthKey: string): Expense[] {
  const prefix = `${monthKey}-`
  return expenses.filter((e) => typeof e.date === 'string' && e.date.startsWith(prefix))
}

export function computeSpendPerDay(baseAmount: number, daysInMonth: number): number {
  const days = daysInMonth <= 0 ? 1 : daysInMonth
  return baseAmount / days
}

export function computeNoRewardSpendPerDay(
  baseAmount: number,
  daysInMonth: number,
  remainingDaysInclToday: number,
  overspendDebt: number
): number {
  // "No reward" model:
  // - Daily target is static: base / days_in_month.
  // - Underspending does NOT increase future per-day allowance.
  // - Overspending creates a debt that reduces future per-day allowance.
  const baseline = computeSpendPerDay(baseAmount, daysInMonth)
  const days = remainingDaysInclToday <= 0 ? 1 : remainingDaysInclToday
  const debt = Math.max(0, overspendDebt)
  const penalty = debt / days
  return Math.max(0, baseline - penalty)
}

export function computeOverspendDebt(
  expenses: Expense[],
  monthKey: string,
  nowIso: string,
  baselinePerDay: number
): number {
  // Overspend debt is the sum of (spent_that_day - baseline)+ for prior days.
  // This intentionally does NOT let underspending "bank" credit.
  const monthExpenses = expensesForMonth(expenses, monthKey)
  const totalsByDate: Record<string, number> = {}
  for (const e of monthExpenses) {
    if (typeof e.date !== 'string') continue
    // ISO date strings compare lexicographically.
    if (e.date >= nowIso) continue // exclude today + any future dated items
    const amt = Number.isFinite(e.amount) ? e.amount : 0
    totalsByDate[e.date] = (totalsByDate[e.date] ?? 0) + amt
  }

  let debt = 0
  for (const total of Object.values(totalsByDate)) {
    const overspend = total - baselinePerDay
    if (overspend > 0) debt += overspend
  }
  return debt
}

export function normalizeState(raw: unknown): BudgetState {
  const obj = (raw && typeof raw === 'object') ? (raw as any) : {}
  const base_amount = Number(obj.base_amount)
  const expenses = Array.isArray(obj.expenses) ? obj.expenses : []
  const parsedExpenses: Expense[] = []
  for (const item of expenses) {
    if (!item || typeof item !== 'object') continue
    const date = String((item as any).date ?? '')
    const amount = Number((item as any).amount)
    const note = (item as any).note
    if (!date || !Number.isFinite(amount)) continue
    parsedExpenses.push({ date, amount, note: typeof note === 'string' ? note : undefined })
  }

  const monthly_bases_raw = obj.monthly_bases
  const monthly_bases: Record<string, number> = {}
  if (monthly_bases_raw && typeof monthly_bases_raw === 'object') {
    for (const [k, v] of Object.entries(monthly_bases_raw as Record<string, unknown>)) {
      const n = Number(v)
      if (typeof k === 'string' && Number.isFinite(n)) monthly_bases[k] = n
    }
  }

  return {
    base_amount: Number.isFinite(base_amount) ? base_amount : 0,
    expenses: parsedExpenses,
    monthly_bases,
    last_rollover_month: typeof obj.last_rollover_month === 'string' ? obj.last_rollover_month : '',
    last_month_key: typeof obj.last_month_key === 'string' ? obj.last_month_key : '',
    last_month_saved: Number.isFinite(Number(obj.last_month_saved)) ? Number(obj.last_month_saved) : 0
  }
}

export function rolloverMonthIfNeeded(state: BudgetState, nowIso: string): { changed: boolean } {
  const currentKey = monthKeyFromIso(nowIso)
  if ((state.last_rollover_month ?? '') === currentKey) return { changed: false }

  const prevKey = prevMonthKey(currentKey)
  const prevSpent = sumExpenses(expensesForMonth(state.expenses, prevKey))
  const prevBase = state.monthly_bases?.[prevKey] ?? state.base_amount
  const prevSaved = prevBase - prevSpent

  state.last_rollover_month = currentKey
  state.last_month_key = prevKey
  state.last_month_saved = prevSaved
  return { changed: true }
}
