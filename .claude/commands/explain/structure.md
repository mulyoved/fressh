---
description: Explain code as a Nested Function Hierarchy with concise notes on structure and data flow
argument-hint: "[optional: file_or_symbol | key=value ...]  e.g. src/invoice/import.ts  or  focus=processInvoiceCsvImport depth=3"
allowed-tools: Read, Bash
---

# Goal
Generate a **Nested Function Hierarchy** explanation of the provided code, focusing on structure (functions, calls, branches, loops, try/catch), with brief notes on data flow, side effects, and risks.

# Inputs (the command supports any of these)
- **Selection**: If the user has selected code in the editor, treat that as the primary input.
- **Attached files**: If the user invoked this command with one or more `@` file references, read and use them.
- **Arguments**: Parse `$ARGUMENTS`:
  - If it looks like a **path**, attempt to read that file.
  - Support simple **key=value** pairs (any order): `focus=<symbol>`, `file=<path>`, `depth=<int>`, `lang=<ts|js|py|go|rb|java>`
  - If a bare token remains (no `=`), treat it as a `focus` symbol name (entry function/class).

## Light repo context (best-effort; safe if not a git repo)
- Repo root: !`git rev-parse --show-toplevel 2>/dev/null || pwd`
- Branch: !`git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(no git)"`
- If $ARGUMENTS looks like a path, show first 400 lines so you can analyze even without explicit @-attachment:
!`if [ -n "$ARGUMENTS" ] && [ -f "$ARGUMENTS" ]; then printf "\n===== FILE: %s (first 400 lines) =====\n" "$ARGUMENTS"; nl -ba "$ARGUMENTS" | sed -n '1,400p'; fi`

# What to analyze
1) Prefer **selection** if present. Else, use **attached files**. Else, if `$ARGUMENTS` contains `file=...` or a bare path, analyze that.  
2) If `focus=<symbol>` (or a bare token) is provided, treat that as the entry function/class; otherwise infer a sensible entrypoint (exported function, main handler, or top-most significant routine).  
3) Default `depth=3` (levels of calls). If `depth` is provided, obey it (cap at 6).  
4) Be language-aware but tolerant (TS/JS/Python/Go/Java/Ruby). Infer return types and effects when not explicit.

# Output format — **strict**
**Produce exactly these sections, in order. Keep it tight and scannable.**

## 1) Title line
- `Nested Function Hierarchy — <entry symbol or file>`

## 2) The tree (use these glyphs exactly)
- Use `│`, `├─`, `└─` for the structure.
- Show calls as `functionName(args) → ReturnType` (infer type if possible).
- Show non-call structure as labeled nodes:
  - `TRY BLOCK {` … `}` and `CATCH/FINALLY`
  - `IF <cond>:` / `ELSE IF <cond>:` / `ELSE:`
  - `FOR <iterable> {` … `}` / `WHILE <cond> {` … `}`
- Add brief inline notes in square brackets when valuable, e.g. `[DB read]`, `[HTTP POST]`, `[mutation]`, `[transaction]`, `[cache]`.
- Example formatting (for reference):
```
processInvoiceCsvImport({csvContent, organizationId, userId})
│
├─ TRY BLOCK {
│   ├─ parseCSVContent(csvContent) → ParsedCsvRow[]
│   │   └─ @fast-csv/parse.parseString() [stream parse]
│   ├─ validateAndGroupRows(rows, errors) → Map<string, ParsedCsvRow[]>
│   └─ FOR [invoiceId, invoiceRows] OF invoiceGroups {
│       └─ processInvoiceGroup(invoiceId, invoiceRows, context)
│           ├─ retrieveInvoice(invoiceId, type, firstRow, context)
│           │   ├─ IF regular: prisma.invoice.findUnique() [DB read]
│           │   └─ IF future:
│           │       ├─ extractCustomerIdFromFutureInvoice()
│           │       └─ getPlannedInvoices() [DB read]
│           └─ processInvoice(invoice, customerId, …)
│               ├─ convertToInvoiceData(invoice)
│               ├─ validateInvoiceForProcessing(…) [guards]
│               │   ├─ prisma.customer.findUnique() [DB read]
│               │   └─ InvoiceValidator.validateDates()
│               ├─ processLineItems(invoiceRows, invoice, type, context)
│               │   ├─ IF regular: processRegularInvoiceLineItems() [matching]
│               │   └─ IF future: processFutureInvoiceLineItems()
│               │       └─ detectFutureInvoiceChanges()
│               ├─ prepareInvoiceData(firstRow, newLines, …)
│               ├─ determineInvoiceStatus(invoice, firstRow)
│               └─ saveInvoiceChanges(invoiceData, context)
│                   └─ doSaveInvoice() [DB transaction]
│   }
└─ CATCH BLOCK { castError() → throws formatted error }
```

## 3) Quick notes (bulleted; one line each)
- **Data flow:** where inputs come from and key transformations.
- **Side effects:** DB/FS/HTTP/cache/env changes.
- **Error handling:** where errors are caught/propagated.
- **Performance hotspots:** obvious loops, N+1, repeated I/O, quadratic merges.
- **Risky areas:** validation gaps, mutation of shared state, concurrency edges.

## 4) Follow-ups (optional, ≤5 bullets)
- Specific, actionable next steps (e.g., add idempotency key, batch DB writes, memoize parse schema).

# Constraints & style rules
- Keep tree depth to `depth` (default 3). Collapse deeper chains with `…` if needed.
- Favor **structure over prose**; keep notes concise.
- Never invent functions not implied by code. If inferring, mark with `[inferred]`.
- If input is huge, focus on the entrypoint and most-called paths.
- If nothing looks like a function, draw the structure by file sections (top-level init, handlers, helpers).

# Now do the work
1) Parse `$ARGUMENTS` for `file=`, `focus=`, `depth=`, `lang=` and/or a bare token.
2) Load selection and/or any `@`-attached files (and `$ARGUMENTS` file if provided).
3) Build the tree per rules above (respect depth).
4) Produce the **Quick notes** and **Follow-ups**.