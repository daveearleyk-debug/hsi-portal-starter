'use strict';

(function exposeModeCopy(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.portalModeCopy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => ({
  modeNotice(mode) {
    if (mode === 'demo') return 'Demonstration only: these are fictional records with non-specific locations.';
    if (mode === 'live') return 'Live data: buyer-side inspection history for this agent and company. Links open the Spectora client portal.';
    return 'Data mode unavailable. Do not rely on this inspection history.';
  }
}));
