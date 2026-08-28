"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

export function optionsFromChildren(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== "option") return;
    const props = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
    options.push({
      value: String(props.value ?? ""),
      label: textOf(props.children).trim(),
      disabled: props.disabled,
    });
  });
  return options;
}

function matches(option: SelectOption, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle);
}

export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  disabled,
  required,
  name,
  className,
  multiple = false,
}: {
  options: SelectOption[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  className?: string;
  multiple?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);

  const selectedValues = useMemo(
    () => (multiple ? (Array.isArray(value) ? value : value ? [value] : []) : []),
    [multiple, value],
  );
  const selectedValue = multiple ? "" : typeof value === "string" ? value : "";
  const selected = options.find((option) => option.value === selectedValue && option.value !== "");
  const selectedRows = options.filter((option) => selectedValues.includes(option.value));
  const placeholderOption = options.find((option) => option.value === "");
  const searchable = options.filter((option) => option.value !== "");
  const filtered = searchable.filter((option) => matches(option, query));

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      const menu = document.getElementById(listId);
      if (menu?.contains(event.target as Node)) return;
      setOpen(false);
      setQuery("");
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open, listId]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    function place() {
      const anchor = rootRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const flip = below < 180 && rect.top > below;
      const maxHeight = Math.min(280, (flip ? rect.top : below) - 8);
      const width = rect.width;
      const left = Math.min(rect.left, Math.max(8, window.innerWidth - width - 8));
      setMenuStyle({
        position: "fixed",
        left,
        width,
        zIndex: 60,
        maxHeight,
        overflow: "auto",
        ...(flip
          ? { bottom: window.innerHeight - rect.top + 4, top: "auto" }
          : { top: rect.bottom + 4, bottom: "auto" }),
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, filtered.length, selectedRows.length]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  function commit(option: SelectOption) {
    if (option.disabled) return;
    if (multiple) {
      const next = selectedValues.includes(option.value)
        ? selectedValues.filter((id) => id !== option.value)
        : [...selectedValues, option.value];
      onChange(next);
      setQuery("");
      inputRef.current?.focus();
      return;
    }
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      if (open && filtered[active]) {
        event.preventDefault();
        commit(filtered[active]);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    } else if (event.key === "Backspace" && multiple && !query && selectedValues.length) {
      onChange(selectedValues.slice(0, -1));
    }
  }

  const inputValue = open || multiple ? query : (selected?.label ?? "");
  const inputPlaceholder = multiple
    ? selectedRows.length
      ? "Add another…"
      : placeholder
    : open
      ? selected?.label || placeholderOption?.label || "Search…"
      : placeholderOption?.label || placeholder;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {!multiple ? (
      <select
        tabIndex={-1}
        aria-hidden
        required={required}
        name={name}
        value={selectedValue}
        onChange={() => {}}
        className="pointer-events-none absolute h-0 w-0 opacity-0"
      >
        {placeholderOption ? <option value="">{placeholderOption.label}</option> : null}
        {searchable.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      ) : null}
      <div
        className={cn(
          "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-input bg-input/60 px-2.5 py-1 text-sm outline-none ring-offset-background",
          open && "border-primary ring-2 ring-primary/30",
          disabled && "pointer-events-none opacity-50",
        )}
        onClick={() => {
          if (disabled) return;
          inputRef.current?.focus();
          setOpen(true);
        }}
      >
        {multiple
          ? selectedRows.map((option) => (
              <span
                key={option.value}
                className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 font-mono text-xs text-primary"
              >
                {option.label}
                <button
                  type="button"
                  className="no-press rounded p-0.5 hover:bg-primary/20"
                  aria-label={`Remove ${option.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange(selectedValues.filter((id) => id !== option.value));
                  }}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))
          : null}
        <span className="flex min-w-[8rem] flex-1 items-center gap-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={inputValue}
            disabled={disabled}
            placeholder={inputPlaceholder}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            className={cn(
              "h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
              className?.includes("font-mono") && "font-mono",
            )}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setOpen(true);
              setQuery("");
            }}
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null;
              if (rootRef.current?.contains(next)) return;
              if (document.getElementById(listId)?.contains(next)) return;
              setOpen(false);
              setQuery("");
            }}
            onKeyDown={onKeyDown}
          />
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </div>
      {open && menuStyle && typeof document !== "undefined"
        ? createPortal(
            <ul
              id={listId}
              role="listbox"
              style={menuStyle}
              className="fixed overflow-y-auto rounded-xl border border-border/70 bg-card/90 py-1 shadow-lg ring-1 ring-white/10 backdrop-blur-xl"
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">No matches</li>
              ) : (
                filtered.map((option, index) => {
                  const isSelected = multiple
                    ? selectedValues.includes(option.value)
                    : option.value === selectedValue;
                  return (
                    <li key={option.value} role="option" aria-selected={isSelected}>
                      <button
                        type="button"
                        disabled={option.disabled}
                        className={cn(
                          "no-press flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                          index === active && "bg-accent text-accent-foreground",
                          isSelected && "text-primary",
                          option.disabled && "opacity-50",
                        )}
                        onMouseEnter={() => setActive(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => commit(option)}
                      >
                        <span className="min-w-0 truncate">{option.label}</span>
                        {isSelected ? <Check className="size-3.5 shrink-0" /> : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}

export function Select({
  className,
  children,
  value,
  onChange,
  disabled,
  required,
  name,
  multiple,
}: SelectHTMLAttributes<HTMLSelectElement> & { multiple?: boolean }) {
  const options = useMemo(() => optionsFromChildren(children), [children]);
  const current = value == null ? (multiple ? [] : "") : multiple && typeof value === "string" && value.includes(",")
    ? value.split(",").filter(Boolean)
    : (value as string);

  return (
    <SearchSelect
      options={options}
      value={current}
      multiple={multiple}
      disabled={disabled}
      required={required}
      name={name}
      className={className}
      placeholder={options.find((option) => option.value === "")?.label || "Select…"}
      onChange={(next) => {
        const serialized = Array.isArray(next) ? next.join(",") : next;
        onChange?.({
          target: { value: serialized, name: name ?? "" },
        } as never);
      }}
    />
  );
}
