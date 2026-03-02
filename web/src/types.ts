export type Expense = {
  date: string // YYYY-MM-DD
  amount: number
  note?: string
}

export type BudgetState = {
  base_amount: number
  expenses: Expense[]
  monthly_bases?: Record<string, number>
  last_rollover_month?: string
  last_month_key?: string
  last_month_saved?: number
}
