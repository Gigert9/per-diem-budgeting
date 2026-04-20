import type { BudgetState, Expense } from './types'
import {
  computeDaysInMonth,
  computeNoRewardSpendPerDay,
  computeOverspendDebt,
  computeProjectedAllowance,
  computeRecurringTotal,
  computeRemainingDaysInMonth,
  computeSpendPerDay,
  computeStreak,
  expensesForDate,
  expensesForMonth,
  monthKeyFromIso,
  rolloverMonthIfNeeded,
  sumExpenses,
  todayIso
} from './logic'
import { exportStateJson, importStateJson, loadState, saveState } from './storage'

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

function parseMoney(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return n
}

function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleString('default', { month: 'long', year: 'numeric' })
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

export function initApp(root: HTMLElement): void {
  const installedKey = 'budgetapp__installed'

  let state: BudgetState = loadState()

  const today = todayIso()
  const rollover = rolloverMonthIfNeeded(state, today)
  if (rollover.changed) saveState(state)

  root.innerHTML = ''

  // Apply saved theme immediately
  applyTheme(state.theme ?? 'light')

  const container = el('div', 'container')
  root.appendChild(container)

  // ── Header ──────────────────────────────────────────────────────────────
  const header = el('div', 'header')
  const logo = el('img', 'logo') as HTMLImageElement
  logo.alt = 'BudgetApp'
  logo.src = `${import.meta.env.BASE_URL}icons/icon-192.png`
  header.appendChild(logo)
  const title = el('h1', 'title')
  title.textContent = 'Budget per day'
  header.appendChild(title)

  const headerActions = el('div', 'headerActions')

  const themeBtn = el('button') as HTMLButtonElement
  themeBtn.textContent = state.theme === 'dark' ? 'Light mode' : 'Dark mode'
  themeBtn.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark'
    applyTheme(state.theme)
    themeBtn.textContent = state.theme === 'dark' ? 'Light mode' : 'Dark mode'
    saveState(state)
  })
  headerActions.appendChild(themeBtn)

  const installBtn = el('button') as HTMLButtonElement
  installBtn.textContent = 'Install'
  installBtn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('budgetapp:installClick'))
  })
  headerActions.appendChild(installBtn)
  header.appendChild(headerActions)
  container.appendChild(header)

  const isStandalone = (): boolean => {
    // @ts-expect-error - navigator.standalone exists on iOS
    if (typeof navigator.standalone === 'boolean') return navigator.standalone
    return window.matchMedia('(display-mode: standalone)').matches
  }

  const isInstalled = (): boolean => {
    if (isStandalone()) return true
    try { return localStorage.getItem(installedKey) === '1' } catch { return false }
  }

  const updateInstallUi = (): void => {
    installBtn.style.display = isInstalled() ? 'none' : ''
  }
  updateInstallUi()

  window.addEventListener('budgetapp:canInstall', (e: any) => {
    installBtn.dataset.canInstall = Boolean(e?.detail) ? '1' : '0'
  })
  window.addEventListener('budgetapp:installed', () => { updateInstallUi() })

  // ── Install help modal ───────────────────────────────────────────────────
  const installHelpBackdrop = el('div', 'modalBackdrop')
  const installHelpModal = el('div', 'modal')
  const installHelpTitle = el('h2')
  const installHelpBody = el('div')
  installHelpModal.appendChild(installHelpTitle)
  installHelpModal.appendChild(installHelpBody)

  function setInstallHelp(platform: 'ios' | 'android'): void {
    if (platform === 'ios') {
      installHelpTitle.textContent = 'Install on iPhone / iPad'
      installHelpBody.innerHTML = `
        <p>1) Tap the <strong>Share</strong> button in Safari.</p>
        <p>2) Tap <strong>Add to Home Screen</strong>.</p>
        <p>3) Confirm.</p>
      `
      return
    }
    installHelpTitle.textContent = 'Install on Android'
    installHelpBody.innerHTML = `
      <p>If you don't see an install prompt:</p>
      <p>1) Open the browser menu (&#8942;)</p>
      <p>2) Tap <strong>Install app</strong> or <strong>Add to Home screen</strong></p>
    `
  }

  const closeHelp = el('button') as HTMLButtonElement
  closeHelp.textContent = 'Close'
  closeHelp.addEventListener('click', () => { installHelpBackdrop.style.display = 'none' })
  installHelpModal.appendChild(closeHelp)
  installHelpBackdrop.appendChild(installHelpModal)
  container.appendChild(installHelpBackdrop)

  window.addEventListener('budgetapp:showInstallHelp', (e: any) => {
    const platform = e?.detail?.platform === 'android' ? 'android' : 'ios'
    setInstallHelp(platform)
    installHelpBackdrop.style.display = 'flex'
  })
  installHelpBackdrop.addEventListener('click', (ev) => {
    if (ev.target === installHelpBackdrop) installHelpBackdrop.style.display = 'none'
  })

  // ── Base amount card ─────────────────────────────────────────────────────
  const baseCard = el('div', 'card')
  const baseRow = el('div', 'row')
  const baseField = el('div')
  const baseLabel = el('label')
  baseLabel.textContent = 'Monthly budget'
  const baseInput = el('input') as HTMLInputElement
  baseInput.inputMode = 'decimal'
  baseInput.value = formatMoney(state.base_amount)
  baseField.appendChild(baseLabel)
  baseField.appendChild(baseInput)
  baseRow.appendChild(baseField)

  const baseButtons = el('div')
  baseButtons.style.cssText = 'display:flex;gap:8px;align-items:end'
  const recalcBtn = el('button') as HTMLButtonElement
  recalcBtn.textContent = 'Recalculate'
  const saveBtn = el('button', 'primary') as HTMLButtonElement
  saveBtn.textContent = 'Save'
  baseButtons.appendChild(recalcBtn)
  baseButtons.appendChild(saveBtn)
  baseRow.appendChild(baseButtons)
  baseCard.appendChild(baseRow)

  // Live preview line below the base input
  const basePreview = el('div', 'basePreview')
  baseCard.appendChild(basePreview)
  container.appendChild(baseCard)

  // ── Metrics card ─────────────────────────────────────────────────────────
  const metricsCard = el('div', 'card')
  const metricsRoot = el('div', 'metricsRoot')
  metricsCard.appendChild(metricsRoot)
  container.appendChild(metricsCard)

  // ── Tabs ─────────────────────────────────────────────────────────────────
  const tabs = el('div', 'tabs')
  const tabTodayBtn = el('button', 'primary') as HTMLButtonElement
  tabTodayBtn.textContent = 'Today'
  const tabHistoryBtn = el('button') as HTMLButtonElement
  tabHistoryBtn.textContent = 'History'
  const tabRecurringBtn = el('button') as HTMLButtonElement
  tabRecurringBtn.textContent = 'Recurring'
  const tabTrendBtn = el('button') as HTMLButtonElement
  tabTrendBtn.textContent = 'Trend'
  tabs.appendChild(tabTodayBtn)
  tabs.appendChild(tabHistoryBtn)
  tabs.appendChild(tabRecurringBtn)
  tabs.appendChild(tabTrendBtn)
  container.appendChild(tabs)

  // ── Today tab ────────────────────────────────────────────────────────────
  const expenseCard = el('div', 'card')
  const expTitle = el('div')
  expTitle.style.fontWeight = '700'
  expTitle.textContent = 'Enter an expense (today)'
  expenseCard.appendChild(expTitle)

  const expRow = el('div', 'row')
  const amountField = el('div')
  const amountLabel = el('label')
  amountLabel.textContent = 'Amount'
  const amountInput = el('input') as HTMLInputElement
  amountInput.inputMode = 'decimal'
  amountField.appendChild(amountLabel)
  amountField.appendChild(amountInput)
  expRow.appendChild(amountField)

  const noteField = el('div')
  const noteLabel = el('label')
  noteLabel.textContent = 'Note (optional)'
  const noteInput = el('input') as HTMLInputElement
  noteField.appendChild(noteLabel)
  noteField.appendChild(noteInput)
  expRow.appendChild(noteField)
  expenseCard.appendChild(expRow)

  const addExpenseBtn = el('button', 'primary') as HTMLButtonElement
  addExpenseBtn.textContent = 'Add expense'
  addExpenseBtn.style.marginTop = '10px'
  expenseCard.appendChild(addExpenseBtn)

  const todayListTitle = el('div')
  todayListTitle.style.cssText = 'margin-top:12px;font-weight:700'
  todayListTitle.textContent = "Today's expenses"
  expenseCard.appendChild(todayListTitle)

  const list = el('ul', 'list')
  expenseCard.appendChild(list)

  const todayActions = el('div', 'actions')
  const deleteExpenseBtn = el('button') as HTMLButtonElement
  deleteExpenseBtn.textContent = 'Delete selected'
  deleteExpenseBtn.disabled = true
  const undoTodayBtn = el('button') as HTMLButtonElement
  undoTodayBtn.textContent = 'Undo last delete'
  todayActions.appendChild(deleteExpenseBtn)
  todayActions.appendChild(undoTodayBtn)
  expenseCard.appendChild(todayActions)
  container.appendChild(expenseCard)

  // ── History tab ──────────────────────────────────────────────────────────
  const historyCard = el('div', 'card')
  historyCard.style.display = 'none'
  const historyTitle = el('div')
  historyTitle.style.fontWeight = '700'
  historyTitle.textContent = 'Expense history'
  historyCard.appendChild(historyTitle)

  const historyRow = el('div', 'row')
  const historyDateField = el('div')
  const historyDateLabel = el('label')
  historyDateLabel.textContent = 'Date'
  const historyDateInput = el('input') as HTMLInputElement
  historyDateInput.type = 'date'
  historyDateInput.value = todayIso()
  {
    const nowIso = todayIso()
    const mk = monthKeyFromIso(nowIso)
    const dim = computeDaysInMonth(nowIso)
    historyDateInput.min = `${mk}-01`
    historyDateInput.max = `${mk}-${String(dim).padStart(2, '0')}`
  }
  historyDateField.appendChild(historyDateLabel)
  historyDateField.appendChild(historyDateInput)
  historyRow.appendChild(historyDateField)
  historyCard.appendChild(historyRow)

  const historyListTitle = el('div')
  historyListTitle.style.cssText = 'margin-top:12px;font-weight:700'
  historyListTitle.textContent = 'Expenses for selected day'
  historyCard.appendChild(historyListTitle)

  const historyList = el('ul', 'list')
  historyCard.appendChild(historyList)

  const historyEditTitle = el('div')
  historyEditTitle.style.cssText = 'margin-top:12px;font-weight:700'
  historyEditTitle.textContent = 'Add / edit'
  historyCard.appendChild(historyEditTitle)

  const historyEditRow = el('div', 'row')
  const historyAmountField = el('div')
  const historyAmountLabel = el('label')
  historyAmountLabel.textContent = 'Amount'
  const historyAmountInput = el('input') as HTMLInputElement
  historyAmountInput.inputMode = 'decimal'
  historyAmountField.appendChild(historyAmountLabel)
  historyAmountField.appendChild(historyAmountInput)
  historyEditRow.appendChild(historyAmountField)

  const historyNoteField = el('div')
  const historyNoteLabel = el('label')
  historyNoteLabel.textContent = 'Note (optional)'
  const historyNoteInput = el('input') as HTMLInputElement
  historyNoteField.appendChild(historyNoteLabel)
  historyNoteField.appendChild(historyNoteInput)
  historyEditRow.appendChild(historyNoteField)
  historyCard.appendChild(historyEditRow)

  const historyButtons = el('div', 'actions')
  const historyAddBtn = el('button', 'primary') as HTMLButtonElement
  historyAddBtn.textContent = 'Add to this day'
  const historySaveBtn = el('button', 'primary') as HTMLButtonElement
  historySaveBtn.textContent = 'Save changes'
  historySaveBtn.disabled = true
  const historyDeleteBtn = el('button') as HTMLButtonElement
  historyDeleteBtn.textContent = 'Delete selected'
  historyDeleteBtn.disabled = true
  const undoHistoryBtn = el('button') as HTMLButtonElement
  undoHistoryBtn.textContent = 'Undo last delete'
  historyButtons.appendChild(historyAddBtn)
  historyButtons.appendChild(historySaveBtn)
  historyButtons.appendChild(historyDeleteBtn)
  historyButtons.appendChild(undoHistoryBtn)
  historyCard.appendChild(historyButtons)
  container.appendChild(historyCard)

  // ── Recurring tab ────────────────────────────────────────────────────────
  const recurringCard = el('div', 'card')
  recurringCard.style.display = 'none'
  const recurringTitle = el('div')
  recurringTitle.style.fontWeight = '700'
  recurringTitle.textContent = 'Recurring expenses'
  recurringCard.appendChild(recurringTitle)
  const recurringNote = el('div', 'recurringNote')
  recurringNote.textContent = 'These amounts are pre-deducted from your monthly budget before calculating your daily allowance.'
  recurringCard.appendChild(recurringNote)

  const recurringList = el('ul', 'list')
  recurringCard.appendChild(recurringList)

  const recurringTotalEl = el('div', 'recurringTotal')
  recurringCard.appendChild(recurringTotalEl)

  const recurringAddTitle = el('div')
  recurringAddTitle.style.cssText = 'margin-top:14px;font-weight:700'
  recurringAddTitle.textContent = 'Add recurring expense'
  recurringCard.appendChild(recurringAddTitle)

  const recurringAddRow = el('div', 'row')
  const rAmountField = el('div')
  const rAmountLabel = el('label')
  rAmountLabel.textContent = 'Amount'
  const rAmountInput = el('input') as HTMLInputElement
  rAmountInput.inputMode = 'decimal'
  rAmountField.appendChild(rAmountLabel)
  rAmountField.appendChild(rAmountInput)
  recurringAddRow.appendChild(rAmountField)

  const rDayField = el('div')
  const rDayLabel = el('label')
  rDayLabel.textContent = 'Day of month (1–31)'
  const rDayInput = el('input') as HTMLInputElement
  rDayInput.inputMode = 'numeric'
  rDayField.appendChild(rDayLabel)
  rDayField.appendChild(rDayInput)
  recurringAddRow.appendChild(rDayField)
  recurringCard.appendChild(recurringAddRow)

  const rNoteField = el('div')
  rNoteField.style.marginTop = '8px'
  const rNoteLabel = el('label')
  rNoteLabel.textContent = 'Note (optional)'
  const rNoteInput = el('input') as HTMLInputElement
  rNoteField.appendChild(rNoteLabel)
  rNoteField.appendChild(rNoteInput)
  recurringCard.appendChild(rNoteField)

  const recurringActions = el('div', 'actions')
  const recurringAddBtn = el('button', 'primary') as HTMLButtonElement
  recurringAddBtn.textContent = 'Add recurring'
  const recurringDeleteBtn = el('button') as HTMLButtonElement
  recurringDeleteBtn.textContent = 'Delete selected'
  recurringDeleteBtn.disabled = true
  recurringActions.appendChild(recurringAddBtn)
  recurringActions.appendChild(recurringDeleteBtn)
  recurringCard.appendChild(recurringActions)
  container.appendChild(recurringCard)

  // ── Trend tab ────────────────────────────────────────────────────────────
  const trendCard = el('div', 'card')
  trendCard.style.display = 'none'
  const trendTitle = el('div')
  trendTitle.style.fontWeight = '700'
  trendTitle.textContent = 'Spending trend'
  trendCard.appendChild(trendTitle)
  const trendSubtitle = el('div')
  trendSubtitle.style.cssText = 'font-size:12px;color:var(--text-label);margin-bottom:4px'
  trendCard.appendChild(trendSubtitle)
  const trendList = el('div', 'trendList')
  trendCard.appendChild(trendList)

  const trendSummaryTitle = el('div')
  trendSummaryTitle.style.cssText = 'font-weight:700;margin-top:18px;margin-bottom:4px'
  trendSummaryTitle.textContent = 'Past months'
  trendCard.appendChild(trendSummaryTitle)
  const trendSummaryWrap = el('div')
  trendCard.appendChild(trendSummaryWrap)
  container.appendChild(trendCard)

  // ── Backup card ──────────────────────────────────────────────────────────
  const backupCard = el('div', 'card')
  const backupTitle = el('div')
  backupTitle.style.fontWeight = '700'
  backupTitle.textContent = 'Backup'
  backupCard.appendChild(backupTitle)

  const backupActions = el('div', 'actions')
  const exportBtn = el('button', 'primary') as HTMLButtonElement
  exportBtn.textContent = 'Export JSON'
  const importBtn = el('button') as HTMLButtonElement
  importBtn.textContent = 'Import JSON'
  backupActions.appendChild(exportBtn)
  backupActions.appendChild(importBtn)
  backupCard.appendChild(backupActions)

  const importInput = el('input') as HTMLInputElement
  importInput.type = 'file'
  importInput.accept = 'application/json,.json'
  importInput.style.display = 'none'
  backupCard.appendChild(importInput)
  container.appendChild(backupCard)

  const status = el('div', 'status')
  container.appendChild(status)

  // ── State ─────────────────────────────────────────────────────────────────
  let selectedExpenseStateIndex: number | null = null
  let selectedHistoryExpenseStateIndex: number | null = null
  let selectedRecurringId: string | null = null

  function setStatus(msg: string): void { status.textContent = msg }

  function downloadTextFile(filename: string, content: string, mime: string): void {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.rel = 'noopener'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function applyThemeLocal(theme: 'light' | 'dark'): void {
    applyTheme(theme)
    themeBtn.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode'
  }

  function updateUndoButtons(): void {
    const hasDeleted = (state.recently_deleted?.length ?? 0) > 0
    undoTodayBtn.disabled = !hasDeleted
    undoHistoryBtn.disabled = !hasDeleted
  }

  // ── Metrics rendering ─────────────────────────────────────────────────────
  function upsertMetric(
    parent: HTMLElement,
    labelText: string,
    valueText: string,
    opts?: { important?: boolean; fullWidth?: boolean }
  ): void {
    const cls = ['metric']
    if (opts?.important) cls.push('important')
    if (opts?.fullWidth) cls.push('full')
    const item = el('div', cls.join(' '))
    const l = el('div')
    l.textContent = labelText
    const v = el('div', 'value')
    v.textContent = valueText
    item.appendChild(l)
    item.appendChild(v)
    parent.appendChild(item)
  }

  function createMetricsSection(titleText: string, badge?: string): { section: HTMLElement; grid: HTMLElement } {
    const section = el('div', 'metricsSection')
    const titleRow = el('div', 'metricsSectionTitle')
    titleRow.textContent = titleText
    if (badge) {
      const b = el('span', 'streakBadge')
      b.textContent = badge
      titleRow.appendChild(b)
    }
    const grid = el('div', 'metrics')
    section.appendChild(titleRow)
    section.appendChild(grid)
    return { section, grid }
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  function setTab(tab: 'today' | 'history' | 'recurring' | 'trend'): void {
    tabTodayBtn.classList.toggle('primary', tab === 'today')
    tabHistoryBtn.classList.toggle('primary', tab === 'history')
    tabRecurringBtn.classList.toggle('primary', tab === 'recurring')
    tabTrendBtn.classList.toggle('primary', tab === 'trend')
    expenseCard.style.display = tab === 'today' ? '' : 'none'
    historyCard.style.display = tab === 'history' ? '' : 'none'
    recurringCard.style.display = tab === 'recurring' ? '' : 'none'
    trendCard.style.display = tab === 'trend' ? '' : 'none'
    if (tab === 'today') updateDeleteExpenseUi(todayIso())
    if (tab === 'history') renderHistoryList(historyDateInput.value || todayIso())
    if (tab === 'recurring') renderRecurringList()
    if (tab === 'trend') renderTrend()
  }

  tabTodayBtn.addEventListener('click', () => setTab('today'))
  tabHistoryBtn.addEventListener('click', () => setTab('history'))
  tabRecurringBtn.addEventListener('click', () => setTab('recurring'))
  tabTrendBtn.addEventListener('click', () => setTab('trend'))

  // ── Today list ────────────────────────────────────────────────────────────
  function updateDeleteExpenseUi(nowIso: string): void {
    if (selectedExpenseStateIndex === null) { deleteExpenseBtn.disabled = true; return }
    const exp = state.expenses[selectedExpenseStateIndex]
    deleteExpenseBtn.disabled = !(exp && exp.date === nowIso)
  }

  function renderTodayList(nowIso: string): void {
    list.innerHTML = ''
    const todayItems: Array<{ exp: Expense; stateIndex: number }> = []
    for (let i = 0; i < state.expenses.length; i++) {
      const exp = state.expenses[i]
      if (exp.date === nowIso) todayItems.push({ exp, stateIndex: i })
    }
    for (const item of todayItems) {
      const e = item.exp
      const li = el('li')
      li.textContent = `${formatMoney(e.amount)}${e.note ? ` \u2014 ${e.note}` : ''}`
      if (selectedExpenseStateIndex === item.stateIndex) li.classList.add('selected')
      li.addEventListener('click', () => {
        selectedExpenseStateIndex = item.stateIndex
        renderTodayList(nowIso)
      })
      list.appendChild(li)
    }
    if (selectedExpenseStateIndex !== null) {
      const sel = state.expenses[selectedExpenseStateIndex]
      if (!sel || sel.date !== nowIso) selectedExpenseStateIndex = null
    }
    updateDeleteExpenseUi(nowIso)
  }

  // ── History list ──────────────────────────────────────────────────────────
  function updateHistoryEditUi(): void {
    const enabled = selectedHistoryExpenseStateIndex !== null
    historySaveBtn.disabled = !enabled
    historyDeleteBtn.disabled = !enabled
  }

  function clearHistorySelection(): void {
    selectedHistoryExpenseStateIndex = null
    historyAmountInput.value = ''
    historyNoteInput.value = ''
    updateHistoryEditUi()
  }

  function renderHistoryList(isoDate: string): void {
    historyList.innerHTML = ''
    const items: Array<{ exp: Expense; stateIndex: number }> = []
    for (let i = 0; i < state.expenses.length; i++) {
      const exp = state.expenses[i]
      if (exp.date === isoDate) items.push({ exp, stateIndex: i })
    }
    if (items.length === 0) {
      const li = el('li')
      li.textContent = 'No expenses for this day.'
      li.style.cursor = 'default'
      historyList.appendChild(li)
      clearHistorySelection()
      return
    }
    for (const item of items) {
      const li = el('li')
      li.textContent = `${formatMoney(item.exp.amount)}${item.exp.note ? ` \u2014 ${item.exp.note}` : ''}`
      if (selectedHistoryExpenseStateIndex === item.stateIndex) li.classList.add('selected')
      li.addEventListener('click', () => {
        selectedHistoryExpenseStateIndex = item.stateIndex
        historyAmountInput.value = formatMoney(item.exp.amount)
        historyNoteInput.value = item.exp.note ?? ''
        renderHistoryList(isoDate)
        updateHistoryEditUi()
      })
      historyList.appendChild(li)
    }
    if (selectedHistoryExpenseStateIndex !== null) {
      const sel = state.expenses[selectedHistoryExpenseStateIndex]
      if (!sel || sel.date !== isoDate) clearHistorySelection()
    }
    updateHistoryEditUi()
  }

  // ── Recurring list ────────────────────────────────────────────────────────
  function renderRecurringList(): void {
    recurringList.innerHTML = ''
    const recurring = state.recurring ?? []
    if (recurring.length === 0) {
      const li = el('li')
      li.textContent = 'No recurring expenses set.'
      li.style.cursor = 'default'
      recurringList.appendChild(li)
      recurringDeleteBtn.disabled = true
      recurringTotalEl.textContent = ''
      return
    }
    const sorted = [...recurring].sort((a, b) => a.day - b.day)
    for (const r of sorted) {
      const li = el('li')
      li.textContent = `Day ${r.day} \u2014 $${formatMoney(r.amount)}${r.note ? ` \u2014 ${r.note}` : ''}`
      if (selectedRecurringId === r.id) li.classList.add('selected')
      li.addEventListener('click', () => {
        selectedRecurringId = r.id
        renderRecurringList()
        recurringDeleteBtn.disabled = false
      })
      recurringList.appendChild(li)
    }
    const total = computeRecurringTotal(recurring)
    recurringTotalEl.textContent = `Total reserved monthly: $${formatMoney(total)}`
    if (selectedRecurringId !== null && !recurring.find((r) => r.id === selectedRecurringId)) {
      selectedRecurringId = null
    }
    recurringDeleteBtn.disabled = selectedRecurringId === null
  }

  // ── Trend rendering ───────────────────────────────────────────────────────
  function renderTrend(): void {
    const now = todayIso()
    const [y, m, d] = now.split('-').map(Number)
    const recurringTotal = computeRecurringTotal(state.recurring ?? [])
    const base = parseMoney(baseInput.value) ?? state.base_amount
    const effectiveBase = Math.max(0, base - recurringTotal)
    const daysInMonth = computeDaysInMonth(now)
    const baseline = computeSpendPerDay(effectiveBase, daysInMonth)

    trendSubtitle.textContent = `Baseline: $${formatMoney(baseline)}/day`
    trendList.innerHTML = ''

    for (let day = 1; day <= d; day++) {
      const isoDate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const dayExpenses = expensesForDate(state.expenses, isoDate)
      const spent = sumExpenses(dayExpenses)
      const isOver = spent > baseline
      // Bar fill: 50% at baseline, 100% at 2× baseline
      const fillPct = Math.min(100, baseline > 0 ? (spent / (2 * baseline)) * 100 : 0)
      const label = new Date(y, m - 1, day).toLocaleDateString('default', { month: 'short', day: 'numeric' })

      const row = el('div', 'trendRow')
      const dateEl = el('div', 'trendDate')
      dateEl.textContent = label
      const amtEl = el('div', 'trendAmount')
      amtEl.textContent = `$${formatMoney(spent)}`
      const barWrap = el('div', 'trendBarWrap')
      const barFill = el('div', `trendBarFill ${isOver ? 'over' : 'under'}`)
      barFill.style.width = `${fillPct}%`
      barWrap.appendChild(barFill)
      const tag = el('div', `trendTag ${isOver ? 'over' : 'under'}`)
      tag.textContent = isOver ? 'Over' : 'OK'
      row.appendChild(dateEl)
      row.appendChild(amtEl)
      row.appendChild(barWrap)
      row.appendChild(tag)
      trendList.appendChild(row)
    }

    // Monthly summaries
    trendSummaryWrap.innerHTML = ''
    const summaries = state.monthly_summaries ?? {}
    const summaryKeys = Object.keys(summaries).sort().reverse()
    if (summaryKeys.length === 0) {
      const note = el('div')
      note.style.cssText = 'font-size:13px;color:var(--text-label)'
      note.textContent = 'No past months recorded yet.'
      trendSummaryWrap.appendChild(note)
      return
    }
    const table = el('table', 'summaryTable')
    const thead = el('thead')
    const hRow = el('tr')
    for (const h of ['Month', 'Budget', 'Spent', 'Saved']) {
      const th = el('th')
      th.textContent = h
      hRow.appendChild(th)
    }
    thead.appendChild(hRow)
    table.appendChild(thead)
    const tbody = el('tbody')
    for (const key of summaryKeys) {
      const s = summaries[key]
      const tr = el('tr')
      const monthTd = el('td'); monthTd.textContent = formatMonthLabel(key)
      const baseTd = el('td'); baseTd.textContent = `$${formatMoney(s.base)}`
      const spentTd = el('td'); spentTd.textContent = `$${formatMoney(s.spent)}`
      const savedTd = el('td')
      savedTd.textContent = `${s.saved >= 0 ? '+' : ''}$${formatMoney(s.saved)}`
      savedTd.className = s.saved >= 0 ? 'saved-pos' : 'saved-neg'
      tr.appendChild(monthTd); tr.appendChild(baseTd); tr.appendChild(spentTd); tr.appendChild(savedTd)
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
    trendSummaryWrap.appendChild(table)
  }

  // ── Core compute + render ─────────────────────────────────────────────────
  function recomputeAndRender(opts: { save: boolean }): void {
    const base = parseMoney(baseInput.value)
    if (base === null) {
      setStatus('Enter a valid number (example: 1000 or 1000.00).')
      metricsRoot.innerHTML = ''
      list.innerHTML = ''
      historyList.innerHTML = ''
      selectedExpenseStateIndex = null
      clearHistorySelection()
      updateDeleteExpenseUi(todayIso())
      basePreview.textContent = ''
      return
    }

    const now = todayIso()
    const monthKey = monthKeyFromIso(now)
    const daysInMonth = computeDaysInMonth(now)
    const remainingDays = computeRemainingDaysInMonth(now)
    const recurringTotal = computeRecurringTotal(state.recurring ?? [])
    const effectiveBase = Math.max(0, base - recurringTotal)

    const todaySpent = sumExpenses(expensesForDate(state.expenses, now))
    const monthSpent = sumExpenses(expensesForMonth(state.expenses, monthKey))
    const baselinePerDay = computeSpendPerDay(effectiveBase, daysInMonth)
    const overspendDebt = computeOverspendDebt(state.expenses, monthKey, now, baselinePerDay)
    const perDay = computeNoRewardSpendPerDay(effectiveBase, daysInMonth, remainingDays, overspendDebt)
    const projectedAllowance = computeProjectedAllowance(state.expenses, effectiveBase, daysInMonth, remainingDays, monthKey, now)
    const streak = computeStreak(state.expenses, monthKey, now, baselinePerDay)

    const todayRemaining = perDay - todaySpent
    const monthRemaining = effectiveBase - monthSpent

    metricsRoot.innerHTML = ''

    // Daily section
    const streakBadge = streak > 0 ? `${streak}-day streak` : undefined
    const daily = createMetricsSection('Daily', streakBadge)
    upsertMetric(daily.grid, 'Remaining days (incl. today)', String(remainingDays))
    upsertMetric(daily.grid, 'You can spend per day', `$${formatMoney(perDay)}`)
    // Projected allowance: show only when today has spending or is mid-day
    upsertMetric(daily.grid, 'If done today, tomorrow:', `$${formatMoney(projectedAllowance)}`)
    upsertMetric(daily.grid, 'Spent today', `$${formatMoney(todaySpent)}`)
    upsertMetric(daily.grid, 'Remaining today', `$${formatMoney(todayRemaining)}`, { important: true, fullWidth: true })

    // Recovery callout when daily allowance is $0
    if (perDay === 0) {
      const note = el('div', 'recoveryNote')
      note.textContent = `Daily limit exceeded \u2014 focus on keeping total spending under $${formatMoney(base)} this month ($${formatMoney(monthRemaining)} remaining, ${remainingDays} days left).`
      daily.grid.appendChild(note)
    }
    metricsRoot.appendChild(daily.section)

    // This month section
    const month = createMetricsSection('This month')
    upsertMetric(month.grid, 'Spent this month', `$${formatMoney(monthSpent)}`)
    if (recurringTotal > 0) {
      upsertMetric(month.grid, 'Recurring reserved', `$${formatMoney(recurringTotal)}`)
    }
    upsertMetric(month.grid, 'Remaining this month', `$${formatMoney(monthRemaining)}`)
    metricsRoot.appendChild(month.section)

    // Last month section
    const lastMonth = createMetricsSection('Last month')
    upsertMetric(lastMonth.grid, 'Amount saved last month', `$${formatMoney(state.last_month_saved ?? 0)}`)
    metricsRoot.appendChild(lastMonth.section)

    renderTodayList(now)
    if (historyCard.style.display !== 'none') renderHistoryList(historyDateInput.value || now)
    if (trendCard.style.display !== 'none') renderTrend()
    updateUndoButtons()

    state.base_amount = base
    if (!state.monthly_bases) state.monthly_bases = {}
    if (opts.save) {
      state.monthly_bases[monthKey] = base
      saveState(state)
      setStatus('Saved.')
      basePreview.textContent = ''
    } else {
      if (todayRemaining < 0) {
        setStatus(`Over today's allowance by $${formatMoney(-todayRemaining)}.`)
      } else {
        setStatus('')
      }
    }
  }

  // ── Base input live preview ───────────────────────────────────────────────
  function updateBasePreview(): void {
    const newBase = parseMoney(baseInput.value)
    if (newBase === null || newBase === state.base_amount) {
      basePreview.textContent = ''
      return
    }
    const now = todayIso()
    const monthKey = monthKeyFromIso(now)
    const daysInMonth = computeDaysInMonth(now)
    const remainingDays = computeRemainingDaysInMonth(now)
    const recurringTotal = computeRecurringTotal(state.recurring ?? [])
    const effectiveBase = Math.max(0, newBase - recurringTotal)
    const baselinePerDay = computeSpendPerDay(effectiveBase, daysInMonth)
    const overspendDebt = computeOverspendDebt(state.expenses, monthKey, now, baselinePerDay)
    const newPerDay = computeNoRewardSpendPerDay(effectiveBase, daysInMonth, remainingDays, overspendDebt)
    const currentPerDay = computeNoRewardSpendPerDay(
      Math.max(0, state.base_amount - recurringTotal),
      daysInMonth,
      remainingDays,
      computeOverspendDebt(state.expenses, monthKey, now, computeSpendPerDay(Math.max(0, state.base_amount - recurringTotal), daysInMonth))
    )
    basePreview.textContent = `Current daily: $${formatMoney(currentPerDay)} \u2192 New daily: $${formatMoney(newPerDay)}`
  }

  recalcBtn.addEventListener('click', () => recomputeAndRender({ save: false }))
  saveBtn.addEventListener('click', () => recomputeAndRender({ save: true }))
  baseInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') recomputeAndRender({ save: false }) })
  baseInput.addEventListener('input', updateBasePreview)

  // ── Add expense ───────────────────────────────────────────────────────────
  function addExpense(): void {
    const amount = parseMoney(amountInput.value)
    if (amount === null || amount <= 0) { setStatus('Enter a positive expense amount.'); return }
    const note = noteInput.value.trim()
    const exp: Expense = { date: todayIso(), amount, note: note || undefined }
    state.expenses.push(exp)
    saveState(state)
    selectedExpenseStateIndex = null
    amountInput.value = ''
    noteInput.value = ''
    recomputeAndRender({ save: false })
  }

  addExpenseBtn.addEventListener('click', addExpense)
  amountInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addExpense() })
  noteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addExpense() })

  // ── Delete expense (Today) ────────────────────────────────────────────────
  deleteExpenseBtn.addEventListener('click', () => {
    const nowIso = todayIso()
    if (selectedExpenseStateIndex === null) { setStatus('Select an expense to delete.'); return }
    const exp = state.expenses[selectedExpenseStateIndex]
    if (!exp || exp.date !== nowIso) {
      selectedExpenseStateIndex = null
      renderTodayList(nowIso)
      setStatus('Select an expense from today to delete.')
      return
    }
    pushToRecentlyDeleted(exp)
    state.expenses.splice(selectedExpenseStateIndex, 1)
    saveState(state)
    selectedExpenseStateIndex = null
    recomputeAndRender({ save: false })
    if (!status.textContent) setStatus('Deleted.')
  })

  // ── Undo delete ───────────────────────────────────────────────────────────
  function pushToRecentlyDeleted(exp: Expense): void {
    if (!state.recently_deleted) state.recently_deleted = []
    state.recently_deleted.push({ expense: exp, deleted_at: new Date().toISOString() })
    // Keep at most 10
    if (state.recently_deleted.length > 10) state.recently_deleted.shift()
  }

  function performUndo(): void {
    const stack = state.recently_deleted ?? []
    if (stack.length === 0) { setStatus('Nothing to undo.'); return }
    const last = stack.pop()!
    state.expenses.push(last.expense)
    saveState(state)
    recomputeAndRender({ save: false })
    if (!status.textContent) setStatus('Restored.')
  }

  undoTodayBtn.addEventListener('click', performUndo)
  undoHistoryBtn.addEventListener('click', performUndo)

  // ── History actions ───────────────────────────────────────────────────────
  historyDateInput.addEventListener('change', () => {
    clearHistorySelection()
    renderHistoryList(historyDateInput.value || todayIso())
  })

  function addHistoryExpense(): void {
    const iso = historyDateInput.value || todayIso()
    const amount = parseMoney(historyAmountInput.value)
    if (amount === null || amount <= 0) { setStatus('Enter a positive expense amount.'); return }
    const note = historyNoteInput.value.trim()
    state.expenses.push({ date: iso, amount, note: note || undefined })
    saveState(state)
    clearHistorySelection()
    recomputeAndRender({ save: false })
    if (!status.textContent) setStatus('Added.')
  }

  function saveHistoryEdit(): void {
    const idx = selectedHistoryExpenseStateIndex
    if (idx === null) { setStatus('Select an expense to edit.'); return }
    const iso = historyDateInput.value || todayIso()
    const exp = state.expenses[idx]
    if (!exp || exp.date !== iso) { clearHistorySelection(); renderHistoryList(iso); setStatus('Select an expense from the list to edit.'); return }
    const amount = parseMoney(historyAmountInput.value)
    if (amount === null || amount <= 0) { setStatus('Enter a positive expense amount.'); return }
    exp.amount = amount
    exp.note = historyNoteInput.value.trim() || undefined
    saveState(state)
    recomputeAndRender({ save: false })
    if (!status.textContent) setStatus('Saved changes.')
  }

  historyAddBtn.addEventListener('click', addHistoryExpense)
  historySaveBtn.addEventListener('click', saveHistoryEdit)
  historyAmountInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveHistoryEdit() })
  historyNoteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveHistoryEdit() })

  historyDeleteBtn.addEventListener('click', () => {
    const idx = selectedHistoryExpenseStateIndex
    if (idx === null) { setStatus('Select an expense to delete.'); return }
    const iso = historyDateInput.value || todayIso()
    const exp = state.expenses[idx]
    if (!exp || exp.date !== iso) { clearHistorySelection(); renderHistoryList(iso); setStatus('Select an expense from the list to delete.'); return }
    pushToRecentlyDeleted(exp)
    state.expenses.splice(idx, 1)
    saveState(state)
    clearHistorySelection()
    recomputeAndRender({ save: false })
    if (!status.textContent) setStatus('Deleted.')
  })

  // ── Recurring actions ─────────────────────────────────────────────────────
  recurringAddBtn.addEventListener('click', () => {
    const amount = parseMoney(rAmountInput.value)
    if (amount === null || amount <= 0) { setStatus('Enter a positive amount.'); return }
    const day = Math.round(Number(rDayInput.value))
    if (!Number.isFinite(day) || day < 1 || day > 31) { setStatus('Enter a day of month between 1 and 31.'); return }
    const note = rNoteInput.value.trim()
    if (!state.recurring) state.recurring = []
    state.recurring.push({ id: `${Date.now()}-${Math.random()}`, amount, day, note })
    saveState(state)
    rAmountInput.value = ''
    rDayInput.value = ''
    rNoteInput.value = ''
    renderRecurringList()
    recomputeAndRender({ save: false })
    if (!status.textContent) setStatus('Recurring expense added.')
  })

  recurringDeleteBtn.addEventListener('click', () => {
    if (!selectedRecurringId) { setStatus('Select a recurring expense to delete.'); return }
    state.recurring = (state.recurring ?? []).filter((r) => r.id !== selectedRecurringId)
    selectedRecurringId = null
    saveState(state)
    renderRecurringList()
    recomputeAndRender({ save: false })
    if (!status.textContent) setStatus('Recurring expense removed.')
  })

  // ── Backup ────────────────────────────────────────────────────────────────
  exportBtn.addEventListener('click', () => {
    try {
      downloadTextFile(`budgetapp-backup-${todayIso()}.json`, exportStateJson(), 'application/json')
      setStatus('Backup exported.')
    } catch { setStatus('Could not export backup.') }
  })

  importBtn.addEventListener('click', () => { importInput.value = ''; importInput.click() })

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0]
    if (!file) return
    const ok = window.confirm('Importing a backup will overwrite your current data on this device. Continue?')
    if (!ok) return
    try {
      const text = await file.text()
      state = importStateJson(text)
      const t = todayIso()
      const r = rolloverMonthIfNeeded(state, t)
      if (r.changed) saveState(state)
      baseInput.value = formatMoney(state.base_amount)
      applyThemeLocal(state.theme ?? 'light')
      selectedExpenseStateIndex = null
      selectedRecurringId = null
      clearHistorySelection()
      recomputeAndRender({ save: false })
      setTab('today')
      setStatus('Backup imported.')
    } catch { setStatus('Import failed. Please select a valid BudgetApp JSON backup.') }
  })

  // ── Initial render ────────────────────────────────────────────────────────
  recomputeAndRender({ save: false })
  setTab('today')
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.body.classList.toggle('dark', theme === 'dark')
}
