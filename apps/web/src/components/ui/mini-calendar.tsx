"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addDays,
  addMonths,
  formatHeaderDate,
  formatMonthYear,
  parseYmd,
  sameYmd,
  startOfMonth,
  startOfWeekMonday,
  toYmd,
} from "@/lib/date-utils";

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const VIEW_TABS = [
  { id: "month" as const, label: "Month" },
  { id: "week" as const, label: "Week" },
  { id: "day" as const, label: "Day" },
];

type CalendarView = (typeof VIEW_TABS)[number]["id"];

function mondayFirstPad(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function isDisabledYmd(ymd: string, min?: string, max?: string): boolean {
  if (min && ymd < min) return true;
  if (max && ymd > max) return true;
  return false;
}

function chunkWeeks<T>(items: T[]): T[][] {
  const weeks: T[][] = [];
  for (let i = 0; i < items.length; i += 7) {
    weeks.push(items.slice(i, i + 7));
  }
  return weeks;
}

function buildMonthCells(viewMonth: Date) {
  const first = startOfMonth(viewMonth);
  const startPad = mondayFirstPad(first);
  const daysInMonth = new Date(
    viewMonth.getFullYear(),
    viewMonth.getMonth() + 1,
    0
  ).getDate();

  const items: { ymd: string; day: number; inMonth: boolean }[] = [];

  for (let i = 0; i < startPad; i++) {
    const d = new Date(
      viewMonth.getFullYear(),
      viewMonth.getMonth(),
      -startPad + i + 1
    );
    items.push({ ymd: toYmd(d), day: d.getDate(), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
    items.push({ ymd: toYmd(d), day, inMonth: true });
  }
  while (items.length % 7 !== 0) {
    const last = parseYmd(items[items.length - 1].ymd)!;
    const d = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    items.push({ ymd: toYmd(d), day: d.getDate(), inMonth: false });
  }
  return chunkWeeks(items);
}

function DayCell({
  ymd,
  day,
  inMonth = true,
  selected,
  today,
  disabled,
  onSelect,
  large = false,
}: {
  ymd: string;
  day: number;
  inMonth?: boolean;
  selected: boolean;
  today: boolean;
  disabled: boolean;
  onSelect: (ymd: string) => void;
  large?: boolean;
}) {
  const cellDate = parseYmd(ymd)!;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={cellDate.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })}
      aria-current={selected ? "date" : undefined}
      onClick={() => onSelect(ymd)}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 rounded-full border-0 font-medium transition-colors",
        large ? "h-16 w-14 text-xl" : "h-9 w-full text-sm",
        selected
          ? "bg-sidebar-accent font-semibold text-sidebar-foreground"
          : "bg-transparent text-foreground hover:bg-muted",
        !inMonth && !selected && "text-muted-foreground/40",
        today && !selected && "font-semibold",
        disabled && "cursor-not-allowed opacity-30"
      )}
    >
      <span>{day}</span>
      {(selected || today) && (
        <span className="h-1 w-1 shrink-0 rounded-full bg-current" aria-hidden />
      )}
    </button>
  );
}

export function MiniCalendar({
  value,
  onSelect,
  min,
  max,
  className,
}: {
  value?: string;
  onSelect: (ymd: string) => void;
  min?: string;
  max?: string;
  className?: string;
}) {
  const selected = parseYmd(value);
  const today = useMemo(() => new Date(), []);
  const focusDate = selected ?? today;
  const [view, setView] = useState<CalendarView>("month");
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(focusDate));
  const [viewWeekStart, setViewWeekStart] = useState(() => startOfWeekMonday(focusDate));
  const [viewDay, setViewDay] = useState(() => focusDate);

  useEffect(() => {
    const parsed = parseYmd(value);
    if (!parsed) return;
    setViewMonth(startOfMonth(parsed));
    setViewWeekStart(startOfWeekMonday(parsed));
    setViewDay(parsed);
  }, [value]);

  const monthWeeks = useMemo(() => buildMonthCells(viewMonth), [viewMonth]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(viewWeekStart, i)),
    [viewWeekStart]
  );

  const headerDate = useMemo(() => {
    if (view === "month") {
      return formatMonthYear(viewMonth);
    }
    if (view === "week") {
      return formatHeaderDate(weekDays[3] ?? viewWeekStart);
    }
    return formatHeaderDate(viewDay);
  }, [view, viewMonth, viewDay, weekDays, viewWeekStart]);

  function selectDate(ymd: string) {
    const parsed = parseYmd(ymd);
    if (!parsed || isDisabledYmd(ymd, min, max)) return;
    onSelect(ymd);
    setViewMonth(startOfMonth(parsed));
    setViewWeekStart(startOfWeekMonday(parsed));
    setViewDay(parsed);
  }

  function shiftPeriod(delta: number) {
    if (view === "month") {
      setViewMonth((m) => addMonths(m, delta));
      return;
    }
    if (view === "week") {
      setViewWeekStart((w) => addDays(w, delta * 7));
      return;
    }
    setViewDay((d) => addDays(d, delta));
  }

  return (
    <div
      className={cn(
        "box-border w-[292px] min-w-[292px] max-w-[292px] bg-card p-4 text-card-foreground",
        className
      )}
    >
      <div className="mb-4 flex flex-col gap-3.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Previous"
            onClick={() => shiftPeriod(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex-1 font-heading text-lg font-semibold leading-tight text-foreground">
            {headerDate}
          </span>
          <button
            type="button"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Next"
            onClick={() => shiftPeriod(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div
          className="flex items-center gap-1 rounded-full bg-muted p-1"
          role="tablist"
          aria-label="Calendar view"
        >
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={view === tab.id}
              className={cn(
                "flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                view === tab.id
                  ? "bg-primary font-semibold text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {view === "month" && (
        <div role="grid" aria-label={headerDate}>
          <div
            className="mb-1 grid grid-cols-7 gap-1"
            style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
            aria-hidden
          >
            {WEEKDAY_LETTERS.map((letter, index) => (
              <span
                key={`${letter}-${index}`}
                className="flex h-6 items-center justify-center text-[11px] font-semibold text-muted-foreground"
              >
                {letter}
              </span>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            {monthWeeks.map((week, weekIndex) => (
              <div
                key={weekIndex}
                className="grid grid-cols-7 gap-1"
                style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
                role="row"
              >
                {week.map((cell) => {
                  const cellDate = parseYmd(cell.ymd)!;
                  return (
                    <div key={cell.ymd + (cell.inMonth ? "in" : "out")} role="gridcell">
                      <DayCell
                        ymd={cell.ymd}
                        day={cell.day}
                        inMonth={cell.inMonth}
                        selected={selected ? sameYmd(cellDate, selected) : false}
                        today={sameYmd(cellDate, today)}
                        disabled={isDisabledYmd(cell.ymd, min, max)}
                        onSelect={selectDate}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "week" && (
        <div
          className="grid grid-cols-7 gap-2 pt-1"
          style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
        >
          {weekDays.map((date) => {
            const ymd = toYmd(date);
            return (
              <div key={ymd} className="flex flex-col items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {date.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <DayCell
                  ymd={ymd}
                  day={date.getDate()}
                  selected={selected ? sameYmd(date, selected) : false}
                  today={sameYmd(date, today)}
                  disabled={isDisabledYmd(ymd, min, max)}
                  onSelect={selectDate}
                />
              </div>
            );
          })}
        </div>
      )}

      {view === "day" && (
        <div className="flex flex-col items-center gap-3 py-4">
          <DayCell
            ymd={toYmd(viewDay)}
            day={viewDay.getDate()}
            selected={selected ? sameYmd(viewDay, selected) : false}
            today={sameYmd(viewDay, today)}
            disabled={isDisabledYmd(toYmd(viewDay), min, max)}
            onSelect={selectDate}
            large
          />
          <p className="text-center text-sm text-muted-foreground">
            {viewDay.toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
      )}

      {value && (
        <div className="mt-4 border-t border-border pt-3 text-center">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => onSelect("")}
          >
            Clear date
          </button>
        </div>
      )}
    </div>
  );
}
