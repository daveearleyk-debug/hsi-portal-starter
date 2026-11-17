HSI Agent Portal — Rolling Seven-Day Availability

Extract and upload server.js and public/app.js to the same locations in GitHub. Commit, wait for Render to deploy, then refresh your portal. Included test files can also be uploaded.

The calendar now starts with today in the configured availability time zone and includes the following six dates: seven days total, inclusive. It no longer resets the start to Monday. For November 17, that means November 17 through November 23.

The heading is Availability — Next 7 Days. The displayed date range and accessibility label describe the rolling range. Cached availability refreshes when the local date changes, even if its usual five-minute cache has not expired. Existing tab-return and five-minute page refresh behavior remains.

The current report-link behavior is retained: client portal links for January 1, 2023 onward, and the working document PDF links before 2023. No new environment settings are needed.

Validation: 133 automated checks passed, including seven consecutive dates from a Tuesday, local date handling, year and DST boundaries, cache rollover at local midnight, calendar labels and existing portal behavior. JavaScript syntax and diff checks passed.
