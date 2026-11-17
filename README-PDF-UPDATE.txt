HSI Agent Portal — PDF Report Links

Upload server.js and public/app.js to the same locations in your GitHub repository, commit, and let Render finish deploying. The included test files can also be uploaded to keep the repository tests current. Keep the existing assets and environment settings.

Changes
- Inspection history now shows View report PDF instead of the client portal link.
- Published Spectora PDF links are matched to their inspection. Multiple reports get separate named links.
- Recognizable inspection/WETT report PDFs in Documents are also linked, including older records. Internal documents and invoices/agreements are excluded.
- Records stay visible with no report link when no suitable PDF is returned.
- A report API failure does not prevent inspection history from loading.
- Existing contact card, WhatsApp icon, filters and calendar are retained.

Verification
129 automated checks passed, plus JavaScript syntax checks. Tested native and uploaded reports, multiple-page matching, inaccessible/absent PDFs, unrelated documents, canceled records, and agent/company scoping. The /v2/reports endpoint exists, but authenticated native PDF retrieval and opening the links still require verification after deployment. Existing source safety scan flags synthetic test URLs in test fixtures/history; no API keys are included in this package.

After deployment
Open a known recent report and an older Documents report, and verify a record with no PDF stays visible without a link. Refresh the portal if it was already open.
