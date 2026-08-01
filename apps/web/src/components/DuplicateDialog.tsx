"use client";

/**
 * DuplicateDialog — shown when uploading files that already exist
 * in the target folder.  Lets the user choose how to proceed:
 * Replace existing, Keep both, or Skip duplicates.
 */

import { Button, Card } from "@/components/ui";
import { AlertCircle } from "lucide-react";

export type DuplicateAction = "replace" | "keep" | "skip";

interface DuplicateDialogProps {
  open: boolean;
  /** Number of duplicates detected. */
  count: number;
  /** First duplicate filename (for single-file message). */
  firstName?: string;
  onChoose: (action: DuplicateAction) => void;
  onCancel: () => void;
}

export function DuplicateDialog({ open, count, firstName, onChoose, onCancel }: DuplicateDialogProps) {
  if (!open) return null;

  const isSingle = count === 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px] animate-fade-in">
      <div className="animate-pop-in w-full max-w-sm">
        <Card className="p-6">
          <div className="flex items-start gap-3 mb-4">
            <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-base font-semibold text-slate-900 mb-1">
                {isSingle ? "This file already exists" : `${count} duplicate files detected`}
              </h2>
              <p className="text-sm text-slate-500">
                {isSingle
                  ? `"${firstName}" already exists in this folder. Choose how to continue:`
                  : "Choose how to continue:"}
              </p>
            </div>
          </div>

          <div className="space-y-2 mb-5">
            <button
              onClick={() => onChoose("replace")}
              className="w-full text-left rounded-xl border border-slate-200 px-4 py-3 text-sm hover:bg-slate-50 hover:border-slate-300 transition-all"
            >
              <span className="font-medium text-slate-800">Replace existing</span>
              <span className="block text-xs text-slate-400 mt-0.5">Overwrite the existing file(s)</span>
            </button>
            <button
              onClick={() => onChoose("keep")}
              className="w-full text-left rounded-xl border border-slate-200 px-4 py-3 text-sm hover:bg-slate-50 hover:border-slate-300 transition-all"
            >
              <span className="font-medium text-slate-800">Keep both</span>
              <span className="block text-xs text-slate-400 mt-0.5">Upload with a different name</span>
            </button>
            <button
              onClick={() => onChoose("skip")}
              className="w-full text-left rounded-xl border border-slate-200 px-4 py-3 text-sm hover:bg-slate-50 hover:border-slate-300 transition-all"
            >
              <span className="font-medium text-slate-800">Skip duplicates</span>
              <span className="block text-xs text-slate-400 mt-0.5">Only upload files that don't exist</span>
            </button>
          </div>

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
