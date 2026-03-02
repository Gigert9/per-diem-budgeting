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
    compute_remaining_days_in_month,
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
        self.status_var = tk.StringVar(value="")

        self._today_expense_indices: list[int] = []
        self.delete_expense_btn: ttk.Button | None = None

        self._build_ui()
        self._recompute_and_render(save=False)

    def _build_ui(self) -> None:
        self.master.title("BudgetApp")
        self.master.minsize(460, 420)

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

        days_label = ttk.Label(self, text="Remaining days (incl. today)")
        days_label.grid(row=4, column=0, sticky="w")
        days_value = ttk.Label(self, textvariable=self.remaining_days_var)
        days_value.grid(row=4, column=1, sticky="w")

        per_day_label = ttk.Label(self, text="You can spend per day")
        per_day_label.grid(row=5, column=0, sticky="w", pady=(6, 0))
        per_day_value = ttk.Label(self, textvariable=self.per_day_var, font=("Segoe UI", 11, "bold"))
        per_day_value.grid(row=5, column=1, sticky="w", pady=(6, 0))

        spend_sep = ttk.Separator(self)
        spend_sep.grid(row=6, column=0, columnspan=2, sticky="ew", pady=(10, 8))

        spent_today_label = ttk.Label(self, text="Spent today")
        spent_today_label.grid(row=7, column=0, sticky="w")
        spent_today_value = ttk.Label(self, textvariable=self.spent_today_var)
        spent_today_value.grid(row=7, column=1, sticky="w")

        remaining_today_label = ttk.Label(self, text="Remaining today")
        remaining_today_label.grid(row=8, column=0, sticky="w", pady=(4, 0))
        remaining_today_value = ttk.Label(self, textvariable=self.remaining_today_var)
        remaining_today_value.grid(row=8, column=1, sticky="w", pady=(4, 0))

        spent_month_label = ttk.Label(self, text="Spent this month")
        spent_month_label.grid(row=9, column=0, sticky="w", pady=(4, 0))
        spent_month_value = ttk.Label(self, textvariable=self.spent_month_var)
        spent_month_value.grid(row=9, column=1, sticky="w", pady=(4, 0))

        remaining_month_label = ttk.Label(self, text="Remaining this month")
        remaining_month_label.grid(row=10, column=0, sticky="w", pady=(4, 0))
        remaining_month_value = ttk.Label(self, textvariable=self.remaining_month_var)
        remaining_month_value.grid(row=10, column=1, sticky="w", pady=(4, 0))

        saved_last_month_label = ttk.Label(self, text="Amount saved last month")
        saved_last_month_label.grid(row=11, column=0, sticky="w", pady=(4, 0))
        saved_last_month_value = ttk.Label(self, textvariable=self.saved_last_month_var)
        saved_last_month_value.grid(row=11, column=1, sticky="w", pady=(4, 0))

        entry_sep = ttk.Separator(self)
        entry_sep.grid(row=12, column=0, columnspan=2, sticky="ew", pady=(10, 8))

        exp_title = ttk.Label(self, text="Enter an expense (today)")
        exp_title.grid(row=13, column=0, columnspan=2, sticky="w")

        exp_amount_label = ttk.Label(self, text="Amount")
        exp_amount_label.grid(row=14, column=0, sticky="w", pady=(6, 0))
        exp_amount_entry = ttk.Entry(self, textvariable=self.expense_amount_var)
        exp_amount_entry.grid(row=14, column=1, sticky="ew", pady=(6, 0))
        exp_amount_entry.bind("<Return>", lambda _e: self._on_add_expense())

        exp_note_label = ttk.Label(self, text="Note (optional)")
        exp_note_label.grid(row=15, column=0, sticky="w", pady=(6, 0))
        exp_note_entry = ttk.Entry(self, textvariable=self.expense_note_var)
        exp_note_entry.grid(row=15, column=1, sticky="ew", pady=(6, 0))
        exp_note_entry.bind("<Return>", lambda _e: self._on_add_expense())

        add_btn = ttk.Button(self, text="Add expense", command=self._on_add_expense)
        add_btn.grid(row=16, column=1, sticky="e", pady=(8, 0))

        list_label = ttk.Label(self, text="Today’s expenses")
        list_label.grid(row=17, column=0, columnspan=2, sticky="w", pady=(10, 4))

        self.expenses_list = tk.Listbox(self, height=6)
        self.expenses_list.grid(row=18, column=0, columnspan=2, sticky="nsew")
        self.expenses_list.bind("<<ListboxSelect>>", lambda _e: self._update_delete_button_state())
        self.rowconfigure(18, weight=1)

        self.delete_expense_btn = ttk.Button(self, text="Delete selected", command=self._on_delete_expense)
        self.delete_expense_btn.grid(row=19, column=1, sticky="e", pady=(8, 0))
        self._update_delete_button_state()

        status = ttk.Label(self, textvariable=self.status_var)
        status.grid(row=20, column=0, columnspan=2, sticky="w", pady=(12, 0))

        self.pack(fill="both", expand=True)

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
        remaining_days = compute_remaining_days_in_month(today)
        today_spent = sum_expenses(expenses_for_date(self.state.expenses, today))
        month_spent = sum_expenses(expenses_for_month(self.state.expenses, today.year, today.month))
        month_spent_before_today = month_spent - today_spent
        per_day = compute_conservative_carryover_per_day(base, remaining_days, month_spent_before_today)

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
