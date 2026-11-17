HSI Report Lookup Diagnostics

This is a diagnostic update, not a confirmed fix for missing Spectora report links.

1. Extract this ZIP.
2. Upload server.js to the root of the GitHub repository and commit.
3. Wait for Render to finish deploying.
4. Refresh an agent portal showing inspections from 2023 onward.
5. In Render, open the hsi-agent-portal service, then Logs. Search for spectora_report_lookup.
6. Copy those lines or send a screenshot so the live failure can be identified.

The logs show report-list HTTP errors, record counts, matching/published report counts, detail-response mismatches and available/null PDF counts. They do not contain API keys, access links, client details, inspection addresses or report URLs.

The working pre-January 2023 report-selection function is byte-for-byte unchanged. Public files, layout and document-link behavior are unchanged. No new environment variables are needed.

Validation: 132 automated tests passed, syntax checks passed, and legacy report-selection code was compared before/after. The root cause still requires the live diagnostic output.
