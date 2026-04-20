import type { BudgetState } from './types'
import { normalizeState } from './logic'

const KEY = 'budgetapp_state_v1'

function pruneRecentlyDeleted(state: BudgetState): void {
  if (!state.recently_deleted?.length) return
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  state.recently_deleted = state.recently_deleted.filter((d) => d.deleted_at > cutoff)
}

export function loadState(): BudgetState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return normalizeState(null)
    const state = normalizeState(JSON.parse(raw))
    pruneRecentlyDeleted(state)
    return state
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
