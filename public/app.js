const app = document.getElementById('app');

function consumeGrant() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const grant = fragment.get('grant');
  if (grant) sessionStorage.setItem('portalGrant', grant);
  if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`);
  return grant || sessionStorage.getItem('portalGrant') || '';
}

const portalGrant = consumeGrant();

function text(value) {
  return value == null ? '' : String(value);
}

function fmtDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function monthDay(value) {
  const date = new Date(`${value}T00:00:00`);
  return {
    month: new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date),
    day: new Intl.DateTimeFormat('en-US', { day: '2-digit' }).format(date)
  };
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = text(value);
    else if (key.startsWith('aria-')) node.setAttribute(key, value);
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function getUuid() {
  const match = location.pathname.match(/\/agent\/([^/]+)/);
  return match?.[1] || 'demo-platinum-partner';
}

function applyBrand(company) {
  const colors = {
    '--gold': company.brand.primary,
    '--gold-dark': company.brand.accentText,
    '--ink': company.brand.ink,
    '--muted': company.brand.muted,
    '--surface': company.brand.surface,
    '--paper': company.brand.background,
    '--line': company.brand.border,
    '--green': company.brand.success,
    '--blue': company.brand.focus
  };
  for (const [property, value] of Object.entries(colors)) document.documentElement.style.setProperty(property, value);
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute('content', company.brand.primary);
}

function renderPortalAccess() {
  const permanent = /^p1\.[A-Za-z0-9_-]{43}$/.test(portalGrant);
  const status = el('p', {
    class: 'privacy-note', 'aria-live': 'polite',
    text: permanent
      ? 'Bookmark this private link to open your portal on any device. It stays valid until Home Safe Inspection Services revokes it.'
      : 'Use this private link on another computer or device. Its original expiry still applies.'
  });
  const fallback = el('input', {
    class: 'portal-link-fallback', type: 'text', readonly: true, hidden: true,
    'aria-label': 'Private portal access link'
  });
  const button = el('button', {
    class: 'action portal-link-copy', type: 'button', text: 'Copy portal link'
  });
  button.addEventListener('click', async () => {
    let link;
    try {
      if (!permanent) {
        const raw = portalGrant.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
        const claims = JSON.parse(atob(raw.padEnd(Math.ceil(raw.length / 4) * 4, '=')));
        if (claims.connectionId !== getUuid() || !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) {
          throw new Error('Expired or mismatched link');
        }
      }
      const url = new URL(`/agent/${encodeURIComponent(getUuid())}`, location.origin);
      url.hash = new URLSearchParams({ grant: portalGrant }).toString();
      link = url.href;
    } catch {
      fallback.hidden = true;
      fallback.value = '';
      status.textContent = 'This access link has expired. Ask Home Safe Inspection Services for a fresh link.';
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      fallback.hidden = true;
      fallback.value = '';
      status.textContent = permanent
        ? 'Permanent private link copied. Save it as a bookmark or open it on another device.'
        : 'Private link copied. Paste it on another device. It keeps its original expiry.';
    } catch {
      fallback.value = link;
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
      status.textContent = 'Copy the selected private link and open it on the other device.';
    }
  });
  app.append(el('section', { class: 'section' }, [
    el('h2', { text: 'Open on another device' }), button, status, fallback
  ]));
}

function filterInspectionHistory(inspections, { query = '', type = 'all', year = 'all' } = {}) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return inspections.filter(inspection => {
    const isPreSale = inspection.classification === 'Pre-sale inspection';
    if (type === 'pre-sale' && !isPreSale) return false;
    if (type === 'buyer' && isPreSale) return false;
    if (year !== 'all' && String(inspection.date || '').slice(0, 4) !== year) return false;
    const content = [inspection.location, inspection.address, inspection.services,
      inspection.classification, inspection.status, inspection.date, inspection.inspector]
      .filter(Boolean).join(' ').toLocaleLowerCase();
    return words.every(word => content.includes(word));
  });
}

function renderInspectionHistory(inspections) {
  const timeline = el('div', { class: 'timeline' });
  const search = el('input', {
    id: 'inspection-search', class: 'history-input', type: 'search',
    placeholder: 'Search address or service', autocomplete: 'off'
  });
  const type = el('select', { id: 'inspection-type', class: 'history-input' }, [
    el('option', { value: 'all', text: 'All types' }),
    el('option', { value: 'buyer', text: 'Buyer' }),
    el('option', { value: 'pre-sale', text: 'Pre-sale' })
  ]);
  const years = [...new Set(inspections.map(item => String(item.date || '').slice(0, 4))
    .filter(value => /^\d{4}$/.test(value)))].sort().reverse();
  const year = el('select', { id: 'inspection-year', class: 'history-input' }, [
    el('option', { value: 'all', text: 'All years' }),
    ...years.map(value => el('option', { value, text: value }))
  ]);
  search.value = '';
  type.value = 'all';
  year.value = 'all';
  const count = el('p', { class: 'history-count', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const clear = el('button', { class: 'history-clear', type: 'button', text: 'Clear filters' });

  function updateHistory() {
    const filtered = filterInspectionHistory(inspections, { query: search.value, type: type.value, year: year.value });
    count.textContent = `Showing ${filtered.length} of ${inspections.length} inspections`;
    timeline.replaceChildren();
    if (!filtered.length) timeline.append(el('p', {
      class: 'privacy-note',
      text: inspections.length ? 'No inspections match your filters.' : 'No inspections to display.'
    }));
    for (const inspection of filtered) {
      const date = monthDay(inspection.date);
      timeline.append(
        el('article', { class: 'timeline-item' }, [
          el('div', { class: 'date' }, [
            document.createTextNode(date.month),
            el('span', { text: date.day })
          ]),
          el('div', {}, [
            el('p', { class: 'inspection-title', text: inspection.location || inspection.address }),
            ...(inspection.classification ? [el('p', { class: 'inspection-kind', text: inspection.classification })] : []),
            el('p', {
              class: 'inspection-meta',
              text: `${inspection.services} | ${inspection.inspector} | ${inspection.status}`
            }),
            ...(inspection.portalUrl ? [el('a', {
              href: inspection.portalUrl, target: '_blank', rel: 'noopener noreferrer',
              text: 'Open inspection portal (opens in a new tab)'
            })] : [])
          ])
        ])
      );
    }
  }
  search.addEventListener('input', updateHistory);
  type.addEventListener('change', updateHistory);
  year.addEventListener('change', updateHistory);
  clear.addEventListener('click', () => {
    search.value = '';
    type.value = 'all';
    year.value = 'all';
    updateHistory();
    search.focus();
  });
  updateHistory();
  return el('section', { class: 'section' }, [
    el('h2', { text: 'Inspection History' }),
    el('div', { class: 'inspection-filters' }, [
      el('label', { class: 'history-search-field', for: 'inspection-search' }, [
        el('span', { text: 'Search inspections' }), search
      ]),
      el('label', { for: 'inspection-type' }, [el('span', { text: 'Type' }), type]),
      el('label', { for: 'inspection-year' }, [el('span', { text: 'Year' }), year]),
      el('div', { class: 'history-filter-footer' }, [count, clear])
    ]),
    timeline
  ]);
}

function renderRankings(rankings) {
  if (!rankings?.available) {
    return el('section', { class: 'ranking-card ranking-unavailable', 'aria-label': 'Realtor rankings' }, [
      el('p', { class: 'ranking-eyebrow', text: 'Your HSI ranking' }),
      el('p', { class: 'ranking-note', text: 'Rankings are temporarily unavailable.' })
    ]);
  }
  const category = (label, score, overall = false) => el('div', {
    class: `ranking-category${overall ? ' ranking-category-overall' : ''}`, role: 'group',
    'aria-label': `${label}: ${score.tied ? 'tied ' : ''}rank ${score.rank} of ${rankings.population}, ${score.count} inspections`
  }, [
    el('strong', { class: 'ranking-category-number', text: `#${score.rank}` }),
    el('span', { class: 'ranking-category-label', text: label }),
    ...(score.tied ? [el('span', { class: 'ranking-category-detail', text: 'Tied' })] : [])
  ]);
  const date = rankings.updatedAt ? new Date(rankings.updatedAt) : null;
  const updated = date && Number.isFinite(date.getTime())
    ? `Updated ${new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)}`
    : undefined;
  return el('section', {
    class: 'ranking-card', 'aria-label': 'Your realtor ranking with Home Safe Inspection Services', title: updated
  }, [
    el('div', { class: 'ranking-header' }, [
      el('p', { class: 'ranking-eyebrow' }, [
        el('span', { 'aria-hidden': 'true', text: '★ ' }), document.createTextNode('Your HSI ranking')
      ]),
      el('span', { class: 'ranking-population', text: `Among ${rankings.population} realtors` })
    ]),
    el('div', { class: 'ranking-grid' }, [
      category('Overall', rankings.overall, true), category('Buyers', rankings.buyers),
      category('Sellers', rankings.sellers), category('Pre-sales', rankings.presales)
    ])
  ]);
}

function renderDashboard(data) {
  const { company, agent, stats, tier, inspections } = data;
  applyBrand(company);
  document.title = `${agent.firstName} ${agent.lastName} | ${company.appName}`;
  app.replaceChildren();

  app.append(
    el('header', { class: 'topbar' }, [
      el('div', { class: 'brand-lockup' }, [
        el('img', { class: 'brand-logo', src: '/assets/hsi-letterhead.jpg', alt: company.name, width: '1200', height: '475' }),
        el('p', { class: 'company-tagline', text: company.tagline })
      ]),
      el('div', { class: 'badge', text: company.appName })
    ])
  );

  const avatar = el('img', {
    class: 'avatar',
    src: agent.photoUrl || '/assets/mock-agent.svg',
    alt: `${agent.firstName} ${agent.lastName}`
  });
  avatar.addEventListener('error', () => { avatar.src = '/assets/mock-agent.svg'; }, { once: true });
  app.append(
    el('section', { class: 'hero' }, [
      avatar,
      el('h1', { class: 'agent-name', text: `${agent.firstName} ${agent.lastName}` }),
      el('p', { class: 'agency', text: agent.agency || 'Real estate partner' }),
      ...(data.meta?.mode === 'live' ? [renderRankings(data.rankings)] : []),
      el('div', { class: 'tier' }, [
        el('span', { class: 'tier-dot', 'aria-hidden': 'true' }),
        document.createTextNode(tier.label || 'Partner')
      ])
    ])
  );

  app.append(
    el('section', { class: 'section' }, [
      el('h2', { text: 'Schedule Next Inspection' }),
      el('div', { class: 'actions' }, [
        el('a', { class: 'action', href: company.bookingUrl, target: '_blank', rel: 'noopener' }, [
          el('strong', { text: 'Online' }),
          el('span', { text: 'Open the inspection scheduler' })
        ]),
        el('a', { class: 'action', href: `tel:${company.phone.replace(/[^\d+]/g, '')}` }, [
          el('strong', { text: 'Call' }),
          el('span', { text: company.phone })
        ]),
        el('a', { class: 'action', href: company.whatsappUrl, target: '_blank', rel: 'noopener' }, [
          el('strong', { text: 'Message' }),
          el('span', { text: 'Start a quick conversation' })
        ]),
        el('a', { class: 'action', href: company.website, target: '_blank', rel: 'noopener' }, [
          el('strong', { text: 'Website' }),
          el('span', { text: 'View services and resources' })
        ])
      ])
    ])
  );

  app.append(
    el('section', { class: 'section' }, [
      el('h2', { text: 'Relationship Snapshot' }),
      el('div', { class: 'metrics' }, [
        el('div', { class: 'metric' }, [el('strong', { text: stats.totalInspections }), el('span', { text: 'Total' })]),
        el('div', { class: 'metric' }, [el('strong', { text: stats.buyingInspections }), el('span', { text: 'Buying' })]),
        el('div', { class: 'metric' }, [el('strong', { text: stats.sellingInspections }), el('span', { text: 'Selling' })]),
        el('div', { class: 'metric' }, [el('strong', { text: stats.preSaleInspections ?? 0 }), el('span', { text: 'Pre-sales' })])
      ]),
      el('p', { class: 'privacy-note', text: 'Pre-sales are included in the selling count.' })
    ])
  );

  app.append(
    el('section', { class: 'section' }, [
      el('h2', { text: 'Partnership' }),
      el('div', { class: 'partnership' }, [
        el('div', { class: 'partnership-row' }, [
          el('span', { text: fmtDate(stats.firstInspection) || 'Start' }),
          el('span', { text: fmtDate(stats.lastInspection) || 'Present' })
        ]),
        el('div', { class: 'bar', 'aria-hidden': 'true' }, [el('span')]),
        el('p', {
          class: 'privacy-note',
          text: portalModeCopy.modeNotice(data.meta?.mode)
        })
      ])
    ])
  );

  app.append(renderInspectionHistory(inspections));

  if (data.meta?.mode === 'live' && portalGrant) renderPortalAccess();

  app.append(
    el('footer', { class: 'footer' }, [
      document.createTextNode(`${company.license} | ${company.website}`)
    ])
  );
}

async function load() {
  try {
    const requestOptions = { cache: 'no-store', headers: {} };
    if (portalGrant) requestOptions.headers.Authorization = `Bearer ${portalGrant}`;
    const response = await fetch(`/api/agent/${encodeURIComponent(getUuid())}`, requestOptions);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    renderDashboard(await response.json());
  } catch (error) {
    app.replaceChildren(
      el('section', { class: 'error' }, [
        el('h1', { text: 'Portal unavailable' }),
        el('p', { text: error.message })
      ])
    );
  }
}

load();
