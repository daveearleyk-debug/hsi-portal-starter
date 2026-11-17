HSI Agent Portal — Online Report Viewer Update

Extract this ZIP and upload server.js and public/app.js to the same locations in GitHub. Commit and wait for Render to deploy, then refresh the portal. The included tests can also be uploaded to keep the repository checks current.

Behavior
- Before January 1, 2023: the existing Documents PDF selection and View report PDF label are unchanged.
- January 1, 2023 onward: published reports use their own validated report UUID in https://reports.spectora.com/v/reports/REPORT_UUID?ignoreClientComplete=true and are labeled View inspection report.
- Multiple published reports receive their own links. Unrelated, unpublished, canceled and missing reports are not linked.
- Native reports no longer depend on pdf_url and do not require an individual report-detail API request.
- Report lookup diagnostics are retained. No environment changes are required.

Known live blocker
The deployed API key currently receives HTTP 401 from /v2/reports. This package changes the destination and simplifies the lookup, but cannot resolve that upstream authorization failure. Newer viewer links will appear once Spectora supplies the report IDs through the report list. An inspection ID or slug cannot be substituted for a report UUID. The example UUID supplied in conversation is not assigned to every inspection or hardcoded to an unverified inspection.

Validation
133 automated checks passed; JavaScript syntax checks and diff checks passed. Tests cover the exact viewer URL format, UUID validation, matching each report to its authorized inspection, the January 1 cutoff, preserved older PDF labels and behavior, pagination, caching, missing reports and API failure. Authenticated live lookup remains blocked as described above.
