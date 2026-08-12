import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExpandableSectionProps {
  title: string;
  children: React.ReactNode;
  storageKey?: string;
  defaultExpanded?: boolean;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  staticSection?: boolean;
}

export function ExpandableSection({
  title,
  children,
  storageKey,
  defaultExpanded = false,
  className,
  headerClassName,
  contentClassName,
  staticSection = false,
}: ExpandableSectionProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    // Initialize from localStorage if storageKey provided
    if (storageKey && typeof window !== 'undefined') {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        return stored === 'true';
      }
    }
    return defaultExpanded;
  });

  // Persist expand/collapse state to localStorage
  useEffect(() => {
    if (storageKey && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, String(isExpanded));
    }
  }, [storageKey, isExpanded]);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleExpand();
      }
    },
    [toggleExpand]
  );

  if (staticSection) {
    return (
      <div className={cn('border rounded-lg bg-white shadow-sm', className)}>
        {title ? (
          <div className={cn('w-full px-4 py-3 flex items-center justify-between bg-gray-50', headerClassName)}>
            <span className="text-sm font-semibold text-gray-900">{title}</span>
          </div>
        ) : null}
        <div className={cn('p-4 border-t border-gray-200', contentClassName, !title && 'border-t-0')}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('border rounded-lg bg-white shadow-sm', className)}>
      {/* Header - Clickable Area */}
      <button
        type="button"
        onClick={toggleExpand}
        onKeyDown={handleKeyDown}
        aria-expanded={isExpanded}
        aria-controls={`expandable-content-${storageKey || title}`}
        className={cn(
          'w-full px-4 py-3 flex items-center justify-between',
          'bg-gray-50 hover:bg-gray-100 active:bg-gray-200',
          'transition-colors duration-200 ease-in-out',
          'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset',
          'cursor-pointer select-none',
          headerClassName
        )}
      >
        <span className="text-sm font-semibold text-gray-900">{title}</span>
        <ChevronDown
          className={cn(
            'w-5 h-5 text-gray-500 transition-transform duration-300 ease-in-out',
            isExpanded && 'rotate-180'
          )}
          aria-hidden="true"
        />
      </button>

      {/* Content - Animated Expand/Collapse */}
      <div
        id={`expandable-content-${storageKey || title}`}
        className={cn(
          'overflow-hidden transition-all duration-300 ease-in-out',
          isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        )}
        role="region"
        aria-labelledby={title}
      >
        <div className={cn('p-4 border-t border-gray-200', contentClassName)}>
          {children}
        </div>
      </div>
    </div>
  );
}
