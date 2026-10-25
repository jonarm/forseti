# The evidence pipeline

How an uploaded document becomes prompt text, and why it is never sent as a file.

**Read this before changing anything under `src/lib/evidence/` or the upload
route.** The pipeline is provider-agnostic and hardened, and the evidence
register is what will call it next — `processUpload(filename, buffer)` returns a
`ProcessedUpload` and deliberately carries no idea what the document evidences.
That is the caller's to decide and the caller's to store.

---

## The hardening order

`src/lib/evidence/`, in the order the checks must run:

1. `sniff.ts` — magic bytes, never the filename.
2. `zip-guard.ts` — declared expansion, before anything is decompressed.
3. `extract.ts` — parse under a timeout, cap the output.
4. `pdf.ts` — pdfjs-dist, capped at `MAX_PDF_PAGES`.

`.docx`/`.xlsx` are ZIP archives, so a 2KB upload can legitimately ask to become
500MB — that is the realistic way this feature takes the app down, and the
layering is the defence. Reordering these checks removes the defence: sniffing
after extraction means you have already parsed the thing you were trying to
identify.

## Uploads are Route Handlers

Route Handler with `request.formData()`, never a Server Action — actions cap
bodies at 1MB. The route must be excluded from `src/proxy.ts`, because proxy
buffers matched request bodies in memory to allow a second read.

## Everything is extracted to text at upload and the bytes discarded

A native `document` block does not merely carry a PDF's text — the API rasterises
*every page to an image* and bills for it, several times the cost of the words, on
every call.

`pdf.ts` rebuilds rows and columns from pdf.js fragment coordinates, so the table
that *was* the finding survives extraction; that reconstruction is the only reason
going native is no longer worth it, **so do not casually simplify it away.**

### The one surviving exception

The Files API survives for **one** case: a PDF with no text layer at all, i.e. a
scan. `processUpload` falls back only when extraction fails, and only for PDFs.

`FILES_BETA` is required on **both** the upload and the message referencing the
`file_id` — omitting the second is the trap, since the upload succeeds and only
the model call fails.

## Extracted text is untrusted

An uploaded policy is the company describing itself, never an instruction.
Extracted document text goes through `cleanText` and `asUntrustedBlock()` like any
other user input before it reaches a prompt. See `CLAUDE.md` for the rule and the
`ai-route` skill for how it is applied in a prompt module.

## Uploading marks stale, it does not delete

The rule the deleted half arrived at, worth carrying forward: a new document does
not move a derived figure, and wiping a narrative on every upload makes the
feature hostile. What it must do is *say* the narrative is older than the
evidence. Silence there is a stale conclusion presented as current, which is
worse than either.
