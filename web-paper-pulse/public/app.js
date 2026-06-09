const STORE_KEYS = {
  settings: 'paperPulseWeb.settings',
  favorites: 'paperPulseWeb.favorites'
};

const DEFAULT_SETTINGS = {
  profileName: '经济预测与智能决策',
  includeKeywords: '经济预测, economic forecasting, nowcasting, macroeconomic forecasting, time series, machine learning, deep learning, transformer, uncertainty',
  excludeKeywords: 'advertisement, editorial, correction',
  maxResults: 20,
  sources: ['openalex', 'arxiv'],
  arxivSortBy: 'submittedDate'
};

const state = {
  view: 'search',
  filter: 'all',
  reportType: 'daily',
  selectedId: '',
  papers: [],
  errors: [],
  updatedAt: '',
  settings: loadJson(STORE_KEYS.settings, DEFAULT_SETTINGS),
  favorites: loadJson(STORE_KEYS.favorites, {})
};

const sourceNames = {
  hf: 'HF Daily',
  arxiv: 'arXiv',
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  pubmed: 'PubMed / PMC',
  core: 'CORE',
  semantic: 'Semantic Scholar'
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch (error) {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
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

function stableKey(paper) {
  const doi = String(paper.doi || '').toLowerCase().replace(/^https?:\/\/doi.org\//, '');
  if (doi) return `doi:${doi}`;
  if (paper.arxivId) return `arxiv:${String(paper.arxivId).toLowerCase()}`;
  if (paper.id) return `id:${String(paper.id).toLowerCase()}`;
  return `title:${normalizeText(paper.title).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;
}

function sourceLabel(paper) {
  if (Array.isArray(paper.sourceLabels) && paper.sourceLabels.length) return paper.sourceLabels.join(' + ');
  return paper.sourceLabel || sourceNames[paper.source] || paper.source || 'Unknown';
}

function citationNumber(paper) {
  const match = String(paper.scoreText || '').match(/(\d+)\s+citations?/i);
  return match ? Number(match[1]) : 0;
}

function scorePaper(paper) {
  const includeKeywords = splitKeywords(state.settings.includeKeywords);
  const excludeKeywords = splitKeywords(state.settings.excludeKeywords);
  const title = normalizeText(paper.title);
  const body = normalizeText(`${paper.title} ${paper.summary} ${(paper.tags || []).join(' ')} ${paper.authors || ''}`);
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
    isRecommended: score >= 32 || uniqueHits.length >= 2
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
  $$('input[name="sources"]').forEach((input) => {
    input.checked = (state.settings.sources || DEFAULT_SETTINGS.sources).includes(input.value);
  });
}

function readSearchPayload() {
  const sources = $$('input[name="sources"]:checked').map((input) => input.value);
  const payload = {
    query: compactText($('#query-input').value) || 'large language models',
    arxivQuery: compactText($('#arxiv-query-input').value),
    maxResults: Number($('#max-results-input').value) || 20,
    arxivSortBy: $('#arxiv-sort-input').value,
    sources: sources.length ? sources : ['openalex']
  };
  state.settings = {
    ...state.settings,
    maxResults: payload.maxResults,
    arxivSortBy: payload.arxivSortBy,
    sources: payload.sources,
    lastQuery: payload.query,
    lastArxivQuery: payload.arxivQuery
  };
  saveJson(STORE_KEYS.settings, state.settings);
  return payload;
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
    state.papers = (data.papers || [])
      .map(enrichPaper)
      .sort((a, b) => b.relevanceScore - a.relevanceScore || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

    state.selectedId = state.papers[0] ? state.papers[0].key : '';
    renderAll();

    const failed = state.errors.map((item) => item.sourceLabel).join('、');
    if (failed) {
      setStatus(`更新于 ${formatDate(state.updatedAt)}，${state.papers.length} 篇；失败来源：${failed}`, true);
    } else {
      setStatus(`更新于 ${formatDate(state.updatedAt)}，${state.papers.length} 篇`);
    }
  } catch (error) {
    setStatus(`刷新失败：${error.message || error}`, true);
    $('#paper-list').innerHTML = '<div class="empty-state">请求失败</div>';
  }
}

function visiblePapers() {
  const localFilter = normalizeText($('#local-filter-input').value);
  return state.papers.filter((paper) => {
    if (state.filter === 'recommended' && !paper.isRecommended) return false;
    if (state.filter === 'pdf' && !paper.pdfUrl) return false;
    if (!localFilter) return true;
    const text = normalizeText(`${paper.title} ${paper.authors} ${paper.summary} ${(paper.tags || []).join(' ')}`);
    return text.includes(localFilter);
  });
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
    savedAt: existing.savedAt || new Date().toISOString()
  };
  saveJson(STORE_KEYS.favorites, state.favorites);
}

function removeFavorite(paper) {
  const key = paper.key || stableKey(paper);
  delete state.favorites[key];
  saveJson(STORE_KEYS.favorites, state.favorites);
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
}

function renderPapers() {
  const papers = visiblePapers();
  $('#paper-count').textContent = `${papers.length} 篇`;
  renderList($('#paper-list'), papers, '没有匹配的论文');
}

function renderFavorites() {
  const papers = Object.values(state.favorites)
    .map((item) => enrichPaper({ ...item.paper, note: item.note, userRating: item.rating }))
    .sort((a, b) => new Date(b.favoriteSavedAt || 0) - new Date(a.favoriteSavedAt || 0));
  renderList($('#favorite-list'), papers, '还没有收藏论文');
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
    $('.paper-meta', card).innerHTML = renderMeta(paper);
    $('h3', card).textContent = paper.title || 'Untitled';
    $('.paper-authors', card).textContent = paper.authors || '作者信息暂缺';
    $('.paper-summary', card).textContent = paper.shortSummary || paper.summary || '摘要暂缺';
    $('.paper-tags', card).innerHTML = renderTags(paper);

    const favoriteButton = $('.favorite-button', card);
    const saved = Boolean(favoriteRecord(paper));
    favoriteButton.textContent = saved ? '★' : '☆';
    favoriteButton.classList.toggle('saved', saved);
    favoriteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFavorite(paper);
    });

    const pdfLink = $('.pdf-link', card);
    pdfLink.href = paper.pdfUrl || '#';
    pdfLink.classList.toggle('disabled', !paper.pdfUrl);
    pdfLink.addEventListener('click', (event) => event.stopPropagation());

    const sourceLink = $('.source-link', card);
    sourceLink.href = paper.url || paper.absUrl || '#';
    sourceLink.classList.toggle('disabled', !(paper.url || paper.absUrl));
    sourceLink.addEventListener('click', (event) => event.stopPropagation());

    card.addEventListener('click', () => {
      state.selectedId = paper.key;
      renderAll();
    });
    fragment.appendChild(card);
  });
  container.replaceChildren(fragment);
}

function renderMeta(paper) {
  const pieces = [
    `<span class="badge source">${escapeHtml(sourceLabel(paper))}</span>`,
    paper.dateText || paper.publishedAt ? `<span class="badge">${escapeHtml(paper.dateText || formatDate(paper.publishedAt))}</span>` : '',
    `<span class="badge score">${paper.relevanceScore || 0}</span>`,
    paper.isRecommended ? '<span class="badge warning">推荐</span>' : '',
    paper.scoreText ? `<span class="badge">${escapeHtml(paper.scoreText)}</span>` : ''
  ];
  return pieces.filter(Boolean).join('');
}

function renderTags(paper) {
  const tags = Array.from(new Set([...(paper.keywordHits || []), ...(paper.tags || [])])).slice(0, 8);
  return tags.map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join('');
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
  const links = [
    paper.pdfUrl ? `<a href="${escapeHtml(paper.pdfUrl)}" target="_blank" rel="noreferrer">PDF</a>` : '',
    paper.url || paper.absUrl ? `<a href="${escapeHtml(paper.url || paper.absUrl)}" target="_blank" rel="noreferrer">原文</a>` : '',
    paper.doi ? `<a href="https://doi.org/${escapeHtml(String(paper.doi).replace(/^https?:\/\/doi.org\//, ''))}" target="_blank" rel="noreferrer">DOI</a>` : '',
    paper.codeUrl ? `<a href="${escapeHtml(paper.codeUrl)}" target="_blank" rel="noreferrer">代码</a>` : ''
  ].filter(Boolean).join('');

  panel.innerHTML = `
    <p class="eyebrow">Reader</p>
    <h2 class="reader-title">${escapeHtml(paper.title)}</h2>
    <div class="reader-meta">${renderMeta(paper)}</div>
    <p class="paper-authors">${escapeHtml(paper.authors || '作者信息暂缺')}</p>
    <div class="reader-section">
      <h3>摘要</h3>
      <p class="reader-summary">${escapeHtml(paper.summary || paper.shortSummary || '摘要暂缺')}</p>
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
      `- 日期：${paper.dateText || formatDate(paper.publishedAt) || '未知'}`,
      `- 相关性：${paper.relevanceScore || 0}`,
      `- 命中词：${(paper.keywordHits || []).join(', ') || '无'}`,
      `- 链接：${paper.url || paper.absUrl || ''}`,
      `- PDF：${paper.pdfUrl || '暂无'}`,
      `- 摘要：${paper.shortSummary || paper.summary || '暂无'}`
    );
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
    '## 高频关键词',
    ...(keywords.length ? keywords.slice(0, 20).map(([keyword, count]) => `- ${keyword}: ${count}`) : ['- 暂无命中']),
    '',
    '## 高分论文'
  ];
  top.forEach((paper, index) => {
    lines.push(`${index + 1}. ${paper.title} (${paper.relevanceScore || 0})`);
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
      lines.push(`${index + 1}. ${paper.title} (${paper.relevanceScore || 0})`);
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
  const papers = getReportPapers();
  let markdown = '';
  if (state.reportType === 'daily') markdown = buildDailyReport(papers);
  if (state.reportType === 'annual') markdown = buildAnnualReport(papers);
  if (state.reportType === 'roadmap') markdown = buildRoadmapReport(papers);
  $('#report-output').value = markdown;
}

async function copyReport() {
  const text = $('#report-output').value || '';
  if (!text) buildReport();
  await navigator.clipboard.writeText($('#report-output').value);
  setStatus('报告已复制');
}

function downloadReport() {
  if (!$('#report-output').value) buildReport();
  const blob = new Blob([$('#report-output').value], { type: 'text/markdown;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `paper-pulse-${state.reportType}-${formatDate(new Date())}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function saveSettings() {
  state.settings = {
    ...state.settings,
    profileName: compactText($('#profile-name-input').value) || DEFAULT_SETTINGS.profileName,
    includeKeywords: $('#include-keywords-input').value,
    excludeKeywords: $('#exclude-keywords-input').value,
    maxResults: Number($('#max-results-input').value) || 20,
    arxivSortBy: $('#arxiv-sort-input').value,
    sources: $$('input[name="sources"]:checked').map((input) => input.value)
  };
  saveJson(STORE_KEYS.settings, state.settings);
  state.papers = state.papers.map(enrichPaper).sort((a, b) => b.relevanceScore - a.relevanceScore);
  renderAll();
  setStatus('设置已保存');
}

function exportData() {
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    favorites: state.favorites
  }, null, 2)], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `paper-pulse-data-${formatDate(new Date())}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.settings) state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
      if (data.favorites) state.favorites = data.favorites;
      saveJson(STORE_KEYS.settings, state.settings);
      saveJson(STORE_KEYS.favorites, state.favorites);
      fillForms();
      state.papers = state.papers.map(enrichPaper);
      renderAll();
      setStatus('数据已导入');
    } catch (error) {
      setStatus(`导入失败：${error.message || error}`, true);
    }
  };
  reader.readAsText(file, 'utf-8');
}

function exportFavorites() {
  const markdown = buildDailyReport(Object.values(state.favorites).map((item) => enrichPaper({ ...item.paper, note: item.note, userRating: item.rating })));
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `paper-pulse-favorites-${formatDate(new Date())}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

async function loadHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    const keys = data.keys || {};
    $('#key-status').innerHTML = `
      <strong>本地服务状态</strong>
      <span>OpenAlex mailto：${keys.openalexMailto ? '已配置' : '未配置'}</span>
      <span>CORE key：${keys.core ? '已配置' : '未配置'}</span>
      <span>Semantic Scholar key：${keys.semantic ? '已配置' : '未配置'}</span>
    `;
  } catch (error) {
    $('#key-status').innerHTML = '<strong>本地服务状态</strong><span>检测失败</span>';
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
}

async function init() {
  fillForms();
  bindEvents();
  renderAll();
  buildReport();
  await loadHealth();
  refreshPapers();
}

init();
