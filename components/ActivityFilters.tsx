"use client";

import { useState } from "react";

export interface FilterValues {
  type?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export function ActivityFilters({
  onChange,
  initial,
}: {
  onChange: (f: FilterValues) => void;
  initial?: FilterValues;
}) {
  const [type, setType] = useState(initial?.type ?? "");
  const [from, setFrom] = useState(initial?.from ?? "");
  const [to, setTo] = useState(initial?.to ?? "");
  const [limit, setLimit] = useState(String(initial?.limit ?? "50"));

  function apply() {
    onChange({
      type: type || undefined,
      from: from || undefined,
      to: to || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  function reset() {
    setType("");
    setFrom("");
    setTo("");
    setLimit("50");
    onChange({});
  }

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-600">Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
          aria-label="Filtre type"
        >
          <option value="">Tous</option>
          <option value="running">Running</option>
          <option value="cycling">Cycling</option>
          <option value="swimming">Swimming</option>
          <option value="hiking">Hiking</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-600">Depuis</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
          aria-label="Date début"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-600">Jusqu&apos;à</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
          aria-label="Date fin"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-600">Limite</label>
        <select
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
          aria-label="Limite"
        >
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </div>
      <button
        onClick={apply}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
      >
        Appliquer
      </button>
      <button
        onClick={reset}
        className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-zinc-50"
      >
        Réinitialiser
      </button>
    </div>
  );
}
