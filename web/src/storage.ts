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
  // Export a normalized, parseable representation even if storage is corrupted.
  try {
    return JSON.stringify(loadState())
  } catch {
    return JSON.stringify(normalizeState(null))
  }
}

export function importStateJson(rawJson: string): BudgetState {
  const parsed = JSON.parse(rawJson) as unknown
  const normalized = normalizeState(parsed)
  saveState(normalized)
  return normalized
}
