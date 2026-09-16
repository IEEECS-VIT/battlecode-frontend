"use client";

import { useState } from "react";
import { showInfoToast } from "@/components/shared/CustomToast";

const DEFAULT_LIMIT = 40;
const WRAP_NOTE =
  "This test case is one line, but it may render as multiple lines due to lack of space.";

function toText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data == null) return "";
  if (typeof data === "object") return JSON.stringify(data, null, 2);
  return String(data);
}

type ExpandableTestCaseProps = {
  value: unknown;
  limit?: number;
};

export default function ExpandableTestCase({
  value,
  limit = DEFAULT_LIMIT,
}: ExpandableTestCaseProps) {
  const [expanded, setExpanded] = useState(false);
  const text = toText(value);
  const isLong = text.length > limit;

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) showInfoToast(WRAP_NOTE);
  };

  if (!isLong) {
    return (
      <pre className="mt-1 max-w-full overflow-hidden break-all whitespace-pre-wrap rounded bg-gray-800/60 p-2 [overflow-wrap:anywhere]">
        {text}
      </pre>
    );
  }

  return (
    <div className="mt-1 min-w-0 max-w-full overflow-hidden rounded bg-gray-800/60 p-2 font-mono text-sm">
      <div className="flex min-w-0 items-baseline">
        <span className="min-w-0 truncate">{text.slice(0, limit)}</span>
        <button
          type="button"
          onClick={handleToggle}
          className="shrink-0 text-amber-400 hover:text-amber-300"
          aria-label={expanded ? "Hide full test case" : "Show full test case"}
          aria-expanded={expanded}
        >
          ...
        </button>
      </div>
      {expanded && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <pre className="max-w-full overflow-hidden break-all whitespace-pre-wrap [overflow-wrap:anywhere]">
            {text}
          </pre>
          <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200/90">
            {WRAP_NOTE}
          </p>
          <button
            type="button"
            onClick={handleToggle}
            className="mt-2 text-xs font-medium text-amber-400 hover:text-amber-300"
          >
            Show less
          </button>
        </div>
      )}
    </div>
  );
}
