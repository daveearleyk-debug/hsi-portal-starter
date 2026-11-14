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
  remain active. Original temporary grants still expire within 24 hours.
- No live credentials, agent photos or inspection records are packaged here.

Verification: syntax checks and 98 automated tests passed locally. Live API
response structures were also exercised locally; hosted browser photo display
and navigation must be checked after deployment.

History uses the API street address as its title. App scripts revalidate on each
visit; script URLs are versioned to replace previously cached browser copies.

Copy portal link restores the original authorized grant in a shareable URL,
so a second computer can open the same portal without generating a new link.
The grant is not extended: its original expiry and agent binding still apply.
If clipboard permission is unavailable, a selected read-only field permits
manual copying. The base website address remains an unauthenticated entry.

Permanent agent links are optional. PORTAL_AGENT_ACCESS_HASHES is a JSON object
mapping each company-specific connection ID to a SHA-256 hash of its private
p1 access code. Only the hash is configured in Render; the private code stays
in the bookmarkable agent link. A matching hash authorizes that agent until
removed or replaced and redeployed. Changing PORTAL_SIGNING_SECRET does not
revoke permanent links: remove/replace the relevant agent hash instead.
Existing temporary links keep their original expiration and signing checks.
All company and buyer-only inspection restrictions still apply.

Pre-sale rule: a record is included when this agent is the buying agent, or
when the buying-agent relationship is explicitly null and this agent is the
listing agent. The latter records are labelled Pre-sale inspection. A listing
with another buying agent stays excluded. Missing/ambiguous relationships
still fail closed, and company/agent checks remain active. Existing access
links and relationship statistics are preserved.

Relationship Snapshot adds a fourth Pre-sales tile, calculated using the same
classification rule as the displayed history. Existing Spectora Total,
Buying and Selling values remain aggregate provider statistics; Pre-sales
are part of Selling and are not added again to Total. Four metrics use a
readable two-by-two grid.
