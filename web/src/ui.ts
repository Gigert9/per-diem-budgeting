import type { BudgetState, Expense } from './types'
import {
  computeDaysInMonth,
  computeNoRewardSpendPerDay,
  computeOverspendDebt,
  computeRemainingDaysInMonth,
  computeSpendPerDay,
  expensesForDate,
  expensesForMonth,
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

function monthKeyFromIso(iso: string): string {
  return iso.slice(0, 7)
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

  const container = el('div', 'container')
  root.appendChild(container)

  const header = el('div', 'header')
  const logo = el('img', 'logo') as HTMLImageElement
  logo.alt = 'BudgetApp'
  logo.src = `${import.meta.env.BASE_URL}icons/icon-192.png`
  header.appendChild(logo)
  const title = el('h1', 'title')
  title.textContent = 'Budget per day'
  header.appendChild(title)
  container.appendChild(header)

  const actions = el('div', 'actions')
  const installBtn = el('button') as HTMLButtonElement
  installBtn.textContent = 'Install'
  installBtn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('budgetapp:installClick'))
  })
  actions.appendChild(installBtn)
  container.appendChild(actions)

  const isStandalone = (): boolean => {
    // iOS Safari
    // @ts-expect-error - navigator.standalone exists on iOS
    if (typeof navigator.standalone === 'boolean') return navigator.standalone
    return window.matchMedia('(display-mode: standalone)').matches
  }

  const isInstalled = (): boolean => {
    if (isStandalone()) return true
    try {
      return localStorage.getItem(installedKey) === '1'
    } catch {
      return false
    }
  }

  const updateInstallUi = (): void => {
    actions.style.display = isInstalled() ? 'none' : 'flex'
  }

  updateInstallUi()

  window.addEventListener('budgetapp:canInstall', (e: any) => {
    const can = Boolean(e?.detail)
    installBtn.dataset.canInstall = can ? '1' : '0'
  })

  window.addEventListener('budgetapp:installed', () => {
    updateInstallUi()
  })

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
      <p>If you don’t see an install prompt:</p>
      <p>1) Open the browser menu (⋮)</p>
      <p>2) Tap <strong>Install app</strong> or <strong>Add to Home screen</strong></p>
    `
  }

  const closeHelp = el('button') as HTMLButtonElement
  closeHelp.textContent = 'Close'
  closeHelp.addEventListener('click', () => {
    installHelpBackdrop.style.display = 'none'
  })
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

  // Base amount + save
  const baseCard = el('div', 'card')
  const baseRow = el('div', 'row')
  const baseField = el('div')
  const baseLabel = el('label')
  baseLabel.textContent = 'Base amount'
  const baseInput = el('input') as HTMLInputElement
  baseInput.inputMode = 'decimal'
  baseInput.value = formatMoney(state.base_amount)
  baseField.appendChild(baseLabel)
  baseField.appendChild(baseInput)
  baseRow.appendChild(baseField)

  const baseButtons = el('div')
  baseButtons.style.display = 'flex'
  baseButtons.style.gap = '8px'
  baseButtons.style.alignItems = 'end'

  const recalcBtn = el('button') as HTMLButtonElement
  recalcBtn.textContent = 'Recalculate'
  const saveBtn = el('button', 'primary') as HTMLButtonElement
  saveBtn.textContent = 'Save'
  baseButtons.appendChild(recalcBtn)
  baseButtons.appendChild(saveBtn)
  baseRow.appendChild(baseButtons)
  baseCard.appendChild(baseRow)
  container.appendChild(baseCard)

  const metricsCard = el('div', 'card')
  const metricsRoot = el('div', 'metricsRoot')
  metricsCard.appendChild(metricsRoot)
  container.appendChild(metricsCard)

  // Tabs (minimal, mobile-friendly)
  const tabs = el('div', 'tabs')
  const tabTodayBtn = el('button', 'primary') as HTMLButtonElement
  tabTodayBtn.textContent = 'Today'
  const tabHistoryBtn = el('button') as HTMLButtonElement
  tabHistoryBtn.textContent = 'History'
  tabs.appendChild(tabTodayBtn)
  tabs.appendChild(tabHistoryBtn)
  container.appendChild(tabs)

  // Today
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
  todayListTitle.style.marginTop = '12px'
  todayListTitle.style.fontWeight = '700'
  todayListTitle.textContent = "Today’s expenses"
  expenseCard.appendChild(todayListTitle)

  const list = el('ul', 'list')
  expenseCard.appendChild(list)

  const deleteExpenseBtn = el('button') as HTMLButtonElement
  deleteExpenseBtn.textContent = 'Delete selected'
  deleteExpenseBtn.disabled = true
  deleteExpenseBtn.style.marginTop = '10px'
  expenseCard.appendChild(deleteExpenseBtn)

  container.appendChild(expenseCard)

  // History
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
    const monthKey = monthKeyFromIso(nowIso)
    const daysInMonth = computeDaysInMonth(nowIso)
    historyDateInput.min = `${monthKey}-01`
    historyDateInput.max = `${monthKey}-${String(daysInMonth).padStart(2, '0')}`
  }
  historyDateField.appendChild(historyDateLabel)
  historyDateField.appendChild(historyDateInput)
  historyRow.appendChild(historyDateField)
  historyCard.appendChild(historyRow)

  const historyListTitle = el('div')
  historyListTitle.style.marginTop = '12px'
  historyListTitle.style.fontWeight = '700'
  historyListTitle.textContent = 'Expenses for selected day'
  historyCard.appendChild(historyListTitle)

  const historyList = el('ul', 'list')
  historyCard.appendChild(historyList)

  const historyEditTitle = el('div')
  historyEditTitle.style.marginTop = '12px'
  historyEditTitle.style.fontWeight = '700'
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
  historyButtons.appendChild(historyAddBtn)
  historyButtons.appendChild(historySaveBtn)
  historyButtons.appendChild(historyDeleteBtn)
  historyCard.appendChild(historyButtons)

  container.appendChild(historyCard)

  // Backup (export/import)
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

  let selectedExpenseStateIndex: number | null = null
  let selectedHistoryExpenseStateIndex: number | null = null

  function setStatus(msg: string): void {
    status.textContent = msg
  }

  function downloadTextFile(filename: string, content: string, mime: string): void {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function upsertMetric(parent: HTMLElement, labelText: string, valueText: string, opts?: { important?: boolean, fullWidth?: boolean }): void {
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

  function createMetricsSection(titleText: string): { section: HTMLElement, grid: HTMLElement } {
    const section = el('div', 'metricsSection')
    const t = el('div', 'metricsSectionTitle')
    t.textContent = titleText
    const grid = el('div', 'metrics')
    section.appendChild(t)
    section.appendChild(grid)
    return { section, grid }
  }

  function setTab(tab: 'today' | 'history'): void {
    if (tab === 'today') {
      tabTodayBtn.classList.add('primary')
      tabHistoryBtn.classList.remove('primary')
      expenseCard.style.display = ''
      historyCard.style.display = 'none'
      updateDeleteExpenseUi(todayIso())
      return
    }

    tabHistoryBtn.classList.add('primary')
    tabTodayBtn.classList.remove('primary')
    expenseCard.style.display = 'none'
    historyCard.style.display = ''
    renderHistoryList(historyDateInput.value || todayIso())
  }

  tabTodayBtn.addEventListener('click', () => setTab('today'))
  tabHistoryBtn.addEventListener('click', () => setTab('history'))

  function updateDeleteExpenseUi(nowIso: string): void {
    if (selectedExpenseStateIndex === null) {
      deleteExpenseBtn.disabled = true
      return
    }
    const exp = state.expenses[selectedExpenseStateIndex]
    deleteExpenseBtn.disabled = !(exp && exp.date === nowIso)
  }

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

  function renderTodayList(nowIso: string): void {
    list.innerHTML = ''
    const todayItems: Array<{ exp: Expense, stateIndex: number }> = []
    for (let i = 0; i < state.expenses.length; i++) {
      const exp = state.expenses[i]
      if (exp.date === nowIso) todayItems.push({ exp, stateIndex: i })
    }

    for (const item of todayItems) {
      const e = item.exp
      const li = el('li')
      const note = e.note ? ` — ${e.note}` : ''
      li.textContent = `${formatMoney(e.amount)}${note}`
      if (selectedExpenseStateIndex === item.stateIndex) li.classList.add('selected')
      li.addEventListener('click', () => {
        selectedExpenseStateIndex = item.stateIndex
        renderTodayList(nowIso)
      })
      list.appendChild(li)
    }

    if (selectedExpenseStateIndex !== null) {
      const selected = state.expenses[selectedExpenseStateIndex]
      if (!selected || selected.date !== nowIso) selectedExpenseStateIndex = null
    }
    updateDeleteExpenseUi(nowIso)
  }

  function renderHistoryList(isoDate: string): void {
    historyList.innerHTML = ''
    const items: Array<{ exp: Expense, stateIndex: number }> = []
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
      const note = item.exp.note ? ` — ${item.exp.note}` : ''
      li.textContent = `${formatMoney(item.exp.amount)}${note}`
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
      const selected = state.expenses[selectedHistoryExpenseStateIndex]
      if (!selected || selected.date !== isoDate) clearHistorySelection()
    }
    updateHistoryEditUi()
  }

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
      return
    }

    const now = todayIso()
    const daysInMonth = computeDaysInMonth(now)
    const remainingDays = computeRemainingDaysInMonth(now)
    const todaySpent = sumExpenses(expensesForDate(state.expenses, now))
    const monthKey = monthKeyFromIso(now)
    const monthSpent = sumExpenses(expensesForMonth(state.expenses, monthKey))
    const baselinePerDay = computeSpendPerDay(base, daysInMonth)
    const overspendDebt = computeOverspendDebt(state.expenses, monthKey, now, baselinePerDay)
    const perDay = computeNoRewardSpendPerDay(base, daysInMonth, remainingDays, overspendDebt)

    const todayRemaining = perDay - todaySpent
    const monthRemaining = base - monthSpent

    metricsRoot.innerHTML = ''

    const daily = createMetricsSection('Daily')
    upsertMetric(daily.grid, 'Remaining days (incl. today)', String(remainingDays))
    upsertMetric(daily.grid, 'You can spend per day', formatMoney(perDay))
    upsertMetric(daily.grid, 'Spent today', formatMoney(todaySpent))
    upsertMetric(daily.grid, 'Remaining today', formatMoney(todayRemaining), { important: true, fullWidth: true })
    metricsRoot.appendChild(daily.section)

    const month = createMetricsSection('This month')
    upsertMetric(month.grid, 'Spent this month', formatMoney(monthSpent))
    upsertMetric(month.grid, 'Remaining this month', formatMoney(monthRemaining))
    metricsRoot.appendChild(month.section)

    const lastMonth = createMetricsSection('Last month')
    upsertMetric(lastMonth.grid, 'Amount saved last month', formatMoney(state.last_month_saved ?? 0))
    metricsRoot.appendChild(lastMonth.section)

    renderTodayList(now)

    if (historyCard.style.display !== 'none') {
      renderHistoryList(historyDateInput.value || now)
    }

    state.base_amount = base
    if (!state.monthly_bases) state.monthly_bases = {}
    if (opts.save) {
      state.monthly_bases[monthKey] = base
      saveState(state)
      setStatus('Saved.')
    } else {
      if (todayRemaining < 0) {
        setStatus(`Over today’s allowance by ${formatMoney(-todayRemaining)}.`)
      } else {
        setStatus('')
      }
    }
  }

  recalcBtn.addEventListener('click', () => recomputeAndRender({ save: false }))
  saveBtn.addEventListener('click', () => recomputeAndRender({ save: true }))
  baseInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') recomputeAndRender({ save: false })
  })

  function addExpense(): void {
    const amount = parseMoney(amountInput.value)
    if (amount === null || amount <= 0) {
      setStatus('Enter a positive expense amount.')
      return
    }
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
  amountInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addExpense()
  })
  noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addExpense()
  })

  deleteExpenseBtn.addEventListener('click', () => {
    const nowIso = todayIso()
    if (selectedExpenseStateIndex === null) {
      setStatus('Select an expense to delete.')
      return
    }
    const exp = state.expenses[selectedExpenseStateIndex]
    if (!exp || exp.date !== nowIso) {
      selectedExpenseStateIndex = null
      renderTodayList(nowIso)
      setStatus('Select an expense from today to delete.')
      return
    }

    state.expenses.splice(selectedExpenseStateIndex, 1)
    saveState(state)
    selectedExpenseStateIndex = null
    recomputeAndRender({ save: false })
    if (!status.textContent) setStatus('Deleted.')
  })

  historyDateInput.addEventListener('change', () => {
    clearHistorySelection()
    renderHistoryList(historyDateInput.value || todayIso())
  })

  exportBtn.addEventListener('click', () => {
    try {
      const iso = todayIso()
      const filename = `budgetapp-backup-${iso}.json`
      downloadTextFile(filename, exportStateJson(), 'application/json')
      setStatus('Backup exported.')
    } catch {
      setStatus('Could not export backup.')
    }
  })

  importBtn.addEventListener('click', () => {
    importInput.value = ''
    importInput.click()
  })

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0]
    if (!file) return
    const ok = window.confirm('Importing a backup will overwrite your current data on this device. Continue?')
    if (!ok) return

    try {
      const text = await file.text()
      state = importStateJson(text)
      const today = todayIso()
      const rollover = rolloverMonthIfNeeded(state, today)
      if (rollover.changed) saveState(state)
      baseInput.value = formatMoney(state.base_amount)
      selectedExpenseStateIndex = null
      clearHistorySelection()
      recomputeAndRender({ save: false })
      setTab('today')
      setStatus('Backup imported.')
    } catch {
      setStatus('Import failed. Please select a valid BudgetApp JSON backup.')
    }
  })

  function addHistoryExpense(): void {
    const iso = historyDateInput.value || todayIso()
    const amount = parseMoney(historyAmountInput.value)
    if (amount === null || amount <= 0) {
      setStatus('Enter a positive expense amount.')
      return
    }
    const note = historyNoteInput.value.trim()
    const exp: Expense = { date: iso, amount, note: note || undefined }
    state.expenses.push(exp)
    saveState(state)
    clearHistorySelection()
    recomputeAndRender({ save: false })
    if (!status.textContent) setStatus('Added.')
  }

  function saveHistoryEdit(): void {
    const idx = selectedHistoryExpenseStateIndex
    if (idx === null) {
      setStatus('Select an expense to edit.')
      return
    }
    const iso = historyDateInput.value || todayIso()
    const exp = state.expenses[idx]
    if (!exp || exp.date !== iso) {
      clearHistorySelection()
      renderHistoryList(iso)
      setStatus('Select an expense from the list to edit.')
      return
    }

    const amount = parseMoney(historyAmountInput.value)
    if (amount === null || amount <= 0) {
      setStatus('Enter a positive expense amount.')
      return
    }

    const note = historyNoteInput.value.trim()
    exp.amount = amount
    exp.note = note || undefined
    saveState(state)
    recomputeAndRender({ save: false })
    if (!status.textContent) setStatus('Saved changes.')
  }

  historyAddBtn.addEventListener('click', addHistoryExpense)

  historySaveBtn.addEventListener('click', saveHistoryEdit)
  historyAmountInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveHistoryEdit()
  })
  historyNoteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveHistoryEdit()
  })

  historyDeleteBtn.addEventListener('click', () => {
    const idx = selectedHistoryExpenseStateIndex
    if (idx === null) {
      setStatus('Select an expense to delete.')
      return
    }
    const iso = historyDateInput.value || todayIso()
    const exp = state.expenses[idx]
    if (!exp || exp.date !== iso) {
      clearHistorySelection()
      renderHistoryList(iso)
      setStatus('Select an expense from the list to delete.')
      return
    }
    state.expenses.splice(idx, 1)
    saveState(state)
    clearHistorySelection()
    recomputeAndRender({ save: false })
    if (!status.textContent) setStatus('Deleted.')
  })

  // initial render
  recomputeAndRender({ save: false })
  setTab('today')
}
