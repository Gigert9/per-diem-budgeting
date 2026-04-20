import type { BudgetState, DeletedExpense, Expense, MonthSummary, RecurringExpense } from './types'

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
  const [, , d] = fromIso.split('-').map(Number)
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
  baselinePerDay: number,
  includeToday = false
): number {
  // Overspend debt is the sum of (spent_that_day - baseline)+ for prior days.
  // This intentionally does NOT let underspending "bank" credit.
  // includeToday=true is used to compute the projected allowance for tomorrow.
  const monthExpenses = expensesForMonth(expenses, monthKey)
  const totalsByDate: Record<string, number> = {}
  for (const e of monthExpenses) {
    if (typeof e.date !== 'string') continue
    // includeToday=false: exclude today + future (e.date >= nowIso)
    // includeToday=true: exclude only future (e.date > nowIso)
    if (includeToday ? e.date > nowIso : e.date >= nowIso) continue
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

export function computeRecurringTotal(recurring: RecurringExpense[]): number {
  return recurring.reduce((sum, r) => sum + (Number.isFinite(r.amount) ? r.amount : 0), 0)
}

// Count consecutive days from yesterday backwards where daily spend was <= baseline.
// Days with no logged expenses count as $0 (under budget).
export function computeStreak(
  expenses: Expense[],
  monthKey: string,
  nowIso: string,
  baselinePerDay: number
): number {
  const monthExpenses = expensesForMonth(expenses, monthKey)
  const totalsByDate: Record<string, number> = {}
  for (const e of monthExpenses) {
    if (typeof e.date !== 'string' || e.date >= nowIso) continue
    const amt = Number.isFinite(e.amount) ? e.amount : 0
    totalsByDate[e.date] = (totalsByDate[e.date] ?? 0) + amt
  }

  const [y, m, d] = nowIso.split('-').map(Number)
  let streak = 0
  let day = d - 1 // start at yesterday

  while (day >= 1) {
    const isoDate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const spent = totalsByDate[isoDate] ?? 0
    if (spent > baselinePerDay) break
    streak++
    day--
  }

  return streak
}

// Projected daily allowance for tomorrow if the user stops spending today.
// Includes today's expenses in the debt, uses remainingDays - 1 as the future window.
export function computeProjectedAllowance(
  expenses: Expense[],
  base: number,
  daysInMonth: number,
  remainingDaysInclToday: number,
  monthKey: string,
  nowIso: string
): number {
  const baselinePerDay = computeSpendPerDay(base, daysInMonth)
  const debtIncludingToday = computeOverspendDebt(expenses, monthKey, nowIso, baselinePerDay, true)
  const remainingAfterToday = Math.max(1, remainingDaysInclToday - 1)
  return computeNoRewardSpendPerDay(base, daysInMonth, remainingAfterToday, debtIncludingToday)
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

  const recurring: RecurringExpense[] = []
  if (Array.isArray(obj.recurring)) {
    for (const item of obj.recurring) {
      if (!item || typeof item !== 'object') continue
      const r = item as any
      const id = typeof r.id === 'string' && r.id ? r.id : String(Date.now() + Math.random())
      const amount = Number(r.amount)
      const day = Math.round(Number(r.day))
      if (!Number.isFinite(amount) || amount <= 0) continue
      if (!Number.isFinite(day) || day < 1 || day > 31) continue
      recurring.push({ id, amount, day, note: typeof r.note === 'string' ? r.note : '' })
    }
  }

  const recently_deleted: DeletedExpense[] = []
  if (Array.isArray(obj.recently_deleted)) {
    for (const item of obj.recently_deleted) {
      if (!item || typeof item !== 'object') continue
      const d = item as any
      const deleted_at = typeof d.deleted_at === 'string' ? d.deleted_at : ''
      if (!deleted_at) continue
      const exp = d.expense
      if (!exp || typeof exp !== 'object') continue
      const date = String((exp as any).date ?? '')
      const amount = Number((exp as any).amount)
      const note = (exp as any).note
      if (!date || !Number.isFinite(amount)) continue
      recently_deleted.push({
        expense: { date, amount, note: typeof note === 'string' ? note : undefined },
        deleted_at
      })
    }
  }

  const monthly_summaries: Record<string, MonthSummary> = {}
  if (obj.monthly_summaries && typeof obj.monthly_summaries === 'object') {
    for (const [k, v] of Object.entries(obj.monthly_summaries as Record<string, unknown>)) {
      if (typeof k !== 'string' || !v || typeof v !== 'object') continue
      const sv = v as any
      const base = Number(sv.base)
      const spent = Number(sv.spent)
      const saved = Number(sv.saved)
      if (Number.isFinite(base) && Number.isFinite(spent) && Number.isFinite(saved)) {
        monthly_summaries[k] = { base, spent, saved }
      }
    }
  }

  const themeRaw = obj.theme
  const theme: 'light' | 'dark' = themeRaw === 'dark' ? 'dark' : 'light'

  return {
    base_amount: Number.isFinite(base_amount) ? base_amount : 0,
    expenses: parsedExpenses,
    monthly_bases,
    last_rollover_month: typeof obj.last_rollover_month === 'string' ? obj.last_rollover_month : '',
    last_month_key: typeof obj.last_month_key === 'string' ? obj.last_month_key : '',
    last_month_saved: Number.isFinite(Number(obj.last_month_saved)) ? Number(obj.last_month_saved) : 0,
    recurring,
    recently_deleted,
    monthly_summaries,
    theme
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

  if (!state.monthly_summaries) state.monthly_summaries = {}
  state.monthly_summaries[prevKey] = { base: prevBase, spent: prevSpent, saved: prevSaved }

  // Keep at most 12 months of summaries
  const keys = Object.keys(state.monthly_summaries).sort()
  if (keys.length > 12) {
    for (const k of keys.slice(0, keys.length - 12)) {
      delete state.monthly_summaries[k]
    }
  }

  return { changed: true }
}
