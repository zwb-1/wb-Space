const https = require('https');

const SOURCE_LABELS = {
  hf: 'HF Daily',
  arxiv: 'ArXiv',
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  pubmed: 'PubMed',
  core: 'CORE',
  semantic: 'Semantic Scholar'
};

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

function formatDate(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 10);
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function truncate(value, length) {
  const text = compactText(value);
  if (text.length <= length) {
    return text;
  }
  return `${text.slice(0, length - 1)}...`;
}

function arxivIdFromUrl(value) {
  const match = String(value || '').match(/(\d{4}\.\d{4,5})(v\d+)?/);
  return match ? match[1] : String(value || '');
}

function requestText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      method: options.method || 'GET',
      headers: Object.assign({
        'User-Agent': 'paper-reader-mini/1.0'
      }, options.headers || {})
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 180)}`));
          return;
        }
        resolve(raw);
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function requestJson(url, options = {}) {
  const raw = await requestText(url, options);
  return raw ? JSON.parse(raw) : {};
}

function authorNames(authors) {
  if (!Array.isArray(authors)) {
    return '';
  }
  return authors.map((author) => {
    if (!author) {
      return '';
    }
    if (typeof author === 'string') {
      return author;
    }
    if (author.name || author.fullname || author.display_name) {
      return author.name || author.fullname || author.display_name;
    }
    if (author.given || author.family) {
      return `${author.given || ''} ${author.family || ''}`.trim();
    }
    if (author.author && (author.author.name || author.author.display_name)) {
      return author.author.name || author.author.display_name;
    }
    return '';
  }).filter(Boolean).join(', ');
}

function normalizePaper(paper) {
  const summary = compactText(paper.summary || '');
  return Object.assign({}, paper, {
    sourceLabel: paper.sourceLabel || SOURCE_LABELS[paper.source] || paper.source,
    summary,
    shortSummary: paper.shortSummary || truncate(summary || paper.title, 170),
    dateText: paper.dateText || formatDate(paper.publishedAt),
    tags: paper.tags || []
  });
}

function normalizeHuggingFaceItem(item) {
  const paper = item.paper || item;
  const id = paper.id || item.id || paper._id;
  const arxivId = arxivIdFromUrl(id);
  const title = compactText(paper.title || item.title);
  const summary = compactText(paper.summary || item.summary || paper.ai_summary);
  const publishedAt = paper.submittedOnDailyAt || item.publishedAt || paper.publishedAt;
  const projectPage = paper.projectPage || item.projectPage || '';
  const thumbnail = item.thumbnail || (paper.mediaUrls && paper.mediaUrls[0]) || (item.mediaUrls && item.mediaUrls[0]) || '';
  const keywords = paper.ai_keywords || item.ai_keywords || [];

  return normalizePaper({
    id: `hf-${arxivId}`,
    arxivId,
    source: 'hf',
    title,
    summary,
    authors: authorNames(paper.authors),
    publishedAt,
    url: `https://huggingface.co/papers/${arxivId}`,
    absUrl: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    codeUrl: projectPage,
    thumbnail,
    tags: keywords.slice(0, 5),
    scoreText: paper.upvotes || item.numComments ? `${paper.upvotes || 0} up / ${item.numComments || 0} comments` : ''
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
    const authors = [];
    const authorBlocks = block.match(/<author>[\s\S]*?<\/author>/g) || [];
    authorBlocks.forEach((authorBlock) => {
      const name = tagValue(authorBlock, 'name');
      if (name) {
        authors.push(name);
      }
    });

    let absUrl = `https://arxiv.org/abs/${arxivId}`;
    let pdfUrl = `https://arxiv.org/pdf/${arxivId}`;
    const links = block.match(/<link\s+[^>]+\/?>/g) || [];
    links.forEach((link) => {
      const href = attrValue(link, 'href');
      const type = attrValue(link, 'type');
      const rel = attrValue(link, 'rel');
      if (rel === 'alternate' && href) {
        absUrl = href.replace('http://', 'https://');
      }
      if (type === 'application/pdf' && href) {
        pdfUrl = href.replace('http://', 'https://');
      }
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
      codeUrl: '',
      thumbnail: '',
      tags: [],
      scoreText: ''
    });
  });
}

async function searchArxiv(event, maxResults) {
  const query = encodeURIComponent(event.arxivQuery || event.query || 'abs:LLM OR abs:"AI Agent" OR abs:"Deep Learning"');
  const sortBy = encodeURIComponent(event.arxivSortBy || 'submittedDate');
  const url = `https://export.arxiv.org/api/query?search_query=${query}&start=0&max_results=${maxResults}&sortBy=${sortBy}&sortOrder=descending`;
  return parseArxivEntries(await requestText(url));
}

function abstractFromInvertedIndex(index) {
  if (!index) {
    return '';
  }
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
  const primaryLocation = work.primary_location || {};
  const bestOaLocation = work.best_oa_location || {};
  const doi = work.doi || '';
  const url = (primaryLocation.landing_page_url || bestOaLocation.landing_page_url || doi || work.id || '').replace('http://', 'https://');
  const pdfUrl = (bestOaLocation.pdf_url || (work.open_access && work.open_access.oa_url) || '').replace('http://', 'https://');
  const concepts = work.concepts || work.topics || [];
  const tags = concepts.map((item) => item.display_name || item.name).filter(Boolean).slice(0, 5);

  return normalizePaper({
    id: `openalex-${openAlexId || doi || work.title}`,
    doi,
    source: 'openalex',
    title: compactText(work.title || work.display_name),
    summary: abstractFromInvertedIndex(work.abstract_inverted_index),
    authors: authorNames(work.authorships),
    publishedAt: work.publication_date || work.updated_date,
    url,
    absUrl: url,
    pdfUrl,
    codeUrl: '',
    thumbnail: '',
    tags,
    scoreText: work.cited_by_count ? `${work.cited_by_count} citations` : ''
  });
}

async function searchOpenAlex(query, maxResults) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${maxResults}&sort=publication_date:desc`;
  const headers = {};
  if (process.env.OPENALEX_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OPENALEX_API_KEY}`;
  }
  const data = await requestJson(url, { headers });
  return (data.results || []).map(normalizeOpenAlexWork);
}

function dateFromParts(parts) {
  if (!parts || !parts['date-parts'] || !parts['date-parts'][0]) {
    return '';
  }
  const values = parts['date-parts'][0];
  const year = values[0] || '0000';
  const month = String(values[1] || 1).padStart(2, '0');
  const day = String(values[2] || 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeCrossrefWork(work) {
  const doi = work.DOI || '';
  const links = work.link || [];
  const pdf = links.find((link) => String(link['content-type'] || '').indexOf('pdf') >= 0);
  const container = work['container-title'] && work['container-title'][0] ? work['container-title'][0] : '';
  const tags = [container, work.type].filter(Boolean).slice(0, 5);
  const publishedAt = dateFromParts(work.published) || dateFromParts(work['published-print']) || dateFromParts(work['published-online']);
  const url = (work.URL || (doi ? `https://doi.org/${doi}` : '')).replace('http://', 'https://');

  return normalizePaper({
    id: `crossref-${doi || url}`,
    doi,
    source: 'crossref',
    title: compactText((work.title && work.title[0]) || ''),
    summary: compactText(work.abstract || ''),
    authors: authorNames(work.author),
    publishedAt,
    url,
    absUrl: url,
    pdfUrl: pdf && pdf.URL ? pdf.URL.replace('http://', 'https://') : '',
    codeUrl: '',
    thumbnail: '',
    tags,
    scoreText: work['is-referenced-by-count'] ? `${work['is-referenced-by-count']} citations` : ''
  });
}

async function searchCrossref(query, maxResults) {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${maxResults}&sort=published&order=desc`;
  const data = await requestJson(url);
  const items = data && data.message && data.message.items ? data.message.items : [];
  return items.map(normalizeCrossrefWork).filter((paper) => paper.title);
}

function articleIdValue(block, type) {
  const match = String(block || '').match(new RegExp(`<ArticleId[^>]*IdType=["']${type}["'][^>]*>([\\s\\S]*?)<\\/ArticleId>`, 'i'));
  return match ? compactText(match[1]) : '';
}

function parsePubDate(block) {
  const pubDate = String(block || '').match(/<PubDate>([\s\S]*?)<\/PubDate>/i);
  if (!pubDate) {
    return '';
  }
  const dateBlock = pubDate[1];
  const year = tagValue(dateBlock, 'Year') || String(tagValue(dateBlock, 'MedlineDate')).slice(0, 4);
  if (!year) {
    return '';
  }
  const monthValue = tagValue(dateBlock, 'Month') || '01';
  const monthMap = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  const month = String(monthMap[monthValue] || monthValue || '01').padStart(2, '0');
  const day = String(tagValue(dateBlock, 'Day') || '01').padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parsePubMedArticles(xml) {
  const articles = String(xml || '').match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
  return articles.map((block) => {
    const pmid = tagValue(block, 'PMID');
    const doi = articleIdValue(block, 'doi');
    const pmc = articleIdValue(block, 'pmc');
    const abstractBlocks = block.match(/<AbstractText[^>]*>[\s\S]*?<\/AbstractText>/g) || [];
    const authorBlocks = block.match(/<Author\b[^>]*>[\s\S]*?<\/Author>/g) || [];
    const authors = authorBlocks.map((authorBlock) => {
      const foreName = tagValue(authorBlock, 'ForeName') || tagValue(authorBlock, 'Initials');
      const lastName = tagValue(authorBlock, 'LastName');
      return `${foreName} ${lastName}`.trim();
    }).filter(Boolean);
    const journal = tagValue(block, 'Title');

    return normalizePaper({
      id: `pubmed-${pmid}`,
      doi,
      source: 'pubmed',
      title: compactText(tagValue(block, 'ArticleTitle')),
      summary: abstractBlocks.map(compactText).join('\n\n') || journal,
      authors: authors.join(', '),
      publishedAt: parsePubDate(block),
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      absUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      pdfUrl: pmc ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmc}/pdf/` : '',
      codeUrl: '',
      thumbnail: '',
      tags: [journal].filter(Boolean),
      scoreText: pmc ? 'PMC full text' : ''
    });
  }).filter((paper) => paper.title);
}

async function searchPubMed(query, maxResults) {
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=${maxResults}&sort=pub+date`;
  const data = await requestJson(searchUrl);
  const ids = data && data.esearchresult && data.esearchresult.idlist ? data.esearchresult.idlist : [];
  if (!ids.length) {
    return [];
  }
  const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml`;
  return parsePubMedArticles(await requestText(fetchUrl));
}

function normalizeCoreWork(work) {
  const id = work.id || work.oai || work.doi || work.title;
  const doi = work.doi || '';
  const downloadUrl = work.downloadUrl || work.fullTextIdentifier || '';
  const sourceUrl = work.sourceFulltextUrls && work.sourceFulltextUrls[0] ? work.sourceFulltextUrls[0] : '';
  const url = work.url || sourceUrl || (doi ? `https://doi.org/${doi}` : '');
  const repositories = work.repositories || [];

  return normalizePaper({
    id: `core-${id}`,
    doi,
    source: 'core',
    title: compactText(work.title),
    summary: compactText(work.abstract || work.description || ''),
    authors: authorNames(work.authors),
    publishedAt: work.publishedDate || work.yearPublished || '',
    url,
    absUrl: url,
    pdfUrl: downloadUrl,
    codeUrl: '',
    thumbnail: '',
    tags: repositories.map((repo) => repo.name || repo).filter(Boolean).slice(0, 5),
    scoreText: work.citationCount ? `${work.citationCount} citations` : ''
  });
}

async function searchCore(query, maxResults) {
  const key = process.env.CORE_API_KEY;
  if (!key) {
    throw new Error('Missing CORE_API_KEY');
  }
  const url = `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(query)}&limit=${maxResults}`;
  const data = await requestJson(url, {
    headers: {
      Authorization: `Bearer ${key}`
    }
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

  return normalizePaper({
    id: `semantic-${paper.paperId || doi || arxivId || paper.title}`,
    doi,
    arxivId,
    source: 'semantic',
    title: compactText(paper.title),
    summary: compactText(paper.abstract || ''),
    authors: authorNames(paper.authors),
    publishedAt,
    url,
    absUrl: url,
    pdfUrl: pdf.url || '',
    codeUrl: '',
    thumbnail: '',
    tags: paper.publicationVenue && paper.publicationVenue.name ? [paper.publicationVenue.name] : [],
    scoreText: paper.citationCount ? `${paper.citationCount} citations` : ''
  });
}

async function searchSemanticScholar(query, maxResults) {
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY;
  if (!key) {
    throw new Error('Missing SEMANTIC_SCHOLAR_API_KEY');
  }
  const fields = ['title', 'abstract', 'authors', 'year', 'url', 'openAccessPdf', 'citationCount', 'publicationDate', 'externalIds', 'publicationVenue'].join(',');
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${maxResults}&fields=${fields}`;
  const data = await requestJson(url, {
    headers: {
      'x-api-key': key
    }
  });
  return (data.data || []).map(normalizeSemanticPaper).filter((paper) => paper.title);
}

exports.main = async (event) => {
  const source = event.source;
  const query = compactText(event.query || 'large language models');
  const maxResults = Math.max(1, Math.min(Number(event.maxResults) || 20, 50));

  try {
    let papers = [];
    if (source === 'hf') {
      papers = await searchHuggingFace(maxResults);
    } else if (source === 'arxiv') {
      papers = await searchArxiv(event, maxResults);
    } else if (source === 'openalex') {
      papers = await searchOpenAlex(query, maxResults);
    } else if (source === 'crossref') {
      papers = await searchCrossref(query, maxResults);
    } else if (source === 'pubmed') {
      papers = await searchPubMed(query, maxResults);
    } else if (source === 'core') {
      papers = await searchCore(query, maxResults);
    } else if (source === 'semantic') {
      papers = await searchSemanticScholar(query, maxResults);
    } else {
      throw new Error(`Unsupported source: ${source}`);
    }
    return { ok: true, papers };
  } catch (error) {
    return {
      ok: false,
      papers: [],
      error: error.message
    };
  }
};
