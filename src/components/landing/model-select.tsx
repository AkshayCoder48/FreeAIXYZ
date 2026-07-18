"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { MODELS, PROVIDER_INFO, type ProviderId } from "@/lib/providers";

export interface ModelOption {
  id: string;
  provider: ProviderId;
  description: string;
  category: string;
}

const ALL_OPTIONS: ModelOption[] = MODELS.map((m) => ({
  id: m.id,
  provider: m.provider,
  description: m.description,
  category: m.category,
}));

interface ModelSelectProps {
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

export function ModelSelect({ value, onChange, className }: ModelSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const selected = ALL_OPTIONS.find((m) => m.id === value);

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return ALL_OPTIONS;
    return ALL_OPTIONS.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        (PROVIDER_INFO[m.provider]?.name ?? "").toLowerCase().includes(q),
    );
  }, [query]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    for (const m of filtered) {
      const arr = map.get(m.provider) ?? [];
      arr.push(m);
      map.set(m.provider, arr);
    }
    return map;
  }, [filtered]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal h-9", className)}
        >
          <span className="truncate text-left">
            {selected ? (
              <>
                <span className="text-foreground">{selected.id}</span>
                <span className="text-muted-foreground text-[10px] ml-2 hidden sm:inline">
                  {PROVIDER_INFO[selected.provider]?.name}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Select model…</span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <CommandInput
              placeholder={`Search ${ALL_OPTIONS.length} models by name, provider, or description…`}
              value={query}
              onValueChange={setQuery}
              className="h-9 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </div>
          <CommandList className="max-h-[350px] overflow-y-auto">
            <CommandEmpty>
              {query ? `No models found for "${query}".` : "Type to search…"}
            </CommandEmpty>
            {Array.from(grouped.entries()).map(([provider, models]) => (
              <CommandGroup
                key={provider}
                heading={`${PROVIDER_INFO[provider as ProviderId]?.name ?? provider} (${models.length})`}
              >
                {models.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={m.id}
                    onSelect={() => {
                      onChange(m.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="flex flex-col items-start gap-0.5 py-1.5"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          value === m.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="text-sm font-medium truncate">{m.id}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground pl-5 line-clamp-1">
                      {m.description}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
