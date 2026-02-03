import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  'aria-label': string;
  className?: string;
  menuClassName?: string;
  'data-testid'?: string;
}

export function Select({
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  className = '',
  menuClassName = '',
  'aria-label': ariaLabel,
  'data-testid': testId,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeOptionIndex, setActiveOptionIndex] = useState<number | null>(
    null
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selectedOption = useMemo(
    () => options.find(option => option.value === value) ?? null,
    [options, value]
  );

  const displayLabel = selectedOption?.label ?? placeholder ?? '';

  const getOptionId = (index: number) => `${listboxId}-option-${index}`;

  const getFirstEnabledIndex = useCallback(() => {
    const index = options.findIndex(option => !option.disabled);
    return index >= 0 ? index : null;
  }, [options]);

  const getNextEnabledIndex = useCallback(
    (startIndex: number, direction: -1 | 1): number | null => {
      if (options.length === 0) {
        return null;
      }

      for (let offset = 1; offset <= options.length; offset++) {
        const nextIndex =
          (startIndex + direction * offset + options.length) % options.length;
        if (!options[nextIndex]?.disabled) {
          return nextIndex;
        }
      }

      return null;
    },
    [options]
  );

  useEffect(() => {
    if (!isOpen) {
      setActiveOptionIndex(null);
      return;
    }

    const selectedIndex = options.findIndex(option => option.value === value);
    if (selectedIndex >= 0 && !options[selectedIndex]?.disabled) {
      setActiveOptionIndex(selectedIndex);
      return;
    }

    setActiveOptionIndex(getFirstEnabledIndex());
  }, [isOpen, options, value, getFirstEnabledIndex]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleToggle = () => {
    if (disabled) {
      return;
    }
    setIsOpen(open => !open);
  };

  const handleSelect = (nextValue: string) => {
    onChange(nextValue);
    setIsOpen(false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          return;
        }
        const currentIndex = activeOptionIndex ?? getFirstEnabledIndex() ?? 0;
        const nextIndex = getNextEnabledIndex(currentIndex, 1);
        if (nextIndex !== null) {
          setActiveOptionIndex(nextIndex);
        }
        return;
      }
      case 'ArrowUp': {
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          return;
        }
        const currentIndex = activeOptionIndex ?? getFirstEnabledIndex() ?? 0;
        const nextIndex = getNextEnabledIndex(currentIndex, -1);
        if (nextIndex !== null) {
          setActiveOptionIndex(nextIndex);
        }
        return;
      }
      case 'Home': {
        if (!isOpen) {
          return;
        }
        event.preventDefault();
        setActiveOptionIndex(getFirstEnabledIndex());
        return;
      }
      case 'End': {
        if (!isOpen) {
          return;
        }
        event.preventDefault();
        for (let i = options.length - 1; i >= 0; i--) {
          if (!options[i]?.disabled) {
            setActiveOptionIndex(i);
            break;
          }
        }
        return;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          return;
        }

        if (activeOptionIndex === null) {
          return;
        }

        const option = options[activeOptionIndex];
        if (option && !option.disabled) {
          handleSelect(option.value);
        }
        return;
      }
      case 'Escape': {
        if (!isOpen) {
          return;
        }
        event.preventDefault();
        setIsOpen(false);
        return;
      }
      default:
        return;
    }
  };

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      <button
        type="button"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        className={`w-full px-3 py-2.5 border rounded-xl shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-primary)] border-slate-200 text-slate-900 bg-white/80 flex items-center justify-between gap-3 ${
          disabled ? 'bg-slate-100 cursor-not-allowed opacity-70' : ''
        }`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={
          isOpen && activeOptionIndex !== null
            ? getOptionId(activeOptionIndex)
            : undefined
        }
        aria-label={ariaLabel}
        disabled={disabled}
        data-testid={testId}
      >
        <span
          className={`min-w-0 truncate ${
            selectedOption ? 'text-slate-900' : 'text-slate-500'
          }`}
        >
          {displayLabel}
        </span>
        <svg
          className={`h-5 w-5 flex-shrink-0 text-slate-500 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 8l4 4 4-4" />
        </svg>
      </button>

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          className={`absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-soft)] ${menuClassName}`}
        >
          <div className="max-h-64 overflow-y-auto py-1">
            {options.map((option, optionIndex) => {
              const isSelected = option.value === value;
              const isActive = optionIndex === activeOptionIndex;
              const isDisabled = disabled || Boolean(option.disabled);

              return (
                <button
                  key={option.value}
                  id={getOptionId(optionIndex)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={isDisabled}
                  onMouseEnter={() => {
                    if (!isDisabled) {
                      setActiveOptionIndex(optionIndex);
                    }
                  }}
                  onClick={() => {
                    if (!isDisabled) {
                      handleSelect(option.value);
                    }
                  }}
                  className={`w-full px-3 py-2.5 text-left text-base flex items-center gap-3 bg-white ${
                    isSelected
                      ? 'bg-[rgba(43,190,156,0.12)] text-slate-900'
                      : isActive
                      ? 'bg-slate-50 text-slate-900'
                      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  } ${isDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-4 w-4 items-center justify-center text-[color:var(--color-primary)]"
                  >
                    {isSelected ? (
                      <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-4 w-4"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M16.5 5.5l-8 8-4-4"
                        />
                      </svg>
                    ) : null}
                  </span>
                  <span className="min-w-0 truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
