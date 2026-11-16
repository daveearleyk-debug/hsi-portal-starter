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

Verification: syntax checks and 111 automated tests passed locally. Live API
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

Inspection History includes an address/service search, Buyer/Pre-sale type
selector, year selector, matching-results count and Clear filters button.
Filters combine and operate only on the agent-authorized history already
loaded. Relationship snapshot values are not affected by filters. No extra
Spectora calls are made when typing or changing filters.

Realtor ranking card: a gold panel beneath the agent name/agency shows Overall,
Buyers, Sellers and Pre-sales ranks against the HSI connection-stats roster.
Overall, buyer and seller scores use Spectora total_inspections_count,
buying_inspections_count and selling_inspections_count. Pre-sale scores count
company inspections with an explicitly null buyer and a matching seller.
Pre-sales remain part of selling and are not added a second time to overall.
Competition ranking is used: equal scores share a rank (1, 1, 3).

Ranking collections paginate through the full company stats and inspection
results, up to 50 pages of 200 records each. Every record remains company
validated; only the authorized agent's ranking and the roster size are sent
to that agent's browser. Other agents' names, contact details, inspection
links and counts are not returned. Ranking data stays in memory for 15 minutes;
concurrent requests share a refresh. The card displays its update time. A
ranking error displays an unavailable message while keeping the portal usable.
No extra environment variables are required; PORTAL_RANKINGS_ENABLED=false is
an optional operator opt-out. Existing private agent links still work.

Verification: syntax checks and 111 automated tests pass locally. Ranking
logic was also exercised with minimized live MCP response structures for
28 agents and 1,186 inspection records. Hosted API-key calls and rendered
browser appearance require confirmation after deployment.

Compact ranking layout: all four ranks sit in one horizontal row beneath a
short header. Gold styling, overall emphasis, visible tie indicators and
accessible inspection counts remain. Repeated inspection counts and footer
copy are removed from the visible card. The update timestamp is available on
hover. This is a frontend layout update; ranking calculations are unchanged.
Validation: syntax checks and the 111 existing automated tests pass locally.

Official HSI branding: original HSI Logo.png replaces the loading placeholder;
original Letterhead(2).jpg appears at the upper left of the portal header.
Both supplied files are copied byte-for-byte into public/assets, rendered
without cropping at their original aspect ratios. The server declares JPG
and JPEG image MIME types. Loading/header styling uses white backgrounds to
blend with the supplied image backgrounds. App and stylesheet versions are
updated so browsers fetch the new branding. Existing agent avatars remain
unchanged. Validation: syntax checks, 111 automated tests, and local HTTP
checks for exact original image bytes and correct content types passed.

Header/date refinements: remove the tagline paragraph beneath the official
header logo; give the upper-right Agent Portal badge a pale green background,
logo-green #8ec63f border and dark green text; add a year below the day in each
inspection date icon. Date icons use semantic time elements with complete
accessible dates. App/stylesheet asset versions are bumped for refreshed
browser caches. No environment or backend changes are required.
Validation: syntax checks and 111 tests pass, including multi-year date icons.

Partner-tier badge removed from the portal UI, including its unused styles.
No environment value or default sample tier can restore it, because the page
no longer renders a tier. Rankings, agent identity and inspection history
remain as before. Browser asset versions are bumped. Validation: syntax
checks and all 111 existing automated tests pass locally.
