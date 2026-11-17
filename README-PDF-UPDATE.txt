HSI Agent Portal — Corrected PDF Report Links

Upload server.js and public/app.js to the same locations in GitHub, commit, and wait for Render to finish deploying. Then refresh the portal. The test files are included to keep repository tests current.

Report selection uses the inspection date, preserving its local calendar day:
- Before January 1, 2023: recognizable report PDFs from Documents only.
- January 1, 2023 onward: Spectora Inspection Report PDFs only, using the actual pdf_url from GET /v2/reports/{report_id}.
- No Documents fallback for January 2023 onward.
- Null/restricted/unpublished/missing PDFs leave the inspection visible without a report link.

Correction
The previous package read the report list, whose schema omits pdf_url. This version lists the report IDs, matches them to authorized inspections, then retrieves individual report details to obtain pdf_url. It never constructs a PDF link from an inspection slug or report ID. Report requests use bounded concurrency and short caches. Link navigation lets the browser follow PDF-host redirects normally; the portal does not download or cache PDF contents or bypass Spectora payment/agreement restrictions.

Validation
131 automated tests passed plus JavaScript syntax and diff checks. Regression tests model a report list without pdf_url and verify the individual detail lookup, the exact January 1 cutoff, missing/restricted PDFs, older Documents, caching and report/inspection/agent matching. Authenticated live report retrieval still needs checking after deployment.

All existing contact-card, WhatsApp, filter and calendar features are retained.
