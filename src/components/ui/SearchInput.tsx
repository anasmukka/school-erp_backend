import React, { useState, useEffect, useRef, useCallback } from "react"
import { Search, X, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string
  onChange: (value: string) => void
  onClear?: () => void
  placeholder?: string
  debounceMs?: number
  className?: string
  containerClassName?: string
  showShortcutHint?: boolean
  isLoading?: boolean
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  onClear,
  placeholder = "Search...",
  debounceMs = 250,
  className,
  containerClassName,
  showShortcutHint = true,
  isLoading = false,
  disabled,
  ...props
}) => {
  const [internalValue, setInternalValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // Sync external value to internal value if external value changes (e.g. reset from parent)
  useEffect(() => {
    setInternalValue(value)
  }, [value])

  // Handle debounced callback to parent
  const handleInputChange = useCallback(
    (newVal: string) => {
      setInternalValue(newVal)

      if (debounceMs <= 0) {
        onChange(newVal)
        return
      }

      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      timerRef.current = setTimeout(() => {
        onChange(newVal)
      }, debounceMs)
    },
    [debounceMs, onChange]
  )

  // Clear immediately
  const handleClear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    setInternalValue("")
    onChange("")
    if (onClear) onClear()
    inputRef.current?.focus()
  }, [onChange, onClear])

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // Keyboard shortcut listener ('/' or 'Ctrl+K' / 'Cmd+K' to focus)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      const isInputActive =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute("contenteditable") === "true"

      // Ctrl+K or Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        inputRef.current?.focus()
        return
      }

      // '/' when no input is focused
      if (e.key === "/" && !isInputActive) {
        e.preventDefault()
        inputRef.current?.focus()
      }

      // Escape key to blur / clear when focused
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        if (internalValue) {
          handleClear()
        } else {
          inputRef.current?.blur()
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [internalValue, handleClear])

  return (
    <div
      className={cn(
        "relative flex items-center w-full transition-all duration-200",
        containerClassName
      )}
    >
      <div className="absolute left-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary">
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
        ) : (
          <Search className="w-4 h-4" />
        )}
      </div>

      <input
        ref={inputRef}
        type="text"
        value={internalValue}
        onChange={(e) => handleInputChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className={cn(
          "w-full h-10 pl-10 pr-10 text-sm font-medium rounded-xl",
          "border border-white/80 bg-white/80 text-slate-800 placeholder:text-slate-400 placeholder:font-normal",
          "shadow-[0_4px_12px_-4px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-md",
          "transition-all duration-200 ease-out",
          "hover:border-slate-300 hover:bg-white/95",
          "focus:outline-none focus:border-primary/50 focus:bg-white focus:ring-4 focus:ring-primary/10 focus:shadow-md",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />

      <div className="absolute right-3 flex items-center space-x-1.5">
        {internalValue ? (
          <button
            type="button"
            onClick={handleClear}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
            title="Clear search"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        ) : showShortcutHint ? (
          <div className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold text-slate-400 bg-slate-100/80 border border-slate-200/60 pointer-events-none select-none">
            <kbd className="font-sans">Ctrl</kbd>
            <span>+</span>
            <kbd className="font-sans">K</kbd>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default SearchInput
