# Evidence processing

The active evidence-upload route stores metadata and extracted text. It discards
original bytes and does not call an AI model. A scan can be accepted without a
text preview. Verification controls remain previews; see
[current limitations](known-limitations.md).

## Validation order

Uploads use Route Handlers with `request.formData()`. Keep file-upload routes
excluded from proxy body buffering. The whole batch is limited to 4 MB of file
data to leave room for the request envelope.

The processing modules under `src/lib/evidence/` apply these checks:

1. Enforce file and batch size limits.
2. Identify formats by magic bytes (`sniff.ts`).
3. Check ZIP expansion before decompressing Office files (`zip-guard.ts`).
4. Extract text under time and output limits (`extract.ts`).
5. Parse PDF text with page limits (`pdf.ts`).

PDF extraction reconstructs rows and columns from fragment coordinates to retain
table structure. Extracted content is untrusted data: sanitize it before display
or inclusion in any prompt, and never interpret document text as instructions.

## Legacy integration

`src/lib/evidence/index.ts` also contains an older `processUpload()` flow and
Anthropic Files API helpers. These are separate from the active record-upload
workflow. Their presence does not mean current evidence ingest requires an
Anthropic key or uploads documents to a model provider.

## Tests

`src/lib/evidence/hardening.test.ts` and `pdf.test.ts` cover document handling;
`src/lib/ams/evidence-upload.test.ts` covers the record-upload route.
Run them through the [standard test suite](testing.md).
