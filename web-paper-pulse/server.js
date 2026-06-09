const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, 'storage');
const USER_DB_FILE = process.env.USER_DB_FILE || path.join(STORAGE_DIR, 'users.json');

const SOURCE_LABELS = {
  hf: 'HF Daily',
  arxiv: 'arXiv',
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  pubmed: 'PubMed / PMC',
  core: 'CORE',
  semantic: 'Semantic Scholar'
};

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const index = trimmed.indexOf('=');
    if (index < 0) return;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function compactText(value) {
  return decodeEntities(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJsonFile(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeIssn(value) {
  return String(value || '').toUpperCase().replace(/[^0-9X]/g, '');
}

function uniqueIssns(values) {
  return Array.from(new Set((values || []).map(normalizeIssn).filter((item) => item.length >= 8)));
}

function syncSecret() {
  return process.env.SYNC_SECRET || 'paper-pulse-change-this-secret';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hmac(value) {
  return crypto.createHmac('sha256', syncSecret()).update(String(value)).digest('hex');
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function truncate(value, length = 220) {
  const text = compactText(value);
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function arxivIdFromUrl(value) {
  const match = String(value || '').match(/(\d{4}\.\d{4,5})(v\d+)?/);
  return match ? match[1] : String(value || '');
}

async function requestText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 18000);
  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'PaperPulseWeb/1.0 (personal research dashboard)',
        Accept: options.accept || '*/*',
        ...(options.headers || {})
      },
      signal: controller.signal
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 180)}`);
    return raw;
  } catch (error) {
    if (process.platform === 'win32' && options.method !== 'POST') {
      return requestTextWithPowerShell(url, options, error);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function psSingleQuote(value) {
  return String(value || '').replace(/'/g, "''");
}

function requestTextWithPowerShell(url, options = {}, originalError) {
  return new Promise((resolve, reject) => {
    const headers = {
      Accept: options.accept || '*/*',
      ...(options.headers || {})
    };
    const headerLines = Object.entries(headers)
      .filter(([key]) => key.toLowerCase() !== 'user-agent')
      .map(([key, value]) => `$headers['${psSingleQuote(key)}']='${psSingleQuote(value)}'`)
      .join('\n');
    const timeoutSec = Math.max(5, Math.ceil((options.timeout || 18000) / 1000));
    const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$headers = @{}
${headerLines}
try {
  $response = Invoke-WebRequest -Uri '${psSingleQuote(url)}' -UseBasicParsing -Headers $headers -UserAgent 'PaperPulseWeb/1.0 (personal research dashboard)' -TimeoutSec ${timeoutSec}
  [Console]::Out.Write($response.Content)
} catch {
  [Console]::Error.Write($_.Exception.Message)
  exit 1
}`;
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(originalError || new Error('Request timed out'));
    }, (options.timeout || 18000) + 6000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(originalError || error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || (originalError && originalError.message) || `PowerShell request failed: ${code}`));
    });
  });
}

async function requestJson(url, options = {}) {
  const raw = await requestText(url, { ...options, accept: 'application/json' });
  return raw ? JSON.parse(raw) : {};
}

function authorNames(authors) {
  if (!Array.isArray(authors)) return '';
  return authors.map((author) => {
    if (!author) return '';
    if (typeof author === 'string') return author;
    if (author.name || author.fullname || author.display_name) {
      return author.name || author.fullname || author.display_name;
    }
    if (author.given || author.family) return `${author.given || ''} ${author.family || ''}`.trim();
    if (author.author && (author.author.name || author.author.display_name)) {
      return author.author.name || author.author.display_name;
    }
    return '';
  }).filter(Boolean).join(', ');
}

function normalizePaper(paper) {
  const summary = compactText(paper.summary || '');
  return {
    ...paper,
    sourceLabel: paper.sourceLabel || SOURCE_LABELS[paper.source] || paper.source,
    title: compactText(paper.title),
    summary,
    shortSummary: paper.shortSummary || truncate(summary || paper.title),
    dateText: paper.dateText || formatDate(paper.publishedAt),
    tags: Array.isArray(paper.tags) ? paper.tags.filter(Boolean).slice(0, 8) : [],
    venueName: compactText(paper.venueName || paper.journal || paper.containerTitle || ''),
    issns: uniqueIssns(paper.issns || paper.ISSN || [])
  };
}

function normalizeHuggingFaceItem(item) {
  const paper = item.paper || item;
  const id = paper.id || item.id || paper._id || '';
  const arxivId = arxivIdFromUrl(id);
  const keywords = paper.ai_keywords || item.ai_keywords || [];
  return normalizePaper({
    id: `hf-${arxivId || id}`,
    arxivId,
    source: 'hf',
    title: paper.title || item.title,
    summary: paper.summary || item.summary || paper.ai_summary,
    authors: authorNames(paper.authors),
    publishedAt: paper.submittedOnDailyAt || item.publishedAt || paper.publishedAt,
    url: arxivId ? `https://huggingface.co/papers/${arxivId}` : 'https://huggingface.co/papers',
    absUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : '',
    pdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}` : '',
    codeUrl: paper.projectPage || item.projectPage || '',
    thumbnail: item.thumbnail || (paper.mediaUrls && paper.mediaUrls[0]) || '',
    tags: keywords,
    scoreText: paper.upvotes || item.numComments ? `${paper.upvotes || 0} up / ${item.numComments || 0} comments` : '',
    venueName: 'arXiv preprint'
  });
}

async function searchHuggingFace(maxResults) {
  const items = await requestJson('https://huggingface.co/api/daily_papers');
  return Array.isArray(items) ? items.slice(0, maxResults).map(normalizeHuggingFaceItem) : [];
}

function tagValue(block, tag) {
  const match = String(block || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? compactText(match[1]) : '';
}

function attrValue(attrs, name) {
  const match = String(attrs || '').match(new RegExp(`${name}=["']([^"']+)["']`, 'i'));
  return match ? decodeEntities(match[1]) : '';
}

function parseArxivEntries(xml) {
  const entries = String(xml || '').match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map((block) => {
    const idUrl = tagValue(block, 'id');
    const arxivId = arxivIdFromUrl(idUrl);
    const authors = (block.match(/<author>[\s\S]*?<\/author>/g) || [])
      .map((authorBlock) => tagValue(authorBlock, 'name'))
      .filter(Boolean);
    let absUrl = `https://arxiv.org/abs/${arxivId}`;
    let pdfUrl = `https://arxiv.org/pdf/${arxivId}`;
    (block.match(/<link\s+[^>]+\/?>/g) || []).forEach((link) => {
      const href = attrValue(link, 'href').replace('http://', 'https://');
      if (attrValue(link, 'rel') === 'alternate' && href) absUrl = href;
      if (attrValue(link, 'type') === 'application/pdf' && href) pdfUrl = href;
    });
    return normalizePaper({
      id: `arxiv-${arxivId}`,
      arxivId,
      source: 'arxiv',
      title: tagValue(block, 'title'),
      summary: tagValue(block, 'summary'),
      authors: authors.join(', '),
      publishedAt: tagValue(block, 'published') || tagValue(block, 'updated'),
      url: absUrl,
      absUrl,
      pdfUrl,
      venueName: 'arXiv preprint',
      tags: []
    });
  }).filter((paper) => paper.title);
}

function buildArxivQuery(query) {
  const text = compactText(query || 'large language models');
  if (/[:()"]|\b(AND|OR|NOT)\b/i.test(text)) return text;
  return `all:"${text.replace(/"/g, '')}"`;
}

async function searchArxiv(event, maxResults) {
  const query = encodeURIComponent(event.arxivQuery || buildArxivQuery(event.query));
  const sortBy = encodeURIComponent(event.arxivSortBy || 'submittedDate');
  const url = `https://export.arxiv.org/api/query?search_query=${query}&start=0&max_results=${maxResults}&sortBy=${sortBy}&sortOrder=descending`;
  return parseArxivEntries(await requestText(url));
}

function abstractFromInvertedIndex(index) {
  if (!index) return '';
  const words = [];
  Object.keys(index).forEach((word) => {
    (index[word] || []).forEach((position) => {
      words[position] = word;
    });
  });
  return compactText(words.join(' '));
}

function normalizeOpenAlexWork(work) {
  const openAlexId = String(work.id || '').split('/').pop();
  const primary = work.primary_location || {};
  const best = work.best_oa_location || {};
  const source = primary.source || best.source || work.host_venue || {};
  const doi = work.doi || '';
  const url = (primary.landing_page_url || best.landing_page_url || doi || work.id || '').replace('http://', 'https://');
  const pdfUrl = (best.pdf_url || (work.open_access && work.open_access.oa_url) || '').replace('http://', 'https://');
  const tags = (work.concepts || work.topics || []).map((item) => item.display_name || item.name).filter(Boolean);
  const issns = [
    source.issn_l,
    ...(Array.isArray(source.issn) ? source.issn : []),
    ...(Array.isArray(source.issns) ? source.issns : [])
  ];
  return normalizePaper({
    id: `openalex-${openAlexId || doi || work.title}`,
    doi,
    source: 'openalex',
    title: work.title || work.display_name,
    summary: abstractFromInvertedIndex(work.abstract_inverted_index),
    authors: authorNames(work.authorships),
    publishedAt: work.publication_date || work.updated_date,
    url,
    absUrl: url,
    pdfUrl,
    venueName: source.display_name || source.name || '',
    issns,
    tags,
    scoreText: work.cited_by_count ? `${work.cited_by_count} citations` : ''
  });
}

async function searchOpenAlex(query, maxResults) {
  const params = new URLSearchParams({
    search: compactText(query || 'large language models'),
    'per-page': String(maxResults),
    sort: 'publication_date:desc'
  });
  if (process.env.OPENALEX_MAILTO) params.set('mailto', process.env.OPENALEX_MAILTO);
  const data = await requestJson(`https://api.openalex.org/works?${params.toString()}`);
  return (data.results || []).map(normalizeOpenAlexWork).filter((paper) => paper.title);
}

function dateFromParts(parts) {
  const values = parts && parts['date-parts'] && parts['date-parts'][0];
  if (!values) return '';
  const year = values[0] || '0000';
  const month = String(values[1] || 1).padStart(2, '0');
  const day = String(values[2] || 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeCrossrefWork(work) {
  const doi = work.DOI || '';
  const pdf = (work.link || []).find((link) => String(link['content-type'] || '').includes('pdf'));
  const container = work['container-title'] && work['container-title'][0] ? work['container-title'][0] : '';
  const publishedAt = dateFromParts(work.published) || dateFromParts(work['published-print']) || dateFromParts(work['published-online']);
  const url = (work.URL || (doi ? `https://doi.org/${doi}` : '')).replace('http://', 'https://');
  return normalizePaper({
    id: `crossref-${doi || url}`,
    doi,
    source: 'crossref',
    title: (work.title && work.title[0]) || '',
    summary: work.abstract || '',
    authors: authorNames(work.author),
    publishedAt,
    url,
    absUrl: url,
    pdfUrl: pdf && pdf.URL ? pdf.URL.replace('http://', 'https://') : '',
    venueName: container,
    issns: work.ISSN || [],
    tags: [container, work.type].filter(Boolean),
    scoreText: work['is-referenced-by-count'] ? `${work['is-referenced-by-count']} citations` : ''
  });
}

async function searchCrossref(query, maxResults) {
  const params = new URLSearchParams({
    query: compactText(query || 'large language models'),
    rows: String(maxResults),
    sort: 'published',
    order: 'desc'
  });
  const data = await requestJson(`https://api.crossref.org/works?${params.toString()}`);
  return (((data || {}).message || {}).items || []).map(normalizeCrossrefWork).filter((paper) => paper.title);
}

function articleIdValue(block, type) {
  const match = String(block || '').match(new RegExp(`<ArticleId[^>]*IdType=["']${type}["'][^>]*>([\\s\\S]*?)<\\/ArticleId>`, 'i'));
  return match ? compactText(match[1]) : '';
}

function parsePubDate(block) {
  const pubDate = String(block || '').match(/<PubDate>([\s\S]*?)<\/PubDate>/i);
  if (!pubDate) return '';
  const dateBlock = pubDate[1];
  const year = tagValue(dateBlock, 'Year') || String(tagValue(dateBlock, 'MedlineDate')).slice(0, 4);
  if (!year) return '';
  const monthMap = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  const month = String(monthMap[tagValue(dateBlock, 'Month')] || tagValue(dateBlock, 'Month') || '01').padStart(2, '0');
  const day = String(tagValue(dateBlock, 'Day') || '01').padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parsePubMedArticles(xml) {
  const articles = String(xml || '').match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
  return articles.map((block) => {
    const pmid = tagValue(block, 'PMID');
    const doi = articleIdValue(block, 'doi');
    const pmc = articleIdValue(block, 'pmc');
    const abstract = (block.match(/<AbstractText[^>]*>[\s\S]*?<\/AbstractText>/g) || []).map(compactText).join('\n\n');
    const authors = (block.match(/<Author\b[^>]*>[\s\S]*?<\/Author>/g) || []).map((authorBlock) => {
      return `${tagValue(authorBlock, 'ForeName') || tagValue(authorBlock, 'Initials')} ${tagValue(authorBlock, 'LastName')}`.trim();
    }).filter(Boolean);
    const journal = tagValue(block, 'Title');
    const issnBlocks = block.match(/<ISSN[^>]*>[\s\S]*?<\/ISSN>/g) || [];
    const issns = issnBlocks.map((item) => compactText(item));
    return normalizePaper({
      id: `pubmed-${pmid}`,
      doi,
      source: 'pubmed',
      title: tagValue(block, 'ArticleTitle'),
      summary: abstract || journal,
      authors: authors.join(', '),
      publishedAt: parsePubDate(block),
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      absUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      pdfUrl: pmc ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmc}/pdf/` : '',
      venueName: journal,
      issns,
      tags: [journal].filter(Boolean),
      scoreText: pmc ? 'PMC full text' : ''
    });
  }).filter((paper) => paper.title);
}

async function searchPubMed(query, maxResults) {
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(compactText(query))}&retmode=json&retmax=${maxResults}&sort=pub+date`;
  const data = await requestJson(searchUrl);
  const ids = data && data.esearchresult && data.esearchresult.idlist ? data.esearchresult.idlist : [];
  if (!ids.length) return [];
  const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml`;
  return parsePubMedArticles(await requestText(fetchUrl));
}

function normalizeCoreWork(work) {
  const doi = work.doi || '';
  const downloadUrl = work.downloadUrl || work.fullTextIdentifier || '';
  const sourceUrl = work.sourceFulltextUrls && work.sourceFulltextUrls[0] ? work.sourceFulltextUrls[0] : '';
  const url = work.url || sourceUrl || (doi ? `https://doi.org/${doi}` : '');
  return normalizePaper({
    id: `core-${work.id || work.oai || doi || work.title}`,
    doi,
    source: 'core',
    title: work.title,
    summary: work.abstract || work.description || '',
    authors: authorNames(work.authors),
    publishedAt: work.publishedDate || work.yearPublished || '',
    url,
    absUrl: url,
    pdfUrl: downloadUrl,
    venueName: work.publisher || work.journal || '',
    tags: (work.repositories || []).map((repo) => repo.name || repo),
    scoreText: work.citationCount ? `${work.citationCount} citations` : ''
  });
}

async function searchCore(query, maxResults) {
  if (!process.env.CORE_API_KEY) throw new Error('缺少 CORE_API_KEY，请在 .env 中配置后重启服务');
  const data = await requestJson(`https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(compactText(query))}&limit=${maxResults}`, {
    headers: { Authorization: `Bearer ${process.env.CORE_API_KEY}` }
  });
  return (data.results || []).map(normalizeCoreWork).filter((paper) => paper.title);
}

function normalizeSemanticPaper(paper) {
  const externalIds = paper.externalIds || {};
  const doi = externalIds.DOI || '';
  const arxivId = externalIds.ArXiv || '';
  const pdf = paper.openAccessPdf || {};
  const publishedAt = paper.publicationDate || (paper.year ? `${paper.year}-01-01` : '');
  const url = paper.url || (doi ? `https://doi.org/${doi}` : '');
  const venueName = paper.publicationVenue && paper.publicationVenue.name ? paper.publicationVenue.name : '';
  return normalizePaper({
    id: `semantic-${paper.paperId || doi || arxivId || paper.title}`,
    doi,
    arxivId,
    source: 'semantic',
    title: paper.title,
    summary: paper.abstract || '',
    authors: authorNames(paper.authors),
    publishedAt,
    url,
    absUrl: url,
    pdfUrl: pdf.url || '',
    venueName,
    issns: paper.publicationVenue && paper.publicationVenue.issn ? [paper.publicationVenue.issn] : [],
    tags: venueName ? [venueName] : [],
    scoreText: paper.citationCount ? `${paper.citationCount} citations` : ''
  });
}

async function searchSemanticScholar(query, maxResults) {
  if (!process.env.SEMANTIC_SCHOLAR_API_KEY) throw new Error('缺少 SEMANTIC_SCHOLAR_API_KEY，请在 .env 中配置后重启服务');
  const fields = ['title', 'abstract', 'authors', 'year', 'url', 'openAccessPdf', 'citationCount', 'publicationDate', 'externalIds', 'publicationVenue'].join(',');
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(compactText(query))}&limit=${maxResults}&fields=${fields}`;
  const data = await requestJson(url, { headers: { 'x-api-key': process.env.SEMANTIC_SCHOLAR_API_KEY } });
  return (data.data || []).map(normalizeSemanticPaper).filter((paper) => paper.title);
}

const SEARCHERS = {
  hf: (event, max) => searchHuggingFace(max),
  arxiv: (event, max) => searchArxiv(event, max),
  openalex: (event, max) => searchOpenAlex(event.query, max),
  crossref: (event, max) => searchCrossref(event.query, max),
  pubmed: (event, max) => searchPubMed(event.query, max),
  core: (event, max) => searchCore(event.query, max),
  semantic: (event, max) => searchSemanticScholar(event.query, max)
};

function paperKey(paper) {
  const doi = String(paper.doi || '').toLowerCase().replace(/^https?:\/\/doi.org\//, '');
  if (doi) return `doi:${doi}`;
  if (paper.arxivId) return `arxiv:${String(paper.arxivId).toLowerCase()}`;
  return `title:${compactText(paper.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;
}

function mergePapers(papers) {
  const map = new Map();
  papers.forEach((paper) => {
    const key = paperKey(paper);
    if (!map.has(key)) {
      map.set(key, { ...paper, sources: [paper.source], sourceLabels: [paper.sourceLabel || SOURCE_LABELS[paper.source] || paper.source] });
      return;
    }
    const current = map.get(key);
    current.sources = Array.from(new Set([...(current.sources || []), paper.source]));
    current.sourceLabels = Array.from(new Set([...(current.sourceLabels || []), paper.sourceLabel || SOURCE_LABELS[paper.source] || paper.source]));
    current.summary = current.summary || paper.summary;
    current.pdfUrl = current.pdfUrl || paper.pdfUrl;
    current.url = current.url || paper.url;
    current.absUrl = current.absUrl || paper.absUrl;
    current.venueName = current.venueName || paper.venueName;
    current.issns = uniqueIssns([...(current.issns || []), ...(paper.issns || [])]);
    current.tags = Array.from(new Set([...(current.tags || []), ...(paper.tags || [])])).slice(0, 8);
    current.scoreText = current.scoreText || paper.scoreText;
  });
  return Array.from(map.values()).sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
}

function splitTextForTranslation(text, maxLength = 1600) {
  const source = compactText(text);
  if (!source) return [];
  const chunks = [];
  let current = '';
  source.split(/(?<=[.!?。！？])\s+/).forEach((sentence) => {
    if ((current + ' ' + sentence).trim().length > maxLength && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  });
  if (current) chunks.push(current.trim());
  return chunks;
}

async function translateWithLibre(text, target) {
  const endpoint = `${String(process.env.LIBRETRANSLATE_URL || '').replace(/\/$/, '')}/translate`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      source: 'auto',
      target: target === 'zh-CN' ? 'zh' : target,
      format: 'text',
      api_key: process.env.LIBRETRANSLATE_API_KEY || undefined
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `LibreTranslate HTTP ${res.status}`);
  return data.translatedText || '';
}

async function translateWithGoogle(text, target) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
  const data = await requestJson(url, { timeout: 22000 });
  return Array.isArray(data) && Array.isArray(data[0])
    ? data[0].map((part) => part && part[0] ? part[0] : '').join('')
    : '';
}

async function translateText(text, target = 'zh-CN') {
  const chunks = splitTextForTranslation(text);
  const provider = process.env.LIBRETRANSLATE_URL ? 'libretranslate' : 'google';
  const translated = [];
  for (const chunk of chunks) {
    if (provider === 'libretranslate') translated.push(await translateWithLibre(chunk, target));
    else translated.push(await translateWithGoogle(chunk, target));
  }
  return { provider, translatedText: translated.join('\n\n') };
}

function sanitizeSyncData(data = {}) {
  return {
    settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
    favorites: data.favorites && typeof data.favorites === 'object' ? data.favorites : {},
    journalMetrics: Array.isArray(data.journalMetrics) ? data.journalMetrics.slice(0, 20000) : [],
    translations: data.translations && typeof data.translations === 'object' ? data.translations : {},
    updatedAt: new Date().toISOString()
  };
}

function readUserDb() {
  const db = readJsonFile(USER_DB_FILE, { users: {} });
  if (!db.users) db.users = {};
  return db;
}

function writeUserDb(db) {
  writeJsonFile(USER_DB_FILE, db);
}

function passwordHash(username, password, salt) {
  return sha256(`${syncSecret()}:${username}:${salt}:${password}`);
}

function makeToken(username) {
  const payload = JSON.stringify({
    username,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30
  });
  const body = base64UrlEncode(payload);
  return `${body}.${hmac(body)}`;
}

function verifyTokenFromRequest(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const [body, signature] = token.split('.');
  if (!body || !signature || hmac(body) !== signature) throw new Error('请先登录同步账号');
  const payload = JSON.parse(base64UrlDecode(body));
  if (!payload.username || payload.exp < Date.now()) throw new Error('登录已过期，请重新登录');
  return payload.username;
}

function loginSyncAccount({ username, password }) {
  const name = compactText(username).toLowerCase();
  if (!/^[a-z0-9_.@-]{2,64}$/i.test(name)) throw new Error('账号名只能包含字母、数字、点、下划线、@ 或短横线');
  if (!password || String(password).length < 6) throw new Error('密码至少 6 位');

  const db = readUserDb();
  const existing = db.users[name];
  if (!existing) {
    const salt = crypto.randomBytes(16).toString('hex');
    db.users[name] = {
      username: name,
      salt,
      passwordHash: passwordHash(name, password, salt),
      data: sanitizeSyncData({}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    writeUserDb(db);
  } else if (existing.passwordHash !== passwordHash(name, password, existing.salt)) {
    throw new Error('账号或密码不正确');
  }

  return {
    token: makeToken(name),
    username: name,
    data: db.users[name].data || sanitizeSyncData({})
  };
}

function pullSyncData(username) {
  const db = readUserDb();
  const user = db.users[username];
  if (!user) throw new Error('账号不存在');
  return user.data || sanitizeSyncData({});
}

function pushSyncData(username, data) {
  const db = readUserDb();
  const user = db.users[username];
  if (!user) throw new Error('账号不存在');
  user.data = sanitizeSyncData(data);
  user.updatedAt = new Date().toISOString();
  writeUserDb(db);
  return user.data;
}

async function runSearch(payload) {
  const selectedSources = Array.isArray(payload.sources) && payload.sources.length ? payload.sources : ['arxiv', 'openalex'];
  const sources = selectedSources.filter((source) => SEARCHERS[source]);
  const maxResults = Math.max(1, Math.min(Number(payload.maxResults) || 20, 50));
  const event = {
    query: compactText(payload.query || 'large language models'),
    arxivQuery: compactText(payload.arxivQuery || ''),
    arxivSortBy: payload.arxivSortBy || 'submittedDate'
  };
  const settled = await Promise.all(sources.map(async (source) => {
    try {
      const papers = await SEARCHERS[source](event, maxResults);
      return { source, ok: true, papers };
    } catch (error) {
      return { source, ok: false, papers: [], error: error.message || String(error) };
    }
  }));
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    papers: mergePapers(settled.flatMap((item) => item.papers)),
    errors: settled.filter((item) => !item.ok).map((item) => ({
      source: item.source,
      sourceLabel: SOURCE_LABELS[item.source] || item.source,
      message: item.error
    }))
  };
}

function keyStatus() {
  return {
    openalexMailto: Boolean(process.env.OPENALEX_MAILTO),
    core: Boolean(process.env.CORE_API_KEY),
    semantic: Boolean(process.env.SEMANTIC_SCHOLAR_API_KEY),
    translationProvider: process.env.LIBRETRANSLATE_URL ? 'LibreTranslate' : 'Google Translate fallback',
    sync: true,
    customSyncSecret: Boolean(process.env.SYNC_SECRET)
  };
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body ? JSON.parse(body) : {}));
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  const relativePath = path.relative(PUBLIC_DIR, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml'
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  try {
    if (url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, sources: SOURCE_LABELS, keys: keyStatus() });
    }
    if (url.pathname === '/api/search' && req.method === 'POST') {
      return sendJson(res, 200, await runSearch(await readBody(req)));
    }
    if (url.pathname === '/api/translate' && req.method === 'POST') {
      const body = await readBody(req);
      const text = compactText(body.text || '');
      if (!text) return sendJson(res, 400, { ok: false, error: '缺少需要翻译的文本' });
      return sendJson(res, 200, { ok: true, ...(await translateText(text, body.target || 'zh-CN')) });
    }
    if (url.pathname === '/api/sync/login' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true, ...loginSyncAccount(await readBody(req)) });
    }
    if (url.pathname === '/api/sync/pull' && req.method === 'GET') {
      const username = verifyTokenFromRequest(req);
      return sendJson(res, 200, { ok: true, username, data: pullSyncData(username) });
    }
    if (url.pathname === '/api/sync/push' && req.method === 'POST') {
      const username = verifyTokenFromRequest(req);
      const body = await readBody(req);
      return sendJson(res, 200, { ok: true, username, data: pushSyncData(username, body.data || {}) });
    }
    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error.message || String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Paper Pulse Web is running at http://${HOST}:${PORT}`);
});
