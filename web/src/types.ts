export type Expense = {
  date: string // YYYY-MM-DD
  amount: number
  note?: string
}

export type RecurringExpense = {
  id: string
  amount: number
  day: number // 1–31, day of month it occurs
  note: string
}

export type DeletedExpense = {
  expense: Expense
  deleted_at: string // ISO datetime string for pruning after 24h
}

export type MonthSummary = {
  base: number
  spent: number
  saved: number
}

export type BudgetState = {
  base_amount: number
  expenses: Expense[]
  monthly_bases?: Record<string, number>
  last_rollover_month?: string
  last_month_key?: string
  last_month_saved?: number
  recurring?: RecurringExpense[]
  recently_deleted?: DeletedExpense[]
  monthly_summaries?: Record<string, MonthSummary>
  theme?: 'light' | 'dark'
}
