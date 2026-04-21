from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from pathlib import Path
import os
import sys
import tkinter as tk
from tkinter import ttk

from .logic import (
    BudgetState,
    DeletedExpense,
    Expense,
    RecurringExpense,
    compute_days_in_month,
    compute_projected_allowance,
    compute_recurring_total,
    compute_remaining_days_in_month,
    compute_spend_per_day,
    compute_streak,
    expenses_for_date,
    expenses_for_month,
    sum_expenses,
)
from .storage import data_path, ensure_state_file, load_state, rollover_month_if_needed, save_state

# ── Colour palettes ──────────────────────────────────────────────────────────

LIGHT = {
    "bg": "#ffffff",
    "fg": "#111111",
    "label_fg": "#333333",
    "entry_bg": "#ffffff",
    "entry_fg": "#111111",
    "btn_bg": "#f8f8f8",
    "btn_fg": "#111111",
    "primary_bg": "#111111",
    "primary_fg": "#ffffff",
    "streak_fg": "#16a34a",
    "over_fg": "#dc2626",
    "under_fg": "#16a34a",
    "preview_fg": "#2563eb",
    "recovery_fg": "#9a3412",
    "select_bg": "#e0e7ff",
}

DARK = {
    "bg": "#1a1a1a",
    "fg": "#e5e5e5",
    "label_fg": "#aaaaaa",
    "entry_bg": "#2a2a2a",
    "entry_fg": "#e5e5e5",
    "btn_bg": "#2a2a2a",
    "btn_fg": "#e5e5e5",
    "primary_bg": "#e5e5e5",
    "primary_fg": "#111111",
    "streak_fg": "#4ade80",
    "over_fg": "#f87171",
    "under_fg": "#4ade80",
    "preview_fg": "#93c5fd",
    "recovery_fg": "#fdba74",
    "select_bg": "#374151",
}


class BudgetApp(ttk.Frame):
    def __init__(self, master: tk.Misc):
        super().__init__(master, padding=12)
        self.master = master

        self.state: BudgetState = load_state()
        ensure_state_file(self.state)
        if rollover_month_if_needed(self.state):
            save_state(self.state)

        self._palette = DARK if self.state.theme == "dark" else LIGHT

        # ── StringVars ────────────────────────────────────────────────────────
        self.base_var = tk.StringVar(value=self._fmt(self.state.base_amount))
        self.remaining_days_var = tk.StringVar()
        self.per_day_var = tk.StringVar()
        self.projected_var = tk.StringVar()
        self.streak_var = tk.StringVar()
        self.spent_today_var = tk.StringVar()
        self.remaining_today_var = tk.StringVar()
        self.spent_month_var = tk.StringVar()
        self.recurring_reserved_var = tk.StringVar()
        self.remaining_month_var = tk.StringVar()
        self.saved_last_month_var = tk.StringVar()
        self.base_preview_var = tk.StringVar()
        self.recovery_var = tk.StringVar()
        self.status_var = tk.StringVar()

        self.expense_amount_var = tk.StringVar()
        self.expense_note_var = tk.StringVar()
        self.history_date_var = tk.StringVar(value=date.today().isoformat())
        self.history_amount_var = tk.StringVar()
        self.history_note_var = tk.StringVar()
        self.r_amount_var = tk.StringVar()
        self.r_day_var = tk.StringVar()
        self.r_note_var = tk.StringVar()

        self._today_expense_indices: list[int] = []
        self._history_expense_indices: list[int] = []
        self._selected_recurring_id: str | None = None

        # Widget references (set in _build_ui)
        self.delete_expense_btn: ttk.Button | None = None
        self.undo_today_btn: ttk.Button | None = None
        self.history_save_btn: ttk.Button | None = None
        self.history_delete_btn: ttk.Button | None = None
        self.undo_history_btn: ttk.Button | None = None
        self.recurring_delete_btn: ttk.Button | None = None
        self.expenses_list: tk.Listbox | None = None
        self.history_list: tk.Listbox | None = None
        self.recurring_list: tk.Listbox | None = None
        self.trend_text: tk.Text | None = None
        self.recovery_label: ttk.Label | None = None
        self.streak_label: ttk.Label | None = None
        self.recurring_reserved_label: ttk.Label | None = None
        self.recurring_reserved_value_label: ttk.Label | None = None
        self._projected_label: ttk.Label | None = None
        self._projected_value_label: ttk.Label | None = None

        self._all_widgets: list[tk.Widget] = []

        self._build_ui()
        self._recompute_and_render(save=False)

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _fmt(self, amount: float) -> str:
        return f"{amount:.2f}"

    def _parse_money(self, value: str) -> float | None:
        raw = value.strip().replace(",", "")
        if not raw:
            return None
        try:
            return float(raw)
        except ValueError:
            return None

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

    def p(self) -> dict:
        return self._palette

    # ── UI construction ───────────────────────────────────────────────────────

    def _build_ui(self) -> None:
        self.master.title("BudgetApp")
        self.master.minsize(520, 600)

        menubar = tk.Menu(self.master)
        file_menu = tk.Menu(menubar, tearoff=0)
        file_menu.add_command(label="Config...", command=self._open_config)
        file_menu.add_separator()
        file_menu.add_command(label="Exit", command=self.master.destroy)
        menubar.add_cascade(label="File", menu=file_menu)
        self.master.config(menu=menubar)

        self.columnconfigure(1, weight=1)

        # Title row with theme toggle
        title_row = ttk.Frame(self)
        title_row.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 6))
        title_row.columnconfigure(0, weight=1)
        title = ttk.Label(title_row, text="Budget per day", font=("Segoe UI", 14, "bold"))
        title.grid(row=0, column=0, sticky="w")
        self._theme_btn = ttk.Button(
            title_row,
            text="Dark mode" if self.state.theme == "light" else "Light mode",
            command=self._toggle_theme,
        )
        self._theme_btn.grid(row=0, column=1, sticky="e")

        # Base amount row
        base_label = ttk.Label(self, text="Monthly budget")
        base_label.grid(row=1, column=0, sticky="w")
        base_entry = ttk.Entry(self, textvariable=self.base_var)
        base_entry.grid(row=1, column=1, sticky="ew")
        base_entry.bind("<Return>", lambda _: self._on_recalculate())
        base_entry.bind("<KeyRelease>", lambda _: self._update_base_preview())

        btn_row = ttk.Frame(self)
        btn_row.grid(row=2, column=0, columnspan=2, sticky="w", pady=(6, 2))
        ttk.Button(btn_row, text="Recalculate", command=self._on_recalculate).pack(side="left")
        ttk.Button(btn_row, text="Save", command=self._on_save).pack(side="left", padx=(8, 0))

        self._preview_label = ttk.Label(self, textvariable=self.base_preview_var, foreground=self.p()["preview_fg"])
        self._preview_label.grid(row=3, column=0, columnspan=2, sticky="w", pady=(0, 4))

        sep = ttk.Separator(self)
        sep.grid(row=4, column=0, columnspan=2, sticky="ew", pady=(4, 8))

        # ── Daily metrics ─────────────────────────────────────────────────────
        daily_row = ttk.Frame(self)
        daily_row.grid(row=5, column=0, columnspan=2, sticky="ew")
        ttk.Label(daily_row, text="Daily", font=("Segoe UI", 10, "bold")).pack(side="left")
        self.streak_label = ttk.Label(daily_row, textvariable=self.streak_var, foreground=self.p()["streak_fg"])
        self.streak_label.pack(side="left", padx=(8, 0))

        self._add_metric(6, "Remaining days (incl. today)", self.remaining_days_var)
        self._add_metric(7, "You can spend per day", self.per_day_var, bold=True)
        self._projected_label = ttk.Label(self, text="Tomorrow's daily limit")
        self._projected_label.grid(row=8, column=0, sticky="w", pady=(4, 0))
        self._projected_value_label = ttk.Label(self, textvariable=self.projected_var)
        self._projected_value_label.grid(row=8, column=1, sticky="w", pady=(4, 0))
        self._add_metric(9, "Spent today", self.spent_today_var)
        self._add_metric(10, "Remaining today", self.remaining_today_var, bold=True)

        self.recovery_label = ttk.Label(
            self, textvariable=self.recovery_var,
            foreground=self.p()["recovery_fg"],
            wraplength=420, justify="left",
        )
        self.recovery_label.grid(row=11, column=0, columnspan=2, sticky="w", pady=(2, 0))

        sep2 = ttk.Separator(self)
        sep2.grid(row=12, column=0, columnspan=2, sticky="ew", pady=(8, 8))

        # ── Month metrics ─────────────────────────────────────────────────────
        ttk.Label(self, text="This month", font=("Segoe UI", 10, "bold")).grid(
            row=13, column=0, columnspan=2, sticky="w")
        self._add_metric(14, "Spent this month", self.spent_month_var)
        self.recurring_reserved_label = ttk.Label(self, text="Recurring reserved")
        self.recurring_reserved_label.grid(row=15, column=0, sticky="w", pady=(4, 0))
        self.recurring_reserved_value_label = ttk.Label(self, textvariable=self.recurring_reserved_var)
        self.recurring_reserved_value_label.grid(row=15, column=1, sticky="w", pady=(4, 0))
        self._add_metric(16, "Remaining this month", self.remaining_month_var)

        sep3 = ttk.Separator(self)
        sep3.grid(row=17, column=0, columnspan=2, sticky="ew", pady=(8, 8))

        ttk.Label(self, text="Last month", font=("Segoe UI", 10, "bold")).grid(
            row=18, column=0, columnspan=2, sticky="w")
        self._add_metric(19, "Amount saved last month", self.saved_last_month_var)

        sep4 = ttk.Separator(self)
        sep4.grid(row=20, column=0, columnspan=2, sticky="ew", pady=(8, 8))

        # ── Notebook ──────────────────────────────────────────────────────────
        notebook = ttk.Notebook(self)
        notebook.grid(row=21, column=0, columnspan=2, sticky="nsew")
        self.rowconfigure(21, weight=1)

        today_tab = ttk.Frame(notebook, padding=4)
        history_tab = ttk.Frame(notebook, padding=4)
        recurring_tab = ttk.Frame(notebook, padding=4)
        trend_tab = ttk.Frame(notebook, padding=4)
        notebook.add(today_tab, text="Today")
        notebook.add(history_tab, text="History")
        notebook.add(recurring_tab, text="Recurring")
        notebook.add(trend_tab, text="Trend")

        self._build_today_tab(today_tab)
        self._build_history_tab(history_tab)
        self._build_recurring_tab(recurring_tab)
        self._build_trend_tab(trend_tab)

        ttk.Label(self, textvariable=self.status_var).grid(
            row=22, column=0, columnspan=2, sticky="w", pady=(8, 0))

        self.pack(fill="both", expand=True)
        self._apply_theme()
        self._on_history_load_date()

    def _add_metric(self, row: int, label: str, var: tk.StringVar, bold: bool = False) -> None:
        ttk.Label(self, text=label).grid(row=row, column=0, sticky="w", pady=(4, 0))
        font = ("Segoe UI", 11, "bold") if bold else None
        kw = {"font": font} if font else {}
        ttk.Label(self, textvariable=var, **kw).grid(row=row, column=1, sticky="w", pady=(4, 0))

    def _build_today_tab(self, parent: ttk.Frame) -> None:
        parent.columnconfigure(1, weight=1)
        ttk.Label(parent, text="Enter an expense (today)").grid(
            row=0, column=0, columnspan=2, sticky="w")
        ttk.Label(parent, text="Amount").grid(row=1, column=0, sticky="w", pady=(6, 0))
        exp_amount_entry = ttk.Entry(parent, textvariable=self.expense_amount_var)
        exp_amount_entry.grid(row=1, column=1, sticky="ew", pady=(6, 0))
        exp_amount_entry.bind("<Return>", lambda _: self._on_add_expense())
        ttk.Label(parent, text="Note (optional)").grid(row=2, column=0, sticky="w", pady=(6, 0))
        exp_note_entry = ttk.Entry(parent, textvariable=self.expense_note_var)
        exp_note_entry.grid(row=2, column=1, sticky="ew", pady=(6, 0))
        exp_note_entry.bind("<Return>", lambda _: self._on_add_expense())
        ttk.Button(parent, text="Add expense", command=self._on_add_expense).grid(
            row=3, column=1, sticky="e", pady=(8, 0))
        ttk.Label(parent, text="Today's expenses").grid(
            row=4, column=0, columnspan=2, sticky="w", pady=(10, 4))
        self.expenses_list = tk.Listbox(parent, height=6)
        self.expenses_list.grid(row=5, column=0, columnspan=2, sticky="nsew")
        self.expenses_list.bind("<<ListboxSelect>>", lambda _e: self._update_delete_button_state())
        parent.rowconfigure(5, weight=1)
        btn_frame = ttk.Frame(parent)
        btn_frame.grid(row=6, column=0, columnspan=2, sticky="e", pady=(6, 0))
        self.delete_expense_btn = ttk.Button(btn_frame, text="Delete selected",
                                              command=self._on_delete_expense)
        self.delete_expense_btn.pack(side="left")
        self.undo_today_btn = ttk.Button(btn_frame, text="Undo last delete",
                                          command=self._perform_undo)
        self.undo_today_btn.pack(side="left", padx=(8, 0))
        self._update_delete_button_state()

    def _build_history_tab(self, parent: ttk.Frame) -> None:
        parent.columnconfigure(1, weight=1)
        ttk.Label(parent, text="Add / edit expenses (this month)").grid(
            row=0, column=0, columnspan=3, sticky="w")
        ttk.Label(parent, text="Date (YYYY-MM-DD)").grid(row=1, column=0, sticky="w", pady=(6, 0))
        hist_entry = ttk.Entry(parent, textvariable=self.history_date_var)
        hist_entry.grid(row=1, column=1, sticky="ew", pady=(6, 0))
        hist_entry.bind("<Return>", lambda _: self._on_history_load_date())
        ttk.Button(parent, text="Load", command=self._on_history_load_date).grid(
            row=1, column=2, sticky="e", pady=(6, 0))
        ttk.Label(parent, text="Expenses for selected day").grid(
            row=2, column=0, columnspan=3, sticky="w", pady=(10, 4))
        self.history_list = tk.Listbox(parent, height=6)
        self.history_list.grid(row=3, column=0, columnspan=3, sticky="nsew")
        self.history_list.bind("<<ListboxSelect>>", lambda _: self._on_history_select())
        parent.rowconfigure(3, weight=1)
        ttk.Label(parent, text="Amount").grid(row=4, column=0, sticky="w", pady=(8, 0))
        ttk.Entry(parent, textvariable=self.history_amount_var).grid(
            row=4, column=1, columnspan=2, sticky="ew", pady=(8, 0))
        ttk.Label(parent, text="Note (optional)").grid(row=5, column=0, sticky="w", pady=(6, 0))
        ttk.Entry(parent, textvariable=self.history_note_var).grid(
            row=5, column=1, columnspan=2, sticky="ew", pady=(6, 0))
        btn_frame = ttk.Frame(parent)
        btn_frame.grid(row=6, column=0, columnspan=3, sticky="e", pady=(8, 0))
        ttk.Button(btn_frame, text="Add to this day", command=self._on_history_add).pack(side="left")
        self.history_save_btn = ttk.Button(btn_frame, text="Save changes",
                                            command=self._on_history_save)
        self.history_save_btn.pack(side="left", padx=(8, 0))
        self.history_delete_btn = ttk.Button(btn_frame, text="Delete selected",
                                              command=self._on_history_delete)
        self.history_delete_btn.pack(side="left", padx=(8, 0))
        self.undo_history_btn = ttk.Button(btn_frame, text="Undo last delete",
                                            command=self._perform_undo)
        self.undo_history_btn.pack(side="left", padx=(8, 0))

    def _build_recurring_tab(self, parent: ttk.Frame) -> None:
        parent.columnconfigure(1, weight=1)
        ttk.Label(parent, text="Recurring expenses", font=("Segoe UI", 10, "bold")).grid(
            row=0, column=0, columnspan=3, sticky="w")
        ttk.Label(
            parent,
            text="These amounts are pre-deducted from your monthly budget.",
            foreground="#666666",
        ).grid(row=1, column=0, columnspan=3, sticky="w", pady=(2, 6))
        self.recurring_list = tk.Listbox(parent, height=6)
        self.recurring_list.grid(row=2, column=0, columnspan=3, sticky="nsew")
        self.recurring_list.bind("<<ListboxSelect>>", lambda _: self._on_recurring_select())
        parent.rowconfigure(2, weight=1)
        ttk.Separator(parent).grid(row=3, column=0, columnspan=3, sticky="ew", pady=(8, 6))
        ttk.Label(parent, text="Add recurring expense", font=("Segoe UI", 10, "bold")).grid(
            row=4, column=0, columnspan=3, sticky="w")
        ttk.Label(parent, text="Amount").grid(row=5, column=0, sticky="w", pady=(6, 0))
        ttk.Entry(parent, textvariable=self.r_amount_var).grid(
            row=5, column=1, columnspan=2, sticky="ew", pady=(6, 0))
        ttk.Label(parent, text="Day of month (1-31)").grid(row=6, column=0, sticky="w", pady=(6, 0))
        ttk.Entry(parent, textvariable=self.r_day_var).grid(
            row=6, column=1, columnspan=2, sticky="ew", pady=(6, 0))
        ttk.Label(parent, text="Note (optional)").grid(row=7, column=0, sticky="w", pady=(6, 0))
        ttk.Entry(parent, textvariable=self.r_note_var).grid(
            row=7, column=1, columnspan=2, sticky="ew", pady=(6, 0))
        btn_frame = ttk.Frame(parent)
        btn_frame.grid(row=8, column=0, columnspan=3, sticky="e", pady=(8, 0))
        ttk.Button(btn_frame, text="Add recurring", command=self._on_recurring_add).pack(side="left")
        self.recurring_delete_btn = ttk.Button(btn_frame, text="Delete selected",
                                                command=self._on_recurring_delete)
        self.recurring_delete_btn.pack(side="left", padx=(8, 0))
        self._update_recurring_button_state()

    def _build_trend_tab(self, parent: ttk.Frame) -> None:
        parent.columnconfigure(0, weight=1)
        parent.rowconfigure(0, weight=1)
        self.trend_text = tk.Text(parent, state="disabled", wrap="none",
                                   font=("Consolas", 10), height=20)
        scroll = ttk.Scrollbar(parent, orient="vertical", command=self.trend_text.yview)
        self.trend_text.configure(yscrollcommand=scroll.set)
        self.trend_text.grid(row=0, column=0, sticky="nsew")
        scroll.grid(row=0, column=1, sticky="ns")

    # ── Theme ─────────────────────────────────────────────────────────────────

    def _toggle_theme(self) -> None:
        self.state.theme = "dark" if self.state.theme == "light" else "light"
        self._palette = DARK if self.state.theme == "dark" else LIGHT
        save_state(self.state)
        self._theme_btn.configure(
            text="Light mode" if self.state.theme == "dark" else "Dark mode"
        )
        self._apply_theme()

    def _apply_theme(self) -> None:
        p = self.p()
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure(".", background=p["bg"], foreground=p["fg"], fieldbackground=p["entry_bg"])
        style.configure("TFrame", background=p["bg"])
        style.configure("TLabel", background=p["bg"], foreground=p["fg"])
        style.configure("TEntry", fieldbackground=p["entry_bg"], foreground=p["entry_fg"])
        style.configure("TButton", background=p["btn_bg"], foreground=p["btn_fg"])
        style.configure("TNotebook", background=p["bg"])
        style.configure("TNotebook.Tab", background=p["btn_bg"], foreground=p["fg"])
        style.configure("TSeparator", background=p["bg"])
        self.master.configure(bg=p["bg"])
        if self._preview_label:
            self._preview_label.configure(foreground=p["preview_fg"])
        if self.streak_label:
            self.streak_label.configure(foreground=p["streak_fg"])
        if self.recovery_label:
            self.recovery_label.configure(foreground=p["recovery_fg"])
        if self.trend_text:
            self.trend_text.configure(bg=p["entry_bg"], fg=p["fg"],
                                       insertbackground=p["fg"])

    # ── Base preview ──────────────────────────────────────────────────────────

    def _update_base_preview(self) -> None:
        new_base = self._parse_money(self.base_var.get())
        if new_base is None or new_base == self.state.base_amount:
            self.base_preview_var.set("")
            return
        today = date.today()
        days_in_month = compute_days_in_month(today)
        recurring_total = compute_recurring_total(self.state.recurring)
        effective_new = max(0.0, new_base - recurring_total)
        effective_cur = max(0.0, self.state.base_amount - recurring_total)
        new_per_day = compute_spend_per_day(effective_new, days_in_month)
        cur_per_day = compute_spend_per_day(effective_cur, days_in_month)
        self.base_preview_var.set(
            f"Current daily: ${self._fmt(cur_per_day)}  →  New daily: ${self._fmt(new_per_day)}"
        )

    # ── Core recompute ────────────────────────────────────────────────────────

    def _recompute_and_render(self, *, save: bool) -> None:
        base = self._parse_money(self.base_var.get())
        if base is None:
            self.status_var.set("Enter a valid number (example: 1000 or 1000.00).")
            for v in (self.remaining_days_var, self.per_day_var, self.projected_var,
                      self.streak_var, self.spent_today_var, self.remaining_today_var,
                      self.spent_month_var, self.remaining_month_var, self.recovery_var):
                v.set("")
            return

        today = date.today()
        days_in_month = compute_days_in_month(today)
        remaining_days = compute_remaining_days_in_month(today)
        recurring_total = compute_recurring_total(self.state.recurring)
        effective_base = max(0.0, base - recurring_total)

        today_spent = sum_expenses(expenses_for_date(self.state.expenses, today))
        month_spent = sum_expenses(expenses_for_month(self.state.expenses, today.year, today.month))
        baseline_per_day = compute_spend_per_day(effective_base, days_in_month)
        per_day = baseline_per_day
        streak = compute_streak(
            self.state.expenses, today.year, today.month, today, baseline_per_day
        )

        today_remaining = per_day - today_spent
        month_remaining = effective_base - month_spent

        self.remaining_days_var.set(str(remaining_days))
        self.per_day_var.set(f"${self._fmt(per_day)}")
        self.streak_var.set(f"{streak}-day streak" if streak > 0 else "")
        self.spent_today_var.set(f"${self._fmt(today_spent)}")
        self.remaining_today_var.set(f"${self._fmt(today_remaining)}")
        self.spent_month_var.set(f"${self._fmt(month_spent)}")
        self.remaining_month_var.set(f"${self._fmt(month_remaining)}")
        self.saved_last_month_var.set(f"${self._fmt(self.state.last_month_saved)}")

        # Show tomorrow's adjusted limit only when today's spending exceeds the daily limit
        if today_spent > per_day:
            projected = compute_projected_allowance(
                self.state.expenses, effective_base,
                year=today.year, month=today.month, today=today,
                days_in_month=days_in_month, remaining_days_incl_today=remaining_days,
            )
            self.projected_var.set(f"${self._fmt(projected)}")
            if self._projected_label:
                self._projected_label.grid()
            if self._projected_value_label:
                self._projected_value_label.grid()
        else:
            self.projected_var.set("")
            if self._projected_label:
                self._projected_label.grid_remove()
            if self._projected_value_label:
                self._projected_value_label.grid_remove()

        # Recurring reserved row
        if recurring_total > 0:
            self.recurring_reserved_var.set(f"${self._fmt(recurring_total)}")
            if self.recurring_reserved_label:
                self.recurring_reserved_label.grid()
            if self.recurring_reserved_value_label:
                self.recurring_reserved_value_label.grid()
        else:
            self.recurring_reserved_var.set("")
            if self.recurring_reserved_label:
                self.recurring_reserved_label.grid_remove()
            if self.recurring_reserved_value_label:
                self.recurring_reserved_value_label.grid_remove()

        # Recovery callout
        if month_remaining < 0:
            self.recovery_var.set(
                f"Monthly budget exceeded by ${self._fmt(-month_remaining)} — "
                f"{remaining_days} days left."
            )
        else:
            self.recovery_var.set("")

        self._render_today_expenses(today)
        self._render_trend(today, baseline_per_day)
        self._update_undo_buttons()

        self.state.base_amount = base
        if save:
            month_key = f"{today.year:04d}-{today.month:02d}"
            self.state.monthly_bases[month_key] = base
            save_state(self.state)
            self.status_var.set("Saved.")
            self.base_preview_var.set("")
        else:
            if today_remaining < 0:
                self.status_var.set(f"Over today's allowance by ${self._fmt(-today_remaining)}.")
            else:
                self.status_var.set("")

    # ── Trend rendering ───────────────────────────────────────────────────────

    def _render_trend(self, today: date, baseline_per_day: float) -> None:
        if not self.trend_text:
            return
        self.trend_text.configure(state="normal")
        self.trend_text.delete("1.0", "end")
        self.trend_text.tag_configure("over", foreground=self.p()["over_fg"])
        self.trend_text.tag_configure("under", foreground=self.p()["under_fg"])
        self.trend_text.tag_configure("header", font=("Consolas", 10, "bold"))
        self.trend_text.tag_configure("dim", foreground=self.p()["label_fg"])

        self.trend_text.insert("end",
            f"Baseline: ${self._fmt(baseline_per_day)}/day\n\n", "header")

        for day in range(1, today.day + 1):
            d = date(today.year, today.month, day)
            label = d.strftime("%b %-d") if sys.platform != "win32" else d.strftime("%b %d")
            day_exps = expenses_for_date(self.state.expenses, d)
            spent = sum_expenses(day_exps)
            is_over = spent > baseline_per_day
            bar_chars = 20
            fill = int(min(1.0, spent / (2 * baseline_per_day) if baseline_per_day > 0 else 0) * bar_chars)
            bar = "#" * fill + "-" * (bar_chars - fill)
            tag = "over" if is_over else "under"
            status = "OVER" if is_over else "OK  "
            line = f"{label:<7} ${self._fmt(spent):>8}  [{bar}]  {status}\n"
            self.trend_text.insert("end", line, tag)

        # Past months summary
        summaries = self.state.monthly_summaries
        if summaries:
            self.trend_text.insert("end", "\n── Past months ──────────────────────────────\n", "header")
            self.trend_text.insert("end",
                f"{'Month':<14}{'Budget':>10}{'Spent':>10}{'Saved':>10}\n", "dim")
            for key in sorted(summaries.keys(), reverse=True):
                s = summaries[key]
                try:
                    y, mo = int(key[:4]), int(key[5:7])
                    month_label = date(y, mo, 1).strftime("%b %Y")
                except (ValueError, IndexError):
                    month_label = key
                saved_str = f"{'+'if s.saved >= 0 else ''}${self._fmt(s.saved)}"
                tag = "under" if s.saved >= 0 else "over"
                line = f"{month_label:<14}${self._fmt(s.base):>9}${self._fmt(s.spent):>9}"
                self.trend_text.insert("end", line, "dim")
                self.trend_text.insert("end", f"{saved_str:>10}\n", tag)

        self.trend_text.configure(state="disabled")

    # ── Today tab ─────────────────────────────────────────────────────────────

    def _render_today_expenses(self, today: date) -> None:
        if not self.expenses_list:
            return
        self.expenses_list.delete(0, tk.END)
        self._today_expense_indices.clear()
        today_iso = today.isoformat()
        for idx, exp in enumerate(self.state.expenses):
            if exp.date != today_iso:
                continue
            note = f" — {exp.note}" if exp.note else ""
            self.expenses_list.insert(tk.END, f"${self._fmt(exp.amount)}{note}")
            self._today_expense_indices.append(idx)
        self._update_delete_button_state()

    def _update_delete_button_state(self) -> None:
        if not self.delete_expense_btn or not self.expenses_list:
            return
        sel = self.expenses_list.curselection()
        state = "!disabled" if sel and self._today_expense_indices else "disabled"
        self.delete_expense_btn.state([state])

    def _update_undo_buttons(self) -> None:
        has_deleted = len(self.state.recently_deleted) > 0
        s = "!disabled" if has_deleted else "disabled"
        if self.undo_today_btn:
            self.undo_today_btn.state([s])
        if self.undo_history_btn:
            self.undo_history_btn.state([s])

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
        if not self.expenses_list:
            return
        sel = self.expenses_list.curselection()
        if not sel:
            self.status_var.set("Select an expense to delete.")
            return
        list_idx = int(sel[0])
        if list_idx >= len(self._today_expense_indices):
            self.status_var.set("Select an expense to delete.")
            return
        state_idx = self._today_expense_indices[list_idx]
        if state_idx >= len(self.state.expenses):
            return
        exp = self.state.expenses[state_idx]
        self._push_to_recently_deleted(exp)
        self.state.expenses.pop(state_idx)
        save_state(self.state)
        self.expenses_list.selection_clear(0, tk.END)
        self._recompute_and_render(save=False)
        if not self.status_var.get():
            self.status_var.set("Deleted.")

    # ── Undo ──────────────────────────────────────────────────────────────────

    def _push_to_recently_deleted(self, exp: Expense) -> None:
        now_iso = datetime.now(tz=timezone.utc).isoformat()
        self.state.recently_deleted.append(
            DeletedExpense(date=exp.date, amount=exp.amount, note=exp.note, deleted_at=now_iso)
        )
        if len(self.state.recently_deleted) > 10:
            self.state.recently_deleted.pop(0)

    def _perform_undo(self) -> None:
        if not self.state.recently_deleted:
            self.status_var.set("Nothing to undo.")
            return
        d = self.state.recently_deleted.pop()
        self.state.expenses.append(Expense(date=d.date, amount=d.amount, note=d.note))
        save_state(self.state)
        self._recompute_and_render(save=False)
        if not self.status_var.get():
            self.status_var.set("Restored.")

    # ── History tab ───────────────────────────────────────────────────────────

    def _render_history_expenses(self, target: date) -> None:
        if not self.history_list:
            return
        self.history_list.delete(0, tk.END)
        self._history_expense_indices.clear()
        target_iso = target.isoformat()
        for idx, exp in enumerate(self.state.expenses):
            if exp.date != target_iso:
                continue
            note = f" — {exp.note}" if exp.note else ""
            self.history_list.insert(tk.END, f"${self._fmt(exp.amount)}{note}")
            self._history_expense_indices.append(idx)
        self._update_history_button_state()

    def _update_history_button_state(self) -> None:
        if not self.history_save_btn or not self.history_delete_btn or not self.history_list:
            return
        sel = self.history_list.curselection()
        s = "!disabled" if sel else "disabled"
        self.history_save_btn.state([s])
        self.history_delete_btn.state([s])

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
        if not self.history_list:
            return
        sel = self.history_list.curselection()
        if not sel:
            self._update_history_button_state()
            return
        list_idx = int(sel[0])
        if list_idx >= len(self._history_expense_indices):
            self._update_history_button_state()
            return
        state_idx = self._history_expense_indices[list_idx]
        if state_idx >= len(self.state.expenses):
            self._update_history_button_state()
            return
        exp = self.state.expenses[state_idx]
        self.history_amount_var.set(self._fmt(exp.amount))
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
        self.state.expenses.append(Expense(date=d.isoformat(), amount=amount, note=note))
        save_state(self.state)
        self.history_amount_var.set("")
        self.history_note_var.set("")
        if self.history_list:
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
        if not self.history_list:
            return
        sel = self.history_list.curselection()
        if not sel or int(sel[0]) >= len(self._history_expense_indices):
            self.status_var.set("Select an expense to edit.")
            return
        state_idx = self._history_expense_indices[int(sel[0])]
        if state_idx >= len(self.state.expenses):
            return
        exp = self.state.expenses[state_idx]
        if exp.date != d.isoformat():
            self.status_var.set("Select an expense from the loaded date.")
            self._render_history_expenses(d)
            return
        amount = self._parse_money(self.history_amount_var.get())
        if amount is None or amount <= 0:
            self.status_var.set("Enter a positive expense amount.")
            return
        exp.amount = amount
        exp.note = self.history_note_var.get().strip()
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
        if not self.history_list:
            return
        sel = self.history_list.curselection()
        if not sel or int(sel[0]) >= len(self._history_expense_indices):
            self.status_var.set("Select an expense to delete.")
            return
        state_idx = self._history_expense_indices[int(sel[0])]
        if state_idx >= len(self.state.expenses):
            return
        exp = self.state.expenses[state_idx]
        if exp.date != d.isoformat():
            self.status_var.set("Select an expense from the loaded date.")
            self._render_history_expenses(d)
            return
        self._push_to_recently_deleted(exp)
        self.state.expenses.pop(state_idx)
        save_state(self.state)
        self.history_amount_var.set("")
        self.history_note_var.set("")
        self.history_list.selection_clear(0, tk.END)
        self._recompute_and_render(save=False)
        self._render_history_expenses(d)
        if not self.status_var.get():
            self.status_var.set("Deleted.")

    # ── Recurring tab ─────────────────────────────────────────────────────────

    def _render_recurring_list(self) -> None:
        if not self.recurring_list:
            return
        self.recurring_list.delete(0, tk.END)
        for r in sorted(self.state.recurring, key=lambda x: x.day):
            note = f" — {r.note}" if r.note else ""
            self.recurring_list.insert(tk.END, f"Day {r.day}  ${self._fmt(r.amount)}{note}")
        self._update_recurring_button_state()

    def _update_recurring_button_state(self) -> None:
        if not self.recurring_delete_btn or not self.recurring_list:
            return
        sel = self.recurring_list.curselection()
        self.recurring_delete_btn.state(["!disabled" if sel else "disabled"])

    def _on_recurring_select(self) -> None:
        if not self.recurring_list:
            return
        sel = self.recurring_list.curselection()
        if not sel:
            self._selected_recurring_id = None
            self._update_recurring_button_state()
            return
        sorted_recurring = sorted(self.state.recurring, key=lambda x: x.day)
        idx = int(sel[0])
        if idx < len(sorted_recurring):
            self._selected_recurring_id = sorted_recurring[idx].id
        self._update_recurring_button_state()

    def _on_recurring_add(self) -> None:
        amount = self._parse_money(self.r_amount_var.get())
        if amount is None or amount <= 0:
            self.status_var.set("Enter a positive amount.")
            return
        try:
            day = int(self.r_day_var.get().strip())
        except ValueError:
            self.status_var.set("Enter a day of month between 1 and 31.")
            return
        if day < 1 or day > 31:
            self.status_var.set("Enter a day of month between 1 and 31.")
            return
        note = self.r_note_var.get().strip()
        self.state.recurring.append(
            RecurringExpense(id=str(uuid.uuid4()), amount=amount, day=day, note=note)
        )
        save_state(self.state)
        self.r_amount_var.set("")
        self.r_day_var.set("")
        self.r_note_var.set("")
        self._render_recurring_list()
        self._recompute_and_render(save=False)
        if not self.status_var.get():
            self.status_var.set("Recurring expense added.")

    def _on_recurring_delete(self) -> None:
        if not self._selected_recurring_id:
            self.status_var.set("Select a recurring expense to delete.")
            return
        self.state.recurring = [
            r for r in self.state.recurring if r.id != self._selected_recurring_id
        ]
        self._selected_recurring_id = None
        save_state(self.state)
        self._render_recurring_list()
        self._recompute_and_render(save=False)
        if not self.status_var.get():
            self.status_var.set("Recurring expense removed.")

    # ── Misc ──────────────────────────────────────────────────────────────────

    def _on_recalculate(self) -> None:
        self._recompute_and_render(save=False)

    def _on_save(self) -> None:
        self._recompute_and_render(save=True)

    def _open_config(self) -> None:
        ensure_state_file(self.state)
        path = data_path()
        try:
            os.startfile(str(path.parent))  # type: ignore[attr-defined]
        except OSError as e:
            self.status_var.set(f"Could not open config: {e}")


def main() -> int:
    root = tk.Tk()

    icon_path: str
    if getattr(sys, "_MEIPASS", None):
        icon_path = str(Path(sys._MEIPASS) / "Resources" / "BA_Logo_Final.ico")
    else:
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
