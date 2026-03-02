import type { BudgetState, Expense } from './types'

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
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
  const [y, m, d] = fromIso.split('-').map(Number)
  const today = new Date(y, m - 1, d)
  const firstNext = m === 12 ? new Date(y + 1, 0, 1) : new Date(y, m, 1)
  const lastThis = new Date(firstNext.getTime() - 24 * 60 * 60 * 1000)
  const diffDays = Math.floor((lastThis.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)) + 1
  return Math.max(1, diffDays)
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

export function computeSpendPerDay(baseAmount: number, remainingDays: number): number {
  const days = remainingDays <= 0 ? 1 : remainingDays
  return baseAmount / days
}

export function computeConservativeCarryoverPerDay(
  baseAmount: number,
  remainingDays: number,
  spentSoFarThisMonthExcludingToday: number
): number {
  const days = remainingDays <= 0 ? 1 : remainingDays
  const baseline = computeSpendPerDay(baseAmount, days)
  const remainingBudget = baseAmount - spentSoFarThisMonthExcludingToday
  const fair = Math.max(0, remainingBudget / days)
  return Math.min(baseline, fair)
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
