'use client';

import type { AIProvider } from '@shared/types/constants';
import type { ModelType } from '@shared/types/data/model';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@web/components/ui/command';
import { Input } from '@web/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@web/components/ui/popover';
import { useModelsDevFiltered } from '@web/hooks/use-models-dev';
import { cn } from '@web/utils/ui/utils';
import { CheckIcon, ChevronsUpDownIcon, LoaderIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface ModelAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  provider?: AIProvider | null;
  modelType?: ModelType;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
}

/**
 * Autocomplete input component for model names with suggestions from models.dev
 * Allows free-form input while providing filtered suggestions based on provider and query
 */
export function ModelAutocompleteInput({
  value,
  onChange,
  onBlur,
  provider,
  modelType,
  placeholder = 'e.g., gpt-5, text-embedding-3-small',
  className,
  id,
  disabled = false,
  'aria-invalid': ariaInvalid,
}: ModelAutocompleteInputProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverContentRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isClickingInsideRef = useRef(false);
  const isOpeningRef = useRef(false);

  const { models, isLoading, error } = useModelsDevFiltered(
    provider ?? null,
    inputValue,
  );

  // Filter models by type:
  // - When modelType is 'embed': only show models with "embed" (or "embedding"/"embeddings") in name/ID
  // - When modelType is 'text': show all models (including embedding models that can also do text)
  // - When modelType is undefined: show all models (backward compatibility)
  // This is a heuristic based on models.dev naming conventions where all embedding models
  // contain the letters "embed" in their model ID or name (case-insensitive check)
  // Examples: "text-embedding-3-small", "cohere-embed-v3", "gemini-embedding-001"
  const filteredModels = useMemo(() => {
    if (modelType === 'embed') {
      // Only show embedding models - check for "embed" substring which catches:
      // "embed", "embedding", "embeddings" (case-insensitive)
      return models.filter((item) => {
        const modelId = (item.model.id ?? '').toLowerCase();
        const modelName = (item.model.name ?? '').toLowerCase();
        return modelId.includes('embed') || modelName.includes('embed');
      });
    }
    // For 'text' or undefined: show all models (some embedding models can also be used for text)
    return models;
  }, [models, modelType]);

  // Log errors for debugging
  useEffect(() => {
    if (error) {
      console.error('[ModelAutocompleteInput] Error loading models:', error);
    }
  }, [error]);

  // Sync input value with prop value
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue);
    // Open dropdown when typing (allows free-form input with suggestions)
    setOpen(true);
  };

  const handleSelect = (selectedModelId: string): void => {
    setInputValue(selectedModelId);
    onChange(selectedModelId);
    setOpen(false);
    // Keep focus on input after selection
    inputRef.current?.focus();
  };

  const handleInputFocus = (): void => {
    // Open dropdown on focus - always show suggestions when focused
    if (!open) {
      isOpeningRef.current = true;
      setOpen(true);
      // Reset opening flag after a short delay
      setTimeout(() => {
        isOpeningRef.current = false;
      }, 150);
    }
  };

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>): void => {
    // Don't close if we're in the process of opening
    if (isOpeningRef.current) {
      return;
    }

    // Check if focus is moving to the popover
    const relatedTarget = e.relatedTarget as Node | null;
    const isMovingToPopover =
      popoverContentRef.current?.contains(relatedTarget) ?? false;

    if (!isMovingToPopover) {
      // Delay closing to allow click events on suggestions
      timeoutRef.current = setTimeout(() => {
        // Double-check we're not clicking inside or opening before closing
        if (!isClickingInsideRef.current && !isOpeningRef.current) {
          setOpen(false);
          onBlur?.();
        }
      }, 200);
    }
  };

  const handleInputClick = (e: React.MouseEvent<HTMLInputElement>): void => {
    // Open dropdown when clicking on input and ensure focus stays
    if (!disabled) {
      e.stopPropagation();
      isOpeningRef.current = true;
      setOpen(true);
      // Ensure input maintains focus - use requestAnimationFrame for better timing
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        // Reset opening flag after a short delay
        setTimeout(() => {
          isOpeningRef.current = false;
        }, 150);
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // Allow Escape to close
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
    // Allow ArrowDown to open if closed
    if (e.key === 'ArrowDown' && !open) {
      setOpen(true);
      e.preventDefault();
    }
  };

  // Handle clicks inside popover to prevent closing
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent): void => {
      if (popoverContentRef.current?.contains(e.target as Node)) {
        isClickingInsideRef.current = true;
      }
    };

    const handleMouseUp = (): void => {
      // Reset after a short delay
      setTimeout(() => {
        isClickingInsideRef.current = false;
      }, 100);
    };

    if (open) {
      document.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-full">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative w-full">
            <Input
              ref={inputRef}
              id={id}
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              onClick={handleInputClick}
              onKeyDown={handleKeyDown}
              onMouseDown={(_e) => {
                // Prevent PopoverTrigger from stealing focus
                // Keep focus on input by ensuring focus happens after PopoverTrigger handling
                if (!disabled && inputRef.current) {
                  // Use setTimeout to ensure focus happens after any PopoverTrigger handling
                  setTimeout(() => {
                    if (
                      inputRef.current &&
                      document.activeElement !== inputRef.current
                    ) {
                      inputRef.current.focus();
                    }
                  }, 0);
                }
              }}
              placeholder={placeholder}
              className={cn(className, ariaInvalid && 'border-destructive')}
              disabled={disabled}
              aria-invalid={ariaInvalid}
              aria-expanded={open}
              aria-autocomplete="list"
              role="combobox"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
              {isLoading && (
                <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              <ChevronsUpDownIcon className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </PopoverTrigger>
        <PopoverContent
          ref={popoverContentRef}
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          onOpenAutoFocus={(e) => {
            // Prevent auto-focus on popover open - keep focus on input
            e.preventDefault();
            // Ensure input maintains focus after popover opens
            setTimeout(() => {
              inputRef.current?.focus();
              // Reset opening flag
              isOpeningRef.current = false;
            }, 0);
          }}
          onEscapeKeyDown={() => {
            setOpen(false);
            inputRef.current?.focus();
          }}
          onInteractOutside={(e) => {
            // Don't close if clicking on the input
            if (inputRef.current?.contains(e.target as Node)) {
              e.preventDefault();
            }
          }}
        >
          <Command shouldFilter={false}>
            <CommandList>
              <CommandEmpty>
                {isLoading
                  ? 'Loading models...'
                  : error
                    ? 'Failed to load models. You can still type manually.'
                    : 'No models found'}
              </CommandEmpty>
              {filteredModels.length > 0 && (
                <CommandGroup>
                  {filteredModels
                    .slice(0, 50)
                    .filter((item) => item.model.id) // Filter out items without id
                    .map((item) => {
                      // model.id is always set in flattened models, but TypeScript doesn't know that
                      const modelId = item.model.id ?? '';
                      const isSelected = inputValue === modelId;

                      return (
                        <CommandItem
                          key={modelId}
                          value={modelId}
                          onSelect={handleSelect}
                          className="flex items-center justify-between cursor-pointer"
                        >
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <span className="text-sm font-medium truncate">
                              {modelId}
                            </span>
                            {item.model.name && item.model.name !== modelId && (
                              <span className="text-xs text-muted-foreground truncate">
                                {item.model.name}
                              </span>
                            )}
                            {item.providerName && (
                              <span className="text-xs text-muted-foreground truncate">
                                {item.providerName}
                              </span>
                            )}
                          </div>
                          <CheckIcon
                            className={cn(
                              'h-4 w-4 shrink-0',
                              isSelected ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                        </CommandItem>
                      );
                    })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
