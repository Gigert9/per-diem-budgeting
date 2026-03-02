import type { BudgetState, Expense } from './types'
import {
  computeConservativeCarryoverPerDay,
  computeRemainingDaysInMonth,
  expensesForDate,
  expensesForMonth,
  rolloverMonthIfNeeded,
  sumExpenses,
  todayIso
} from './logic'
import { loadState, saveState } from './storage'

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
    if (isInstalled()) {
      actions.style.display = 'none'
    } else {
      actions.style.display = 'flex'
    }
  }

  updateInstallUi()

  window.addEventListener('budgetapp:canInstall', (e: any) => {
    const can = Boolean(e?.detail)
    // Keep the button clickable even if the browser doesn't expose an install
    // prompt (we show instructions in that case).
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
  const metrics = el('div', 'metrics')
  metricsCard.appendChild(metrics)
  container.appendChild(metricsCard)

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
  container.appendChild(expenseCard)

  const status = el('div', 'status')
  container.appendChild(status)

  function setStatus(msg: string): void {
    status.textContent = msg
  }

  function upsertMetric(labelText: string, valueText: string): void {
    const item = el('div', 'metric')
    const l = el('div')
    l.textContent = labelText
    const v = el('div', 'value')
    v.textContent = valueText
    item.appendChild(l)
    item.appendChild(v)
    metrics.appendChild(item)
  }

  function renderTodayList(expenses: Expense[]): void {
    list.innerHTML = ''
    for (const e of expenses) {
      const li = el('li')
      const note = e.note ? ` — ${e.note}` : ''
      li.textContent = `${formatMoney(e.amount)}${note}`
      list.appendChild(li)
    }
  }

  function recomputeAndRender(opts: { save: boolean }): void {
    const base = parseMoney(baseInput.value)
    if (base === null) {
      setStatus('Enter a valid number (example: 1000 or 1000.00).')
      metrics.innerHTML = ''
      list.innerHTML = ''
      return
    }

    const now = todayIso()
    const remainingDays = computeRemainingDaysInMonth(now)
    const todaySpent = sumExpenses(expensesForDate(state.expenses, now))
    const monthKey = monthKeyFromIso(now)
    const monthSpent = sumExpenses(expensesForMonth(state.expenses, monthKey))
    const monthSpentBeforeToday = monthSpent - todaySpent
    const perDay = computeConservativeCarryoverPerDay(base, remainingDays, monthSpentBeforeToday)
    const todayRemaining = perDay - todaySpent
    const monthRemaining = base - monthSpent

    metrics.innerHTML = ''
    upsertMetric('Remaining days (incl. today)', String(remainingDays))
    upsertMetric('You can spend per day', formatMoney(perDay))
    upsertMetric('Spent today', formatMoney(todaySpent))
    upsertMetric('Remaining today', formatMoney(todayRemaining))
    upsertMetric('Spent this month', formatMoney(monthSpent))
    upsertMetric('Remaining this month', formatMoney(monthRemaining))
    upsertMetric('Amount saved last month', formatMoney(state.last_month_saved ?? 0))

    renderTodayList(expensesForDate(state.expenses, now))

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

  // initial render
  recomputeAndRender({ save: false })
}
