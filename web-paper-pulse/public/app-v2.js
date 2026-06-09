const STORE_KEYS = {
  settings: 'paperPulseWeb.settings',
  favorites: 'paperPulseWeb.favorites',
  journalMetrics: 'paperPulseWeb.journalMetrics',
  translations: 'paperPulseWeb.translations',
  session: 'paperPulseWeb.session'
};

const DEFAULT_SETTINGS = {
  profileName: '经济预测与智能决策',
  includeKeywords: '经济预测, economic forecasting, nowcasting, macroeconomic forecasting, time series, machine learning, deep learning, transformer, uncertainty',
  excludeKeywords: 'advertisement, editorial, correction',
  maxResults: 20,
  sources: ['openalex', 'arxiv'],
  arxivSortBy: 'submittedDate',
  qualityFilterEnabled: true,
  minQuartile: 'Q2',
  minImpactFactor: 0,
  requireKnownMetrics: false,
  includePreprints: true,
  autoTranslate: true,
  autoTranslateLimit: 10
};

const sourceNames = {
  hf: 'HF Daily',
  arxiv: 'arXiv',
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  pubmed: 'PubMed / PMC',
  core: 'CORE',
  semantic: 'Semantic Scholar',
  gscholar: 'Google Scholar',
  chaoxing: '超星学术'
};

const state = {
  view: 'search',
  filter: 'all',
  reportType: 'daily',
  selectedId: '',
  expandedKey: '',
  papers: [],
  errors: [],
  updatedAt: '',
  metricIndex: null,
  syncTimer: null,
  translating: {},
  autoTranslateActive: false,
  settings: loadObject(STORE_KEYS.settings, DEFAULT_SETTINGS),
  favorites: loadObject(STORE_KEYS.favorites, {}),
  journalMetrics: loadArray(STORE_KEYS.journalMetrics),
  translations: loadObject(STORE_KEYS.translations, {}),
  session: loadObject(STORE_KEYS.session, {})
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function loadObject(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch (error) {
    return { ...fallback };
  }
}

function loadArray(key) {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function saveAllLocal() {
  saveJson(STORE_KEYS.settings, state.settings);
  saveJson(STORE_KEYS.favorites, state.favorites);
  saveJson(STORE_KEYS.journalMetrics, state.journalMetrics);
  saveJson(STORE_KEYS.translations, state.translations);
  saveJson(STORE_KEYS.session, state.session);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function splitKeywords(value) {
  return String(value || '')
    .split(/[,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value) {
  return compactText(value).toLowerCase();
}

function normalizeIssn(value) {
  return String(value || '').toUpperCase().replace(/[^0-9X]/g, '');
}

function normalizeJournalName(value) {
  return normalizeText(value)
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function stableKey(paper) {
  const doi = String(paper.doi || '').toLowerCase().replace(/^https?:\/\/doi.org\//, '');
  if (doi) return `doi:${doi}`;
  if (paper.arxivId) return `arxiv:${String(paper.arxivId).toLowerCase()}`;
  if (paper.id) return `id:${String(paper.id).toLowerCase()}`;
  return `title:${normalizeJournalName(paper.title)}`;
}

function sourceLabel(paper) {
  if (Array.isArray(paper.sourceLabels) && paper.sourceLabels.length) return paper.sourceLabels.join(' + ');
  return paper.sourceLabel || sourceNames[paper.source] || paper.source || 'Unknown';
}

function citationNumber(paper) {
  const match = String(paper.scoreText || '').match(/(\d+)\s+citations?/i);
  return match ? Number(match[1]) : 0;
}

function quartileRank(value) {
  const text = String(value || '').toUpperCase();
  const qMatch = text.match(/Q\s*([1-4])/);
  if (qMatch) return Number(qMatch[1]);
  const cnMatch = text.match(/([1-4])\s*区/);
  if (cnMatch) return Number(cnMatch[1]);
  return 99;
}

function normalizeQuartile(value) {
  const rank = quartileRank(value);
  return rank >= 1 && rank <= 4 ? `Q${rank}` : '';
}

function toNumber(value) {
  const number = Number(String(value || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function normalizeMetricRow(row) {
  const journal = compactText(row.journal || row.Journal || row['期刊'] || row['期刊名称'] || row.title || row.name);
  const issnValues = [
    row.issn,
    row.ISSN,
    row.eissn,
    row.EISSN,
    row['ISSN'],
    row['E-ISSN'],
    row['issn_l'],
    row['ISSN-L']
  ].flatMap((value) => String(value || '').split(/[;,，\s]+/));
  const issns = Array.from(new Set(issnValues.map(normalizeIssn).filter((item) => item.length >= 8)));
  const impactFactor = toNumber(row.impactFactor || row.IF || row['影响因子'] || row['JIF'] || row['Journal Impact Factor']);
  const partition = compactText(row.partition || row['分区'] || row['SCI分区'] || row['中科院分区'] || row.zone);
  const quartile = normalizeQuartile(row.quartile || row.Quartile || row.JCR || row['JCR分区'] || row['分区'] || partition);
  if (!journal && !issns.length) return null;
  return {
    journal,
    issns,
    impactFactor,
    quartile,
    partition,
    year: compactText(row.year || row['年份']),
    source: compactText(row.source || row['来源'] || '自定义导入')
  };
}

function buildMetricIndex() {
  const byIssn = new Map();
  const byName = new Map();
  state.journalMetrics.map(normalizeMetricRow).filter(Boolean).forEach((metric) => {
    metric.issns.forEach((issn) => byIssn.set(issn, metric));
    if (metric.journal) byName.set(normalizeJournalName(metric.journal), metric);
  });
  state.metricIndex = { byIssn, byName };
  return state.metricIndex;
}

function metricForPaper(paper) {
  if (paper.metric) {
    return normalizeMetricRow(paper.metric) || paper.metric;
  }
  const index = state.metricIndex || buildMetricIndex();
  const issns = Array.isArray(paper.issns) ? paper.issns : [];
  for (const issn of issns) {
    const match = index.byIssn.get(normalizeIssn(issn));
    if (match) return match;
  }
  const names = [paper.venueName, ...(paper.tags || [])].map(normalizeJournalName).filter(Boolean);
  for (const name of names) {
    if (index.byName.has(name)) return index.byName.get(name);
  }
  return null;
}

function isPreprint(paper) {
  const sources = paper.sources || [paper.source];
  const venue = normalizeText(paper.venueName);
  return sources.includes('arxiv') || sources.includes('hf') || venue.includes('preprint') || venue.includes('arxiv');
}

function qualityInfo(paper) {
  const metric = metricForPaper(paper);
  const preprint = isPreprint(paper);
  if (!state.settings.qualityFilterEnabled) {
    return { allowed: true, metric, label: metricLabel(metric, preprint), reason: '' };
  }
  if (preprint && state.settings.includePreprints) {
    return { allowed: true, metric, label: metricLabel(metric, preprint), reason: '预印本保留' };
  }
  if (!metric) {
    return {
      allowed: !state.settings.requireKnownMetrics,
      metric: null,
      label: preprint ? '预印本' : 'IF 未知',
      reason: state.settings.requireKnownMetrics ? '缺少影响因子/分区' : '未知指标保留'
    };
  }
  const minRank = quartileRank(state.settings.minQuartile || 'Q2');
  const rank = quartileRank(metric.quartile || metric.partition);
  const minImpactFactor = Number(state.settings.minImpactFactor || 0);
  if (rank > minRank) {
    return { allowed: false, metric, label: metricLabel(metric, preprint), reason: `低于 ${state.settings.minQuartile}` };
  }
  if (minImpactFactor > 0 && Number(metric.impactFactor || 0) < minImpactFactor) {
    return { allowed: false, metric, label: metricLabel(metric, preprint), reason: `IF < ${minImpactFactor}` };
  }
  return { allowed: true, metric, label: metricLabel(metric, preprint), reason: '' };
}

function metricLabel(metric, preprint = false) {
  if (!metric) return preprint ? '预印本' : 'IF 未知';
  const pieces = [];
  if (metric.impactFactor) pieces.push(`IF ${metric.impactFactor}`);
  if (metric.partition) pieces.push(metric.partition);
  else if (metric.quartile) pieces.push(metric.quartile);
  if (metric.year) pieces.push(metric.year);
  return pieces.length ? pieces.join(' · ') : '指标已导入';
}

function scorePaper(paper) {
  const includeKeywords = splitKeywords(state.settings.includeKeywords);
  const excludeKeywords = splitKeywords(state.settings.excludeKeywords);
  const title = normalizeText(paper.title);
  const body = normalizeText(`${paper.title} ${paper.summary} ${(paper.tags || []).join(' ')} ${paper.authors || ''} ${paper.venueName || ''}`);
  const hits = [];
  let score = 0;

  includeKeywords.forEach((keyword) => {
    const needle = normalizeText(keyword);
    if (!needle) return;
    if (title.includes(needle)) {
      score += 28;
      hits.push(keyword);
    } else if (body.includes(needle)) {
      score += 14;
      hits.push(keyword);
    }
  });

  excludeKeywords.forEach((keyword) => {
    const needle = normalizeText(keyword);
    if (needle && body.includes(needle)) score -= 32;
  });

  const quality = qualityInfo(paper);
  if (quality.metric && quality.metric.impactFactor) score += Math.min(18, Math.round(Number(quality.metric.impactFactor) / 2));
  if (quality.metric && quartileRank(quality.metric.quartile || quality.metric.partition) <= 2) score += 12;
  if (paper.pdfUrl) score += 8;
  if (paper.doi) score += 5;
  score += Math.min(16, Math.floor(citationNumber(paper) / 25));

  const published = new Date(paper.publishedAt || 0).getTime();
  if (published) {
    const ageDays = (Date.now() - published) / 86400000;
    if (ageDays <= 45) score += 12;
    else if (ageDays <= 365) score += 6;
  }

  const uniqueHits = Array.from(new Set(hits));
  return {
    relevanceScore: Math.max(0, Math.round(score)),
    keywordHits: uniqueHits,
    rating: Math.max(1, Math.min(5, Math.ceil(Math.max(score, 1) / 24))),
    isRecommended: score >= 32 || uniqueHits.length >= 2,
    quality
  };
}

function enrichPaper(paper) {
  const key = stableKey(paper);
  const favorite = state.favorites[key];
  const scored = scorePaper(paper);
  return {
    ...paper,
    key,
    ...scored,
    note: favorite ? favorite.note || '' : '',
    userRating: favorite ? favorite.rating || scored.rating : scored.rating,
    favoriteSavedAt: favorite ? favorite.savedAt : ''
  };
}

function fillForms() {
  $('#query-input').value = state.settings.lastQuery || '经济预测';
  $('#arxiv-query-input').value = state.settings.lastArxivQuery || '';
  $('#max-results-input').value = state.settings.maxResults || 20;
  $('#arxiv-sort-input').value = state.settings.arxivSortBy || 'submittedDate';
  $('#profile-name-input').value = state.settings.profileName || DEFAULT_SETTINGS.profileName;
  $('#include-keywords-input').value = state.settings.includeKeywords || DEFAULT_SETTINGS.includeKeywords;
  $('#exclude-keywords-input').value = state.settings.excludeKeywords || DEFAULT_SETTINGS.excludeKeywords;
  $('#min-quartile-input').value = state.settings.minQuartile || 'Q2';
  $('#min-impact-factor-input').value = Number(state.settings.minImpactFactor || 0);
  $('#quality-filter-input').checked = Boolean(state.settings.qualityFilterEnabled);
  $('#settings-quality-filter-input').checked = Boolean(state.settings.qualityFilterEnabled);
  $('#include-preprints-input').checked = Boolean(state.settings.includePreprints);
  $('#settings-include-preprints-input').checked = Boolean(state.settings.includePreprints);
  $('#require-known-metrics-input').checked = Boolean(state.settings.requireKnownMetrics);
  $('#settings-require-known-metrics-input').checked = Boolean(state.settings.requireKnownMetrics);
  $('#sync-username-input').value = state.session.username || '';
  $$('input[name="sources"]').forEach((input) => {
    input.checked = (state.settings.sources || DEFAULT_SETTINGS.sources).includes(input.value);
  });
  renderSyncStatus();
  renderMetricsStatus();
}

function readSearchPayload() {
  const sources = $$('input[name="sources"]:checked').map((input) => input.value);
  state.settings = {
    ...state.settings,
    maxResults: Number($('#max-results-input').value) || 20,
    arxivSortBy: $('#arxiv-sort-input').value,
    sources: sources.length ? sources : ['openalex'],
    lastQuery: compactText($('#query-input').value) || 'large language models',
    lastArxivQuery: compactText($('#arxiv-query-input').value),
    qualityFilterEnabled: $('#quality-filter-input').checked,
    includePreprints: $('#include-preprints-input').checked,
    requireKnownMetrics: $('#require-known-metrics-input').checked
  };
  saveJson(STORE_KEYS.settings, state.settings);
  scheduleSyncPush();
  return {
    query: state.settings.lastQuery,
    arxivQuery: state.settings.lastArxivQuery,
    maxResults: state.settings.maxResults,
    arxivSortBy: state.settings.arxivSortBy,
    sources: state.settings.sources
  };
}

function setStatus(message, isError = false) {
  const node = $('#status-line');
  node.textContent = message;
  node.classList.toggle('error', isError);
}

async function refreshPapers(event) {
  if (event) event.preventDefault();
  const payload = readSearchPayload();
  setStatus('正在刷新文献来源...');
  $('#paper-list').innerHTML = '<div class="empty-state">正在检索</div>';

  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);

    state.updatedAt = data.updatedAt;
    state.errors = data.errors || [];
    state.metricIndex = null;
    state.papers = (data.papers || [])
      .map(enrichPaper)
      .sort((a, b) => b.relevanceScore - a.relevanceScore || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

    const shown = visiblePapers();
    state.selectedId = shown[0] ? shown[0].key : (state.papers[0] ? state.papers[0].key : '');
    state.expandedKey = '';
    renderAll();
    autoTranslateVisiblePapers();

    const failed = state.errors.map((item) => item.sourceLabel).join('、');
    const hidden = state.papers.length - shown.length;
    const suffix = hidden > 0 ? `；质量筛选隐藏 ${hidden} 篇` : '';
    if (failed) setStatus(`更新于 ${formatDate(state.updatedAt)}，显示 ${shown.length}/${state.papers.length} 篇；失败来源：${failed}${suffix}`, true);
    else setStatus(`更新于 ${formatDate(state.updatedAt)}，显示 ${shown.length}/${state.papers.length} 篇${suffix}`);
  } catch (error) {
    setStatus(`刷新失败：${error.message || error}`, true);
    $('#paper-list').innerHTML = '<div class="empty-state">请求失败</div>';
  }
}

function visiblePapers() {
  const localFilter = normalizeText($('#local-filter-input').value);
  return state.papers.filter((paper) => {
    if (!paper.quality.allowed) return false;
    if (state.filter === 'recommended' && !paper.isRecommended) return false;
    if (state.filter === 'pdf' && !paper.pdfUrl) return false;
    if (!localFilter) return true;
    const text = normalizeText(`${paper.title} ${paper.authors} ${paper.summary} ${(paper.tags || []).join(' ')} ${paper.venueName || ''}`);
    return text.includes(localFilter);
  });
}

function reportPapers() {
  return getReportPapers().filter((paper) => paper.quality.allowed);
}

function paperByKey(key) {
  return state.papers.find((paper) => paper.key === key) || (state.favorites[key] && enrichPaper(state.favorites[key].paper));
}

function favoriteRecord(paper) {
  const key = paper.key || stableKey(paper);
  return state.favorites[key];
}

function saveFavorite(paper, patch = {}) {
  const key = paper.key || stableKey(paper);
  const existing = state.favorites[key] || {};
  state.favorites[key] = {
    key,
    paper: { ...paper, key },
    note: patch.note !== undefined ? patch.note : existing.note || paper.note || '',
    rating: patch.rating !== undefined ? Number(patch.rating) : existing.rating || paper.userRating || paper.rating || 1,
    savedAt: existing.savedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  saveJson(STORE_KEYS.favorites, state.favorites);
  scheduleSyncPush();
}

function removeFavorite(paper) {
  const key = paper.key || stableKey(paper);
  delete state.favorites[key];
  saveJson(STORE_KEYS.favorites, state.favorites);
  scheduleSyncPush();
}

function toggleFavorite(paper) {
  if (favoriteRecord(paper)) removeFavorite(paper);
  else saveFavorite(paper);
  state.papers = state.papers.map(enrichPaper);
  renderAll();
}

function renderAll() {
  renderPapers();
  renderFavorites();
  renderReader();
  renderMetricsStatus();
  renderSyncStatus();
}

function renderPapers() {
  const papers = visiblePapers();
  $('#paper-count').textContent = `${papers.length} 篇`;
  renderList($('#paper-list'), papers, '没有匹配的论文');
}

function renderFavorites() {
  const papers = Object.values(state.favorites)
    .map((item) => enrichPaper({ ...item.paper, note: item.note, userRating: item.rating }))
    .filter((paper) => paper.quality.allowed || favoriteRecord(paper))
    .sort((a, b) => new Date(b.favoriteSavedAt || 0) - new Date(a.favoriteSavedAt || 0));
  renderList($('#favorite-list'), papers, '还没有收藏论文');
}

function paperLinksHtml(paper) {
  return [
    paper.pdfUrl ? `<a href="${escapeHtml(paper.pdfUrl)}" target="_blank" rel="noreferrer">PDF</a>` : '',
    paper.url || paper.absUrl ? `<a href="${escapeHtml(paper.url || paper.absUrl)}" target="_blank" rel="noreferrer">原文</a>` : '',
    paper.doi ? `<a href="https://doi.org/${escapeHtml(String(paper.doi).replace(/^https?:\/\/doi.org\//, ''))}" target="_blank" rel="noreferrer">DOI</a>` : '',
    paper.codeUrl ? `<a href="${escapeHtml(paper.codeUrl)}" target="_blank" rel="noreferrer">代码</a>` : ''
  ].filter(Boolean).join('');
}

function renderExpandedPaper(card, paper) {
  const cached = translationFor(paper);
  const titleZh = cached.titleZh || '';
  const summaryZh = cached.summaryZh || (cached.translatedText && !cached.titleZh ? cached.translatedText : '');
  const translating = Boolean(state.translating[paper.key]);
  const metric = paper.quality && paper.quality.metric;
  const links = paperLinksHtml(paper);
  const saved = Boolean(favoriteRecord(paper));
  const expanded = document.createElement('div');
  expanded.className = 'paper-expanded';
  expanded.innerHTML = `
    <div class="expanded-section">
      <h4>标题</h4>
      <p class="expanded-original">${escapeHtml(paper.title || 'Untitled')}</p>
      <p class="expanded-translation">${escapeHtml(titleZh || (translating ? '正在翻译标题...' : '标题译文待生成'))}</p>
    </div>
    <div class="expanded-section">
      <h4>摘要</h4>
      <p class="expanded-original">${escapeHtml(paper.summary || paper.shortSummary || '摘要暂缺')}</p>
      <p class="expanded-translation">${escapeHtml(summaryZh || (translating ? '正在翻译摘要...' : '摘要译文待生成'))}</p>
    </div>
    <div class="expanded-section">
      <h4>期刊指标</h4>
      <p class="expanded-original">${escapeHtml(metric ? `${metric.journal || paper.venueName || '期刊'}：${metricLabel(metric)}；来源：${metric.source || '自定义'}。` : `${paper.venueName || '期刊未知'}：暂无影响因子/分区数据。`)}</p>
    </div>
    <div class="expanded-toolbar">
      <button class="primary-button expanded-translate-button" type="button">${titleZh || summaryZh ? '更新翻译' : '翻译'}</button>
      <button class="${saved ? 'ghost-button' : 'primary-button'} expanded-favorite-button" type="button">${saved ? '取消收藏' : '收藏'}</button>
      <div class="reader-links">${links || '<span class="badge">暂无链接</span>'}</div>
    </div>
  `;
  $('.expanded-translate-button', expanded).addEventListener('click', (event) => {
    event.stopPropagation();
    translatePaper(paper, { force: true });
  });
  $('.expanded-favorite-button', expanded).addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFavorite(paper);
  });
  $$('.reader-links a', expanded).forEach((link) => link.addEventListener('click', (event) => event.stopPropagation()));
  card.appendChild(expanded);
}

function renderList(container, papers, emptyText) {
  if (!papers.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    return;
  }
  const template = $('#paper-card-template');
  const fragment = document.createDocumentFragment();
  papers.forEach((paper) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.key = paper.key;
    card.classList.toggle('selected', state.selectedId === paper.key);
    card.classList.toggle('expanded', state.expandedKey === paper.key);
    const cached = translationFor(paper);
    const titleZh = cached.titleZh || '';
    const summaryZh = cached.summaryZh || (cached.translatedText && !cached.titleZh ? cached.translatedText : '');
    const translating = Boolean(state.translating[paper.key]);
    $('.paper-meta', card).innerHTML = renderMeta(paper);
    $('h3', card).textContent = paper.title || 'Untitled';
    const titleCn = $('.paper-title-cn', card);
    titleCn.textContent = titleZh || (translating ? '正在翻译标题...' : '');
    titleCn.hidden = !titleCn.textContent;
    $('.paper-authors', card).textContent = paper.authors || '作者信息暂缺';
    $('.paper-summary', card).textContent = paper.shortSummary || paper.summary || '摘要暂缺';
    const summaryCn = $('.paper-summary-cn', card);
    summaryCn.textContent = summaryZh ? summaryZh.slice(0, 360) : (translating ? '正在翻译摘要...' : '');
    summaryCn.hidden = !summaryCn.textContent;
    $('.paper-tags', card).innerHTML = renderTags(paper);

    const viewButton = $('.view-card-button', card);
    viewButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openPaper(paper);
    });

    const favoriteButton = $('.favorite-button', card);
    const saved = Boolean(favoriteRecord(paper));
    favoriteButton.textContent = saved ? '★' : '☆';
    favoriteButton.classList.toggle('saved', saved);
    favoriteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFavorite(paper);
    });

    const translateButton = $('.translate-card-button', card);
    translateButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openPaper(paper);
      translatePaper(paper, { force: true });
    });

    const pdfLink = $('.pdf-link', card);
    pdfLink.href = paper.pdfUrl || '#';
    pdfLink.classList.toggle('disabled', !paper.pdfUrl);
    pdfLink.addEventListener('click', (event) => event.stopPropagation());

    const sourceLink = $('.source-link', card);
    sourceLink.href = paper.url || paper.absUrl || '#';
    sourceLink.classList.toggle('disabled', !(paper.url || paper.absUrl));
    sourceLink.addEventListener('click', (event) => event.stopPropagation());

    card.addEventListener('click', () => openPaper(paper));
    if (state.expandedKey === paper.key) renderExpandedPaper(card, paper);
    fragment.appendChild(card);
  });
  container.replaceChildren(fragment);
}

function openPaper(paper) {
  state.selectedId = paper.key;
  state.expandedKey = paper.key;
  renderAll();
}

function renderMeta(paper) {
  const qualityClass = paper.quality.metric ? 'quality' : (isPreprint(paper) ? '' : 'muted');
  const pieces = [
    `<span class="badge source">${escapeHtml(sourceLabel(paper))}</span>`,
    paper.venueName ? `<span class="badge">${escapeHtml(paper.venueName)}</span>` : '',
    paper.dateText || paper.publishedAt ? `<span class="badge">${escapeHtml(paper.dateText || formatDate(paper.publishedAt))}</span>` : '',
    `<span class="badge score">${paper.relevanceScore || 0}</span>`,
    `<span class="badge ${qualityClass}">${escapeHtml(paper.quality.label)}</span>`,
    paper.isRecommended ? '<span class="badge warning">推荐</span>' : '',
    paper.scoreText ? `<span class="badge">${escapeHtml(paper.scoreText)}</span>` : ''
  ];
  return pieces.filter(Boolean).join('');
}

function renderTags(paper) {
  const tags = Array.from(new Set([...(paper.keywordHits || []), ...(paper.tags || [])])).slice(0, 8);
  return tags.map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join('');
}

function translationFor(paper) {
  const cached = state.translations[paper.key];
  if (!cached) return {};
  if (typeof cached === 'string') return { summaryZh: cached, translatedText: cached };
  return cached;
}

function translationSummary(paper) {
  const cached = translationFor(paper);
  const text = cached.summaryZh || cached.translatedText || '';
  return text ? text.slice(0, 260) : '';
}

function renderReader() {
  const paper = state.selectedId ? paperByKey(state.selectedId) : null;
  const panel = $('#reader-panel');
  if (!paper) {
    panel.innerHTML = '<div class="reader-empty"><p class="eyebrow">Reader</p><h2>选择一篇论文</h2></div>';
    return;
  }

  const saved = favoriteRecord(paper);
  const note = saved ? saved.note || '' : paper.note || '';
  const rating = saved ? saved.rating || paper.rating || 1 : paper.userRating || paper.rating || 1;
  const cachedTranslation = translationFor(paper);
  const titleZh = cachedTranslation.titleZh || '';
  const summaryZh = cachedTranslation.summaryZh || (cachedTranslation.translatedText && !cachedTranslation.titleZh ? cachedTranslation.translatedText : '');
  const translating = Boolean(state.translating[paper.key]);
  const metric = paper.quality.metric;
  const links = paperLinksHtml(paper);

  panel.innerHTML = `
    <p class="eyebrow">Reader</p>
    <h2 class="reader-title">${escapeHtml(paper.title)}</h2>
    <p class="reader-title-cn" id="reader-title-translation">${escapeHtml(titleZh || (translating ? '正在翻译标题...' : ''))}</p>
    <div class="reader-meta">${renderMeta(paper)}</div>
    <p class="paper-authors">${escapeHtml(paper.authors || '作者信息暂缺')}</p>
    <div class="reader-section">
      <h3>期刊指标</h3>
      <p class="reader-summary">${escapeHtml(metric ? `${metric.journal || paper.venueName || '期刊'}：${metricLabel(metric)}；来源：${metric.source || '自定义'}。` : `${paper.venueName || '期刊未知'}：暂无影响因子/分区数据。`)}</p>
    </div>
    <div class="reader-section">
      <h3>摘要</h3>
      <p class="reader-summary">${escapeHtml(paper.summary || paper.shortSummary || '摘要暂缺')}</p>
      <div class="data-actions">
        <button class="primary-button" id="reader-translate" type="button">${titleZh || summaryZh ? '更新翻译' : '翻译标题与摘要'}</button>
      </div>
      <p class="reader-summary translation-box" id="reader-translation">${escapeHtml(summaryZh || (translating ? '正在翻译摘要...' : ''))}</p>
    </div>
    <div class="reader-section">
      <h3>链接</h3>
      <div class="reader-links">${links || '<span class="badge">暂无链接</span>'}</div>
    </div>
    <div class="reader-section">
      <h3>个人记录</h3>
      <div class="rating-row">
        <label class="field">
          <span>评分</span>
          <input id="reader-rating" type="number" min="1" max="5" value="${Number(rating) || 1}">
        </label>
        <button class="${saved ? 'ghost-button' : 'primary-button'}" id="reader-favorite" type="button">${saved ? '取消收藏' : '收藏'}</button>
      </div>
      <textarea id="reader-note" class="reader-note" placeholder="读后笔记、方法线索、复现实验想法">${escapeHtml(note)}</textarea>
    </div>
  `;

  $('#reader-favorite').addEventListener('click', () => toggleFavorite(paper));
  $('#reader-translate').addEventListener('click', () => translatePaper(paper, { force: true }));
  $('#reader-rating').addEventListener('input', (event) => {
    saveFavorite(paper, { rating: event.target.value });
    state.papers = state.papers.map(enrichPaper);
    renderPapers();
    renderFavorites();
  });
  $('#reader-note').addEventListener('input', (event) => {
    saveFavorite(paper, { note: event.target.value });
    state.papers = state.papers.map(enrichPaper);
    renderPapers();
    renderFavorites();
  });
}

async function requestTranslation(text) {
  const source = compactText(text);
  if (!source) return { translatedText: '', provider: '' };
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: source, target: 'zh-CN' })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function translationComplete(paper) {
  const cached = translationFor(paper);
  const hasTitle = !compactText(paper.title) || Boolean(compactText(cached.titleZh));
  const summarySource = compactText(paper.summary || paper.shortSummary || '');
  const hasSummary = !summarySource || Boolean(compactText(cached.summaryZh || cached.translatedText));
  return hasTitle && hasSummary;
}

async function translatePaper(paper, options = {}) {
  if (!paper || state.translating[paper.key]) return;
  if (!options.force && translationComplete(paper)) return;
  const titleTarget = $('#reader-title-translation');
  const summaryTarget = $('#reader-translation');
  state.translating[paper.key] = true;
  if (titleTarget) titleTarget.textContent = '正在翻译标题...';
  if (summaryTarget) summaryTarget.textContent = '正在翻译摘要...';
  try {
    const titleData = await requestTranslation(paper.title || '');
    const summaryData = await requestTranslation(paper.summary || paper.shortSummary || '');
    const titleZh = titleData.translatedText || '';
    const summaryZh = summaryData.translatedText || '';
    const providers = Array.from(new Set([titleData.provider, summaryData.provider].filter(Boolean)));
    state.translations[paper.key] = {
      ...translationFor(paper),
      titleZh,
      summaryZh,
      translatedText: [titleZh, summaryZh].filter(Boolean).join('\n\n'),
      provider: providers.join(' + '),
      updatedAt: new Date().toISOString()
    };
    saveJson(STORE_KEYS.translations, state.translations);
    scheduleSyncPush();
    delete state.translating[paper.key];
    renderAll();
    if (!options.auto) setStatus(`已翻译：${paper.title.slice(0, 30)}`);
  } catch (error) {
    delete state.translating[paper.key];
    renderAll();
    if (summaryTarget) summaryTarget.textContent = `翻译失败：${error.message || error}`;
    if (!options.auto) setStatus(`翻译失败：${error.message || error}`, true);
  }
}

async function autoTranslateVisiblePapers() {
  if (!state.settings.autoTranslate || state.autoTranslateActive) return;
  state.autoTranslateActive = true;
  try {
    const limit = Math.max(1, Math.min(Number(state.settings.autoTranslateLimit || 10), 20));
    const papers = visiblePapers().slice(0, limit);
    for (const paper of papers) {
      if (!translationComplete(paper)) await translatePaper(paper, { auto: true });
    }
  } finally {
    state.autoTranslateActive = false;
  }
}

function setView(view) {
  state.view = view;
  $$('.view-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('.view-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === view));
}

function getReportPapers() {
  const saved = Object.values(state.favorites).map((item) => enrichPaper({ ...item.paper, note: item.note, userRating: item.rating }));
  return saved.length ? saved : state.papers;
}

function buildDailyReport(papers) {
  const date = formatDate(new Date());
  const top = papers.slice().sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 10);
  const lines = [
    `# ${date} 论文日报`,
    '',
    `方向：${state.settings.profileName}`,
    `文献数：${papers.length}`,
    `推荐数：${papers.filter((paper) => paper.isRecommended).length}`,
    '',
    '## 优先阅读'
  ];
  if (!top.length) lines.push('', '暂无文献。');
  top.forEach((paper, index) => {
    lines.push(
      '',
      `### ${index + 1}. ${paper.title}`,
      `- 来源：${sourceLabel(paper)}`,
      `- 期刊：${paper.venueName || '未知'}`,
      `- 指标：${paper.quality.label}`,
      `- 日期：${paper.dateText || formatDate(paper.publishedAt) || '未知'}`,
      `- 相关性：${paper.relevanceScore || 0}`,
      `- 命中词：${(paper.keywordHits || []).join(', ') || '无'}`,
      `- 链接：${paper.url || paper.absUrl || ''}`,
      `- PDF：${paper.pdfUrl || '暂无'}`,
      `- 摘要：${paper.shortSummary || paper.summary || '暂无'}`
    );
    const translated = translationFor(paper).translatedText || translationFor(paper).summaryZh || '';
    if (translated) lines.push(`- 译文：${translated.slice(0, 500)}`);
    if (paper.note) lines.push(`- 笔记：${paper.note}`);
  });
  return lines.join('\n');
}

function groupCount(papers, getter) {
  const counts = {};
  papers.forEach((paper) => {
    const keys = getter(paper);
    (Array.isArray(keys) ? keys : [keys]).filter(Boolean).forEach((key) => {
      counts[key] = (counts[key] || 0) + 1;
    });
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function buildAnnualReport(papers) {
  const years = groupCount(papers, (paper) => String(paper.dateText || paper.publishedAt || '未知').slice(0, 4) || '未知');
  const sources = groupCount(papers, (paper) => paper.sourceLabels || sourceLabel(paper));
  const metrics = groupCount(papers, (paper) => paper.quality.label || '未知');
  const keywords = groupCount(papers, (paper) => paper.keywordHits || []);
  const top = papers.slice().sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 15);
  const lines = [
    `# ${state.settings.profileName} 年度文献概览`,
    '',
    `文献总数：${papers.length}`,
    '',
    '## 年份分布',
    ...years.map(([year, count]) => `- ${year}: ${count} 篇`),
    '',
    '## 来源分布',
    ...sources.map(([source, count]) => `- ${source}: ${count} 篇`),
    '',
    '## 指标分布',
    ...metrics.slice(0, 20).map(([label, count]) => `- ${label}: ${count} 篇`),
    '',
    '## 高频关键词',
    ...(keywords.length ? keywords.slice(0, 20).map(([keyword, count]) => `- ${keyword}: ${count}`) : ['- 暂无命中']),
    '',
    '## 高分论文'
  ];
  top.forEach((paper, index) => {
    lines.push(`${index + 1}. ${paper.title} (${paper.relevanceScore || 0}; ${paper.quality.label})`);
  });
  return lines.join('\n');
}

function buildRoadmapReport(papers) {
  const keywords = splitKeywords(state.settings.includeKeywords).slice(0, 12);
  const lines = [
    `# ${state.settings.profileName} 研究路线图`,
    '',
    '## 方向分支'
  ];
  keywords.forEach((keyword) => {
    const needle = normalizeText(keyword);
    const related = papers.filter((paper) => {
      const text = normalizeText(`${paper.title} ${paper.summary} ${(paper.tags || []).join(' ')}`);
      return text.includes(needle);
    }).sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 5);
    if (!related.length) return;
    lines.push('', `### ${keyword}`);
    related.forEach((paper, index) => {
      lines.push(`${index + 1}. ${paper.title} (${paper.relevanceScore || 0}; ${paper.quality.label})`);
    });
  });
  lines.push(
    '',
    '## 下一步',
    '- 优先精读评分最高且有 PDF 的论文。',
    '- 将收藏论文按问题、方法、数据和实验四类补充笔记。',
    '- 对反复出现的关键词建立专题检索式，并每周更新一次。'
  );
  return lines.join('\n');
}

function buildReport() {
  const papers = reportPapers();
  let markdown = '';
  if (state.reportType === 'daily') markdown = buildDailyReport(papers);
  if (state.reportType === 'annual') markdown = buildAnnualReport(papers);
  if (state.reportType === 'roadmap') markdown = buildRoadmapReport(papers);
  $('#report-output').value = markdown;
}

async function copyReport() {
  if (!$('#report-output').value) buildReport();
  await navigator.clipboard.writeText($('#report-output').value);
  setStatus('报告已复制');
}

function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function downloadReport() {
  if (!$('#report-output').value) buildReport();
  downloadText(`paper-pulse-${state.reportType}-${formatDate(new Date())}.md`, $('#report-output').value, 'text/markdown;charset=utf-8');
}

function saveSettings() {
  state.settings = {
    ...state.settings,
    profileName: compactText($('#profile-name-input').value) || DEFAULT_SETTINGS.profileName,
    includeKeywords: $('#include-keywords-input').value,
    excludeKeywords: $('#exclude-keywords-input').value,
    maxResults: Number($('#max-results-input').value) || 20,
    arxivSortBy: $('#arxiv-sort-input').value,
    sources: $$('input[name="sources"]:checked').map((input) => input.value),
    qualityFilterEnabled: $('#settings-quality-filter-input').checked,
    includePreprints: $('#settings-include-preprints-input').checked,
    requireKnownMetrics: $('#settings-require-known-metrics-input').checked,
    minQuartile: $('#min-quartile-input').value,
    minImpactFactor: Number($('#min-impact-factor-input').value) || 0
  };
  fillForms();
  saveJson(STORE_KEYS.settings, state.settings);
  state.metricIndex = null;
  state.papers = state.papers.map(enrichPaper).sort((a, b) => b.relevanceScore - a.relevanceScore);
  renderAll();
  buildReport();
  scheduleSyncPush();
  setStatus('设置已保存');
}

function exportData() {
  downloadText(`paper-pulse-data-${formatDate(new Date())}.json`, JSON.stringify({
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    favorites: state.favorites,
    journalMetrics: state.journalMetrics,
    translations: state.translations
  }, null, 2), 'application/json;charset=utf-8');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.settings) state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
      if (data.favorites) state.favorites = data.favorites;
      if (Array.isArray(data.journalMetrics)) state.journalMetrics = data.journalMetrics;
      if (data.translations) state.translations = data.translations;
      state.metricIndex = null;
      saveAllLocal();
      fillForms();
      state.papers = state.papers.map(enrichPaper);
      renderAll();
      setStatus('数据已导入');
      scheduleSyncPush();
    } catch (error) {
      setStatus(`导入失败：${error.message || error}`, true);
    }
  };
  reader.readAsText(file, 'utf-8');
}

function exportFavorites() {
  const papers = Object.values(state.favorites).map((item) => enrichPaper({ ...item.paper, note: item.note, userRating: item.rating }));
  downloadText(`paper-pulse-favorites-${formatDate(new Date())}.md`, buildDailyReport(papers), 'text/markdown;charset=utf-8');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((item) => item.trim())) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((item) => item.trim());
  return rows.slice(1).map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index] || '';
    });
    return item;
  });
}

function importMetrics(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const raw = String(reader.result || '');
      const rows = file.name.toLowerCase().endsWith('.json') ? JSON.parse(raw) : parseCsv(raw);
      if (!Array.isArray(rows)) throw new Error('指标表必须是数组或 CSV');
      const normalized = rows.map(normalizeMetricRow).filter(Boolean);
      if (!normalized.length) throw new Error('没有识别到有效期刊指标');
      state.journalMetrics = normalized;
      state.metricIndex = null;
      state.papers = state.papers.map(enrichPaper);
      saveJson(STORE_KEYS.journalMetrics, state.journalMetrics);
      renderAll();
      scheduleSyncPush();
      setStatus(`已导入 ${normalized.length} 条期刊指标`);
    } catch (error) {
      setStatus(`指标导入失败：${error.message || error}`, true);
    }
  };
  reader.readAsText(file, 'utf-8');
}

function downloadMetricsTemplate() {
  const csv = [
    'journal,issn,eissn,impactFactor,quartile,partition,year,source',
    '示例期刊,1234-567X,1234-5688,8.6,Q1,SCI 1区,2025,JCR/自定义'
  ].join('\n');
  downloadText('paper-pulse-journal-metrics-template.csv', csv, 'text/csv;charset=utf-8');
}

function clearMetrics() {
  state.journalMetrics = [];
  state.metricIndex = null;
  state.papers = state.papers.map(enrichPaper);
  saveJson(STORE_KEYS.journalMetrics, state.journalMetrics);
  renderAll();
  scheduleSyncPush();
  setStatus('期刊指标已清空');
}

function renderMetricsStatus() {
  const node = $('#metrics-status');
  if (!node) return;
  node.textContent = `已加载 ${state.journalMetrics.length} 条期刊指标。当前筛选：${state.settings.minQuartile || 'Q2'} 及以上，最低 IF ${Number(state.settings.minImpactFactor || 0)}。`;
}

function localSyncPayload() {
  return {
    settings: state.settings,
    favorites: state.favorites,
    journalMetrics: state.journalMetrics,
    translations: state.translations
  };
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${state.session.token || ''}`
  };
}

function mergeFavorites(remote = {}, local = {}) {
  const merged = { ...remote };
  Object.keys(local).forEach((key) => {
    const left = local[key];
    const right = remote[key];
    if (!right || new Date(left.updatedAt || left.savedAt || 0) >= new Date(right.updatedAt || right.savedAt || 0)) {
      merged[key] = left;
    }
  });
  return merged;
}

function applyRemoteData(data, mode = 'merge') {
  if (!data) return;
  if (mode === 'replace') {
    state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    state.favorites = data.favorites || {};
    state.journalMetrics = Array.isArray(data.journalMetrics) ? data.journalMetrics : [];
    state.translations = data.translations || {};
  } else {
    state.settings = { ...DEFAULT_SETTINGS, ...state.settings, ...(data.settings || {}) };
    state.favorites = mergeFavorites(data.favorites || {}, state.favorites);
    state.journalMetrics = state.journalMetrics.length ? state.journalMetrics : (Array.isArray(data.journalMetrics) ? data.journalMetrics : []);
    state.translations = { ...(data.translations || {}), ...state.translations };
  }
  state.metricIndex = null;
  state.papers = state.papers.map(enrichPaper);
  saveAllLocal();
  fillForms();
  renderAll();
}

async function syncLogin() {
  const username = compactText($('#sync-username-input').value);
  const password = $('#sync-password-input').value;
  try {
    const response = await fetch('/api/sync/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    state.session = { username: data.username, token: data.token, updatedAt: new Date().toISOString() };
    applyRemoteData(data.data, 'merge');
    saveJson(STORE_KEYS.session, state.session);
    await syncPush(false);
    setStatus(`已登录同步账号：${data.username}`);
  } catch (error) {
    setStatus(`同步登录失败：${error.message || error}`, true);
  }
}

async function syncPull() {
  if (!state.session.token) return setStatus('请先登录同步账号', true);
  try {
    const response = await fetch('/api/sync/pull', { headers: authHeaders() });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    applyRemoteData(data.data, 'replace');
    setStatus('已拉取云端数据');
  } catch (error) {
    setStatus(`拉取失败：${error.message || error}`, true);
  }
}

async function syncPush(showStatus = true) {
  if (!state.session.token) return;
  try {
    const response = await fetch('/api/sync/push', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ data: localSyncPayload() })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (showStatus) setStatus('已推送本机数据到云端');
  } catch (error) {
    if (showStatus) setStatus(`推送失败：${error.message || error}`, true);
  }
}

function scheduleSyncPush() {
  if (!state.session.token) return;
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(() => syncPush(false), 900);
}

function syncLogout() {
  state.session = {};
  saveJson(STORE_KEYS.session, state.session);
  $('#sync-password-input').value = '';
  renderSyncStatus();
  setStatus('已退出同步账号');
}

function renderSyncStatus() {
  const node = $('#sync-status');
  if (!node) return;
  node.textContent = state.session.token
    ? `已登录：${state.session.username}。本机改动会自动推送，也可手动拉取/推送。`
    : '未登录。登录后收藏、笔记、设置、指标表会在电脑和手机间同步。';
}

async function loadHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    const keys = data.keys || {};
    $('#key-status').innerHTML = `
      <strong>服务状态</strong>
      <span>OpenAlex mailto：${keys.openalexMailto ? '已配置' : '未配置'}</span>
      <span>CORE key：${keys.core ? '已配置' : '未配置'}</span>
      <span>Semantic Scholar key：${keys.semantic ? '已配置' : '未配置'}</span>
      <span>EasyScholar：${keys.easyScholar ? `已配置${keys.easyScholarMode ? `（${escapeHtml(keys.easyScholarMode)}）` : ''}` : '未配置'}</span>
      <span>翻译：${escapeHtml(keys.translationProvider || '可用')}</span>
      <span>账号同步：${keys.sync ? '可用' : '不可用'}</span>
    `;
  } catch (error) {
    $('#key-status').innerHTML = '<strong>服务状态</strong><span>检测失败</span>';
  }
}

function bindEvents() {
  $('#search-form').addEventListener('submit', refreshPapers);
  $('#clear-search').addEventListener('click', () => {
    $('#query-input').value = '';
    $('#arxiv-query-input').value = '';
    $('#local-filter-input').value = '';
    renderPapers();
  });
  $('#local-filter-input').addEventListener('input', renderPapers);
  $('#quality-filter-input').addEventListener('change', () => {
    state.settings.qualityFilterEnabled = $('#quality-filter-input').checked;
    $('#settings-quality-filter-input').checked = state.settings.qualityFilterEnabled;
    state.papers = state.papers.map(enrichPaper);
    saveJson(STORE_KEYS.settings, state.settings);
    renderAll();
  });
  $('#include-preprints-input').addEventListener('change', () => {
    state.settings.includePreprints = $('#include-preprints-input').checked;
    $('#settings-include-preprints-input').checked = state.settings.includePreprints;
    state.papers = state.papers.map(enrichPaper);
    saveJson(STORE_KEYS.settings, state.settings);
    renderAll();
  });
  $('#require-known-metrics-input').addEventListener('change', () => {
    state.settings.requireKnownMetrics = $('#require-known-metrics-input').checked;
    $('#settings-require-known-metrics-input').checked = state.settings.requireKnownMetrics;
    state.papers = state.papers.map(enrichPaper);
    saveJson(STORE_KEYS.settings, state.settings);
    renderAll();
  });
  $$('.view-tab').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  $$('.filter-tab').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    $$('.filter-tab').forEach((item) => item.classList.toggle('active', item === button));
    renderPapers();
  }));
  $$('.report-tab').forEach((button) => button.addEventListener('click', () => {
    state.reportType = button.dataset.report;
    $$('.report-tab').forEach((item) => item.classList.toggle('active', item === button));
    buildReport();
  }));
  $('#build-report').addEventListener('click', buildReport);
  $('#copy-report').addEventListener('click', copyReport);
  $('#download-report').addEventListener('click', downloadReport);
  $('#save-settings').addEventListener('click', saveSettings);
  $('#export-data').addEventListener('click', exportData);
  $('#export-favorites').addEventListener('click', exportFavorites);
  $('#import-data').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) importData(file);
  });
  $('#import-metrics').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) importMetrics(file);
  });
  $('#download-metrics-template').addEventListener('click', downloadMetricsTemplate);
  $('#clear-metrics').addEventListener('click', clearMetrics);
  $('#sync-login').addEventListener('click', syncLogin);
  $('#sync-pull').addEventListener('click', syncPull);
  $('#sync-push').addEventListener('click', () => syncPush(true));
  $('#sync-logout').addEventListener('click', syncLogout);
}

async function init() {
  fillForms();
  bindEvents();
  buildMetricIndex();
  renderAll();
  buildReport();
  await loadHealth();
  refreshPapers();
}

init();
