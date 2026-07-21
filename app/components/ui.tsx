"use client";

/**
 * Shared primitives. Extracted so the wizard file reads as flow rather than
 * markup, and so every input looks identical without copy-pasted class strings.
 */

import { useId } from "react";

const FIELD_BASE =
  "w-full rounded-sm border bg-ink-700 px-4 py-3 text-[15px] text-paper-100 outline-none transition-colors placeholder:text-paper-500";

function fieldBorder(error?: string) {
  return error ? "border-danger" : "border-ink-500 focus:border-brass-400";
}

export function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="text-paper-300 mb-2 block text-xs tracking-[0.14em] uppercase">
      {children}
      {required && <span className="text-brass-400 ml-1">*</span>}
    </label>
  );
}

export function TextField({
  label,
  error,
  required,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`${FIELD_BASE} ${fieldBorder(error)}`}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="text-danger mt-1.5 text-xs">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-paper-500 mt-1.5 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextArea({
  label,
  error,
  hint,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <textarea
        id={id}
        aria-invalid={Boolean(error)}
        className={`${FIELD_BASE} ${fieldBorder(error)} resize-none leading-relaxed`}
        {...props}
      />
      {error ? (
        <p className="text-danger mt-1.5 text-xs">{error}</p>
      ) : hint ? (
        <p className="text-paper-500 mt-1.5 text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  error,
  required,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string;
}) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <select
        id={id}
        aria-invalid={Boolean(error)}
        className={`${FIELD_BASE} ${fieldBorder(error)} cursor-pointer appearance-none bg-[length:11px] bg-[right_1rem_center] bg-no-repeat pr-10`}
        style={{
          // Inline SVG chevron — avoids an icon dependency for one glyph.
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath fill='none' stroke='%23a8a6a1' stroke-width='1.5' d='M1 1.5 6 6.5 11 1.5'/%3E%3C/svg%3E\")",
        }}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-danger mt-1.5 text-xs">{error}</p>}
    </div>
  );
}

/** Numeric stepper. Avoids native number spinners, which are tiny and ugly. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  suffix?: string;
}) {
  const id = useId();
  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="border-ink-500 bg-ink-700 flex items-stretch rounded-sm border">
        <button
          type="button"
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
          className="text-paper-300 hover:text-brass-400 disabled:text-ink-500 px-4 text-lg transition-colors disabled:cursor-not-allowed"
        >
          −
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={suffix ? `${value} ${suffix}` : value}
          onChange={(e) => {
            const parsed = Number.parseInt(e.target.value.replace(/\D/g, ""), 10);
            if (!Number.isNaN(parsed)) onChange(clamp(parsed));
          }}
          className="tnum text-paper-100 min-w-0 flex-1 bg-transparent py-3 text-center text-[15px] outline-none"
        />
        <button
          type="button"
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
          className="text-paper-300 hover:text-brass-400 disabled:text-ink-500 px-4 text-lg transition-colors disabled:cursor-not-allowed"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function PrimaryButton({
  children,
  loading,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`bg-brass-400 text-ink-900 hover:bg-brass-500 disabled:bg-ink-600 disabled:text-paper-500 inline-flex items-center justify-center gap-2.5 rounded-sm px-8 py-3.5 text-sm font-medium tracking-wide transition-colors disabled:cursor-not-allowed ${props.className ?? ""}`}
    >
      {loading && (
        <span
          className="border-ink-900/30 border-t-ink-900 h-3.5 w-3.5 animate-spin rounded-full border-2"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`text-paper-300 hover:text-paper-100 rounded-sm px-4 py-3.5 text-sm transition-colors ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}
