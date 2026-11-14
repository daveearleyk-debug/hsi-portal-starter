# HSI portal customizations

These customizations supersede the starter README statements about local-only
profile images and excluding inspection links.

- Live history includes only inspections whose current buying-agent connection
  matches the signed portal grant. Listing-only records are excluded.
- Relationship statistics still show the separate buying and selling counts.
- History requests up to 200 recent records from Spectora, then applies the
  company and buyer checks. Accounts exceeding 200 need pagination added.
- Profile photos load directly from cdn.spectora.com, restricted to its user
  and connection image paths. A failed image uses the local placeholder.
- Each buyer inspection can open its Spectora client portal in a separate tab.
  That portal can contain reports, invoices, agreements and other client details.
  Inspection links are constructed from validated API slugs, not report IDs.
- Missing, malformed or canceled-record slugs do not produce clickable links.
- API credentials remain server-side. Signed grant/company/relationship checks
  remain active. Grant links still expire within 24 hours.
- No live credentials, agent photos or inspection records are packaged here.

Verification: syntax checks and 81 automated tests passed locally. Live API
response structures were also exercised locally; hosted browser photo display
and navigation must be checked after deployment.
