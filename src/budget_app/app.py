from __future__ import annotations

from datetime import date
import os
from pathlib import Path
import sys
import tkinter as tk
from tkinter import ttk

from .logic import (
    BudgetState,
    Expense,
    compute_conservative_carryover_per_day,
    compute_days_in_month,
    compute_overspend_debt_for_month,
    compute_remaining_days_in_month,
    compute_spend_per_day,
    expenses_for_date,
    expenses_for_month,
    sum_expenses,
)
from .storage import load_state, save_state
from .storage import data_path, ensure_state_file, rollover_month_if_needed


class BudgetApp(ttk.Frame):
    def __init__(self, master: tk.Misc):
        super().__init__(master, padding=12)
        self.master = master

        self.state: BudgetState = load_state()
        ensure_state_file(self.state)
        if rollover_month_if_needed(self.state):
            save_state(self.state)

        self.base_var = tk.StringVar(value=self._format_money(self.state.base_amount))
        self.remaining_days_var = tk.StringVar(value="")
        self.per_day_var = tk.StringVar(value="")

        self.spent_today_var = tk.StringVar(value="")
        self.remaining_today_var = tk.StringVar(value="")
        self.spent_month_var = tk.StringVar(value="")
        self.remaining_month_var = tk.StringVar(value="")
        self.saved_last_month_var = tk.StringVar(value="")

        self.expense_amount_var = tk.StringVar(value="")
        self.expense_note_var = tk.StringVar(value="")

        self.history_date_var = tk.StringVar(value=date.today().isoformat())
        self.history_amount_var = tk.StringVar(value="")
        self.history_note_var = tk.StringVar(value="")
        self.status_var = tk.StringVar(value="")

        self._today_expense_indices: list[int] = []
        self._history_expense_indices: list[int] = []
        self.delete_expense_btn: ttk.Button | None = None
        self.history_add_btn: ttk.Button | None = None
        self.history_save_btn: ttk.Button | None = None
        self.history_delete_btn: ttk.Button | None = None

        self._build_ui()
        self._recompute_and_render(save=False)

    def _build_ui(self) -> None:
        self.master.title("BudgetApp")
        self.master.minsize(460, 520)

        menubar = tk.Menu(self.master)
        file_menu = tk.Menu(menubar, tearoff=0)
        file_menu.add_command(label="Config...", command=self._open_config)
        file_menu.add_separator()
        file_menu.add_command(label="Exit", command=self.master.destroy)
        menubar.add_cascade(label="File", menu=file_menu)
        self.master.config(menu=menubar)

        self.columnconfigure(1, weight=1)

        title = ttk.Label(self, text="Budget per day", font=("Segoe UI", 14, "bold"))
        title.grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 10))

        base_label = ttk.Label(self, text="Base amount")
        base_label.grid(row=1, column=0, sticky="w")

        base_entry = ttk.Entry(self, textvariable=self.base_var)
        base_entry.grid(row=1, column=1, sticky="ew")
        base_entry.bind("<Return>", lambda _e: self._on_recalculate())

        btn_row = ttk.Frame(self)
        btn_row.grid(row=2, column=0, columnspan=2, sticky="w", pady=(10, 10))

        recalc_btn = ttk.Button(btn_row, text="Recalculate", command=self._on_recalculate)
        recalc_btn.pack(side="left")

        save_btn = ttk.Button(btn_row, text="Save", command=self._on_save)
        save_btn.pack(side="left", padx=(8, 0))

        sep = ttk.Separator(self)
        sep.grid(row=3, column=0, columnspan=2, sticky="ew", pady=(8, 8))

        daily_title = ttk.Label(self, text="Daily", font=("Segoe UI", 10, "bold"))
        daily_title.grid(row=4, column=0, columnspan=2, sticky="w")

        days_label = ttk.Label(self, text="Remaining days (incl. today)")
        days_label.grid(row=5, column=0, sticky="w", pady=(6, 0))
        days_value = ttk.Label(self, textvariable=self.remaining_days_var)
        days_value.grid(row=5, column=1, sticky="w", pady=(6, 0))

        per_day_label = ttk.Label(self, text="You can spend per day")
        per_day_label.grid(row=6, column=0, sticky="w", pady=(4, 0))
        per_day_value = ttk.Label(self, textvariable=self.per_day_var, font=("Segoe UI", 11, "bold"))
        per_day_value.grid(row=6, column=1, sticky="w", pady=(4, 0))

        spent_today_label = ttk.Label(self, text="Spent today")
        spent_today_label.grid(row=7, column=0, sticky="w", pady=(4, 0))
        spent_today_value = ttk.Label(self, textvariable=self.spent_today_var)
        spent_today_value.grid(row=7, column=1, sticky="w", pady=(4, 0))

        remaining_today_label = ttk.Label(self, text="Remaining today")
        remaining_today_label.grid(row=8, column=0, sticky="w", pady=(6, 0))
        remaining_today_value = ttk.Label(self, textvariable=self.remaining_today_var, font=("Segoe UI", 14, "bold"))
        remaining_today_value.grid(row=8, column=1, sticky="w", pady=(6, 0))

        daily_sep = ttk.Separator(self)
        daily_sep.grid(row=9, column=0, columnspan=2, sticky="ew", pady=(10, 8))

        month_title = ttk.Label(self, text="This month", font=("Segoe UI", 10, "bold"))
        month_title.grid(row=10, column=0, columnspan=2, sticky="w")

        spent_month_label = ttk.Label(self, text="Spent this month")
        spent_month_label.grid(row=11, column=0, sticky="w", pady=(6, 0))
        spent_month_value = ttk.Label(self, textvariable=self.spent_month_var)
        spent_month_value.grid(row=11, column=1, sticky="w", pady=(6, 0))

        remaining_month_label = ttk.Label(self, text="Remaining this month")
        remaining_month_label.grid(row=12, column=0, sticky="w", pady=(4, 0))
        remaining_month_value = ttk.Label(self, textvariable=self.remaining_month_var)
        remaining_month_value.grid(row=12, column=1, sticky="w", pady=(4, 0))

        month_sep = ttk.Separator(self)
        month_sep.grid(row=13, column=0, columnspan=2, sticky="ew", pady=(10, 8))

        last_month_title = ttk.Label(self, text="Last month", font=("Segoe UI", 10, "bold"))
        last_month_title.grid(row=14, column=0, columnspan=2, sticky="w")

        saved_last_month_label = ttk.Label(self, text="Amount saved last month")
        saved_last_month_label.grid(row=15, column=0, sticky="w", pady=(6, 0))
        saved_last_month_value = ttk.Label(self, textvariable=self.saved_last_month_var)
        saved_last_month_value.grid(row=15, column=1, sticky="w", pady=(6, 0))

        entry_sep = ttk.Separator(self)
        entry_sep.grid(row=16, column=0, columnspan=2, sticky="ew", pady=(10, 8))

        notebook = ttk.Notebook(self)
        notebook.grid(row=17, column=0, columnspan=2, sticky="nsew")
        self.rowconfigure(17, weight=1)

        today_tab = ttk.Frame(notebook, padding=0)
        history_tab = ttk.Frame(notebook, padding=0)
        notebook.add(today_tab, text="Today")
        notebook.add(history_tab, text="History")

        # --- Today tab ---
        exp_title = ttk.Label(today_tab, text="Enter an expense (today)")
        exp_title.grid(row=0, column=0, columnspan=2, sticky="w")

        exp_amount_label = ttk.Label(today_tab, text="Amount")
        exp_amount_label.grid(row=1, column=0, sticky="w", pady=(6, 0))
        exp_amount_entry = ttk.Entry(today_tab, textvariable=self.expense_amount_var)
        exp_amount_entry.grid(row=1, column=1, sticky="ew", pady=(6, 0))
        exp_amount_entry.bind("<Return>", lambda _e: self._on_add_expense())

        exp_note_label = ttk.Label(today_tab, text="Note (optional)")
        exp_note_label.grid(row=2, column=0, sticky="w", pady=(6, 0))
        exp_note_entry = ttk.Entry(today_tab, textvariable=self.expense_note_var)
        exp_note_entry.grid(row=2, column=1, sticky="ew", pady=(6, 0))
        exp_note_entry.bind("<Return>", lambda _e: self._on_add_expense())

        add_btn = ttk.Button(today_tab, text="Add expense", command=self._on_add_expense)
        add_btn.grid(row=3, column=1, sticky="e", pady=(8, 0))

        list_label = ttk.Label(today_tab, text="Today’s expenses")
        list_label.grid(row=4, column=0, columnspan=2, sticky="w", pady=(10, 4))

        self.expenses_list = tk.Listbox(today_tab, height=7)
        self.expenses_list.grid(row=5, column=0, columnspan=2, sticky="nsew")
        self.expenses_list.bind("<<ListboxSelect>>", lambda _e: self._update_delete_button_state())
        today_tab.columnconfigure(1, weight=1)
        today_tab.rowconfigure(5, weight=1)

        self.delete_expense_btn = ttk.Button(today_tab, text="Delete selected", command=self._on_delete_expense)
        self.delete_expense_btn.grid(row=6, column=1, sticky="e", pady=(8, 0))
        self._update_delete_button_state()

        # --- History tab ---
        hist_title = ttk.Label(history_tab, text="Add / edit expenses (this month)")
        hist_title.grid(row=0, column=0, columnspan=3, sticky="w")

        hist_date_label = ttk.Label(history_tab, text="Date (YYYY-MM-DD)")
        hist_date_label.grid(row=1, column=0, sticky="w", pady=(6, 0))
        hist_date_entry = ttk.Entry(history_tab, textvariable=self.history_date_var)
        hist_date_entry.grid(row=1, column=1, sticky="ew", pady=(6, 0))
        hist_date_entry.bind("<Return>", lambda _e: self._on_history_load_date())
        hist_load_btn = ttk.Button(history_tab, text="Load", command=self._on_history_load_date)
        hist_load_btn.grid(row=1, column=2, sticky="e", pady=(6, 0))

        hist_list_label = ttk.Label(history_tab, text="Expenses for selected day")
        hist_list_label.grid(row=2, column=0, columnspan=3, sticky="w", pady=(10, 4))

        self.history_list = tk.Listbox(history_tab, height=7)
        self.history_list.grid(row=3, column=0, columnspan=3, sticky="nsew")
        self.history_list.bind("<<ListboxSelect>>", lambda _e: self._on_history_select())

        hist_amount_label = ttk.Label(history_tab, text="Amount")
        hist_amount_label.grid(row=4, column=0, sticky="w", pady=(10, 0))
        hist_amount_entry = ttk.Entry(history_tab, textvariable=self.history_amount_var)
        hist_amount_entry.grid(row=4, column=1, columnspan=2, sticky="ew", pady=(10, 0))
        hist_amount_entry.bind("<Return>", lambda _e: self._on_history_add())

        hist_note_label = ttk.Label(history_tab, text="Note (optional)")
        hist_note_label.grid(row=5, column=0, sticky="w", pady=(6, 0))
        hist_note_entry = ttk.Entry(history_tab, textvariable=self.history_note_var)
        hist_note_entry.grid(row=5, column=1, columnspan=2, sticky="ew", pady=(6, 0))
        hist_note_entry.bind("<Return>", lambda _e: self._on_history_add())

        btn_row = ttk.Frame(history_tab)
        btn_row.grid(row=6, column=0, columnspan=3, sticky="e", pady=(10, 0))

        self.history_add_btn = ttk.Button(btn_row, text="Add to this day", command=self._on_history_add)
        self.history_add_btn.pack(side="left")
        self.history_save_btn = ttk.Button(btn_row, text="Save changes", command=self._on_history_save)
        self.history_save_btn.pack(side="left", padx=(8, 0))
        self.history_delete_btn = ttk.Button(btn_row, text="Delete selected", command=self._on_history_delete)
        self.history_delete_btn.pack(side="left", padx=(8, 0))

        history_tab.columnconfigure(1, weight=1)
        history_tab.rowconfigure(3, weight=1)

        status = ttk.Label(self, textvariable=self.status_var)
        status.grid(row=18, column=0, columnspan=2, sticky="w", pady=(12, 0))

        self.pack(fill="both", expand=True)

        self._on_history_load_date()

    def _open_config(self) -> None:
        ensure_state_file(self.state)
        path = data_path()
        try:
            os.startfile(str(path.parent))  # type: ignore[attr-defined]
        except OSError as e:
            self.status_var.set(f"Could not open config: {e}")

    def _parse_money(self, value: str) -> float | None:
        raw = value.strip().replace(",", "")
        if not raw:
            return None
        try:
            return float(raw)
        except ValueError:
            return None

    def _format_money(self, amount: float) -> str:
        return f"{amount:.2f}"

    def _parse_iso_date(self, value: str) -> date | None:
        raw = value.strip()
        if not raw:
            return None
        try:
            return date.fromisoformat(raw)
        except ValueError:
            return None

    def _is_current_month(self, d: date) -> bool:
        today = date.today()
        return d.year == today.year and d.month == today.month

    def _render_history_expenses(self, target: date) -> None:
        if not hasattr(self, "history_list"):
            return

        self.history_list.delete(0, tk.END)
        self._history_expense_indices.clear()

        target_iso = target.isoformat()
        for idx, exp in enumerate(self.state.expenses):
            if exp.date != target_iso:
                continue
            note = f" — {exp.note}" if exp.note else ""
            self.history_list.insert(tk.END, f"{self._format_money(exp.amount)}{note}")
            self._history_expense_indices.append(idx)

        self._update_history_button_state()

    def _update_history_button_state(self) -> None:
        if not self.history_save_btn or not self.history_delete_btn:
            return

        sel = self.history_list.curselection() if hasattr(self, "history_list") else ()
        if not sel:
            self.history_save_btn.state(["disabled"])
            self.history_delete_btn.state(["disabled"])
            return

        self.history_save_btn.state(["!disabled"])
        self.history_delete_btn.state(["!disabled"])

    def _on_history_load_date(self) -> None:
        d = self._parse_iso_date(self.history_date_var.get())
        if d is None:
            self.status_var.set("Enter a valid date (YYYY-MM-DD).")
            self._render_history_expenses(date.today())
            return

        if not self._is_current_month(d):
            self.status_var.set("Pick a date in the current month.")
            self._render_history_expenses(date.today())
            return

        self.status_var.set("")
        self._render_history_expenses(d)

    def _on_history_select(self) -> None:
        sel = self.history_list.curselection()
        if not sel:
            self._update_history_button_state()
            return

        list_idx = int(sel[0])
        if list_idx < 0 or list_idx >= len(self._history_expense_indices):
            self._update_history_button_state()
            return

        state_idx = self._history_expense_indices[list_idx]
        if state_idx < 0 or state_idx >= len(self.state.expenses):
            self._update_history_button_state()
            return

        exp = self.state.expenses[state_idx]
        self.history_amount_var.set(self._format_money(exp.amount))
        self.history_note_var.set(exp.note or "")
        self._update_history_button_state()

    def _on_history_add(self) -> None:
        d = self._parse_iso_date(self.history_date_var.get())
        if d is None or not self._is_current_month(d):
            self.status_var.set("Pick a date in the current month.")
            return

        amount = self._parse_money(self.history_amount_var.get())
        if amount is None or amount <= 0:
            self.status_var.set("Enter a positive expense amount.")
            return

        note = self.history_note_var.get().strip()
        exp = Expense(date=d.isoformat(), amount=amount, note=note)
        self.state.expenses.append(exp)
        save_state(self.state)

        self.history_amount_var.set("")
        self.history_note_var.set("")
        self.history_list.selection_clear(0, tk.END)

        self._recompute_and_render(save=False)
        self._render_history_expenses(d)
        if not self.status_var.get():
            self.status_var.set("Added.")

    def _on_history_save(self) -> None:
        d = self._parse_iso_date(self.history_date_var.get())
        if d is None or not self._is_current_month(d):
            self.status_var.set("Pick a date in the current month.")
            return

        sel = self.history_list.curselection()
        if not sel:
            self.status_var.set("Select an expense to edit.")
            return

        list_idx = int(sel[0])
        if list_idx < 0 or list_idx >= len(self._history_expense_indices):
            self.status_var.set("Select an expense to edit.")
            return

        state_idx = self._history_expense_indices[list_idx]
        if state_idx < 0 or state_idx >= len(self.state.expenses):
            self.status_var.set("Select an expense to edit.")
            return

        amount = self._parse_money(self.history_amount_var.get())
        if amount is None or amount <= 0:
            self.status_var.set("Enter a positive expense amount.")
            return

        note = self.history_note_var.get().strip()
        exp = self.state.expenses[state_idx]
        if exp.date != d.isoformat():
            self.status_var.set("Select an expense from the loaded date.")
            self._render_history_expenses(d)
            return

        exp.amount = amount
        exp.note = note
        save_state(self.state)

        self._recompute_and_render(save=False)
        self._render_history_expenses(d)
        if not self.status_var.get():
            self.status_var.set("Saved changes.")

    def _on_history_delete(self) -> None:
        d = self._parse_iso_date(self.history_date_var.get())
        if d is None or not self._is_current_month(d):
            self.status_var.set("Pick a date in the current month.")
            return

        sel = self.history_list.curselection()
        if not sel:
            self.status_var.set("Select an expense to delete.")
            return

        list_idx = int(sel[0])
        if list_idx < 0 or list_idx >= len(self._history_expense_indices):
            self.status_var.set("Select an expense to delete.")
            return

        state_idx = self._history_expense_indices[list_idx]
        if state_idx < 0 or state_idx >= len(self.state.expenses):
            self.status_var.set("Select an expense to delete.")
            return

        exp = self.state.expenses[state_idx]
        if exp.date != d.isoformat():
            self.status_var.set("Select an expense from the loaded date.")
            self._render_history_expenses(d)
            return

        self.state.expenses.pop(state_idx)
        save_state(self.state)

        self.history_amount_var.set("")
        self.history_note_var.set("")
        self.history_list.selection_clear(0, tk.END)

        self._recompute_and_render(save=False)
        self._render_history_expenses(d)
        if not self.status_var.get():
            self.status_var.set("Deleted.")

    def _render_today_expenses(self, today: date) -> None:
        self.expenses_list.delete(0, tk.END)

        self._today_expense_indices.clear()
        today_iso = today.isoformat()
        for idx, exp in enumerate(self.state.expenses):
            if exp.date != today_iso:
                continue
            note = f" — {exp.note}" if exp.note else ""
            self.expenses_list.insert(tk.END, f"{self._format_money(exp.amount)}{note}")
            self._today_expense_indices.append(idx)

        self._update_delete_button_state()

    def _update_delete_button_state(self) -> None:
        if not self.delete_expense_btn:
            return
        sel = self.expenses_list.curselection()
        if not sel:
            self.delete_expense_btn.state(["disabled"])
            return
        if not self._today_expense_indices:
            self.delete_expense_btn.state(["disabled"])
            return
        self.delete_expense_btn.state(["!disabled"])

    def _recompute_and_render(self, *, save: bool) -> None:
        base = self._parse_money(self.base_var.get())
        if base is None:
            self.status_var.set("Enter a valid number (example: 1000 or 1000.00).")
            self.remaining_days_var.set("")
            self.per_day_var.set("")
            self.spent_today_var.set("")
            self.remaining_today_var.set("")
            self.spent_month_var.set("")
            return

        today = date.today()
        days_in_month = compute_days_in_month(today)
        remaining_days = compute_remaining_days_in_month(today)
        today_spent = sum_expenses(expenses_for_date(self.state.expenses, today))
        month_spent = sum_expenses(expenses_for_month(self.state.expenses, today.year, today.month))

        baseline_per_day = compute_spend_per_day(base, days_in_month)
        overspend_debt = compute_overspend_debt_for_month(
            self.state.expenses,
            year=today.year,
            month=today.month,
            through_date_exclusive=today,
            baseline_per_day=baseline_per_day,
        )
        per_day = compute_conservative_carryover_per_day(
            base,
            days_in_month=days_in_month,
            remaining_days_incl_today=remaining_days,
            overspend_debt=overspend_debt,
        )

        today_remaining = per_day - today_spent
        month_remaining = base - month_spent

        self.remaining_days_var.set(str(remaining_days))
        self.per_day_var.set(self._format_money(per_day))
        self.spent_today_var.set(self._format_money(today_spent))
        self.remaining_today_var.set(self._format_money(today_remaining))
        self.spent_month_var.set(self._format_money(month_spent))
        self.remaining_month_var.set(self._format_money(month_remaining))
        self.saved_last_month_var.set(self._format_money(self.state.last_month_saved))
        self._render_today_expenses(today)

        # Keep history tab in sync if it exists.
        if hasattr(self, "history_list"):
            hist_date = self._parse_iso_date(self.history_date_var.get())
            if hist_date is not None and self._is_current_month(hist_date):
                self._render_history_expenses(hist_date)

        self.state.base_amount = base
        if save:
            month_key = f"{today.year:04d}-{today.month:02d}"
            self.state.monthly_bases[month_key] = base
            save_state(self.state)
            self.status_var.set("Saved.")
        else:
            if today_remaining < 0:
                self.status_var.set(f"Over today’s allowance by {self._format_money(-today_remaining)}.")
            else:
                self.status_var.set("")

    def _on_recalculate(self) -> None:
        self._recompute_and_render(save=False)

    def _on_save(self) -> None:
        self._recompute_and_render(save=True)

    def _on_add_expense(self) -> None:
        amount = self._parse_money(self.expense_amount_var.get())
        if amount is None or amount <= 0:
            self.status_var.set("Enter a positive expense amount.")
            return

        note = self.expense_note_var.get().strip()
        exp = Expense(date=date.today().isoformat(), amount=amount, note=note)
        self.state.expenses.append(exp)
        save_state(self.state)

        self.expense_amount_var.set("")
        self.expense_note_var.set("")

        self._recompute_and_render(save=False)

    def _on_delete_expense(self) -> None:
        sel = self.expenses_list.curselection()
        if not sel:
            self.status_var.set("Select an expense to delete.")
            return

        list_idx = int(sel[0])
        if list_idx < 0 or list_idx >= len(self._today_expense_indices):
            self.status_var.set("Select an expense to delete.")
            return

        state_idx = self._today_expense_indices[list_idx]
        if state_idx < 0 or state_idx >= len(self.state.expenses):
            self.status_var.set("Select an expense to delete.")
            return

        self.state.expenses.pop(state_idx)
        save_state(self.state)
        self.expenses_list.selection_clear(0, tk.END)
        self._recompute_and_render(save=False)
        if not self.status_var.get():
            self.status_var.set("Deleted.")


def main() -> int:
    root = tk.Tk()

    icon_path: str
    if getattr(sys, "_MEIPASS", None):
        icon_path = str(Path(sys._MEIPASS) / "Resources" / "BA_Logo_Final.ico")
    else:
        # repo_root/Resources/BA_Logo_Final.ico
        icon_path = str(Path(__file__).resolve().parents[3] / "Resources" / "BA_Logo_Final.ico")
    try:
        root.iconbitmap(default=icon_path)
    except Exception:
        pass

    try:
        ttk.Style().theme_use("clam")
    except tk.TclError:
        pass
    BudgetApp(root)
    root.mainloop()
    return 0
