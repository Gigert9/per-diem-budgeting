import type { BudgetState } from './types'
import { normalizeState } from './logic'

const KEY = 'budgetapp_state_v1'

export function loadState(): BudgetState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return normalizeState(null)
    return normalizeState(JSON.parse(raw))
  } catch {
    return normalizeState(null)
  }
}

export function saveState(state: BudgetState): void {
  localStorage.setItem(KEY, JSON.stringify(state))
}

export function exportStateJson(): string {
  return localStorage.getItem(KEY) ?? JSON.stringify(normalizeState(null))
}
