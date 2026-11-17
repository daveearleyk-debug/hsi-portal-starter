HSI Agent Portal — Restore Client Portal Links

Extract and upload server.js and public/app.js to the same locations in GitHub. Commit, wait for Render to deploy, then refresh the portal. The test files can also be uploaded to keep repository checks current.

January 1, 2023 onward: Open client portal links use the inspection slug at https://portal.spectora.com/inspection/SLUG. Scheduled and published inspections can have a portal link. Missing or invalid slugs and canceled inspections have no link.

Before January 1, 2023: the working Documents PDF selection and View report PDF wording are unchanged. Records without a suitable document stay visible without a link.

The report-list and report-detail API requests and temporary report diagnostics have been removed. This version does not depend on the report endpoint returning report IDs or pdf_url, so the report-lookup HTTP 401 does not affect the restored links. No environment changes are required.

132 automated tests passed, JavaScript syntax checks passed, and older document-selection code was compared byte-for-byte to confirm it is unchanged. Tests cover the January 1 boundary, modern scheduled and published client portals, older PDFs, missing documents, canceled records, malformed slugs, agent scoping and the absence of report API calls.

Keep this behavior until Spectora provides a solution for report access.
