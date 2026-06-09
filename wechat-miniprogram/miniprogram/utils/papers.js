const { arxivIdFromUrl, compactText, decodeEntities, formatDate, truncate } = require('./format');

const SOURCE_LABELS = {
  hf: 'HF Daily',
  arxiv: 'ArXiv',
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  pubmed: 'PubMed',
  core: 'CORE',
  semantic: 'Semantic Scholar'
};

function request(options) {
  return new Promise((resolve, reject) => {
    wx.request(Object.assign({}, options, {
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(new Error(`HTTP ${res.statusCode}`));
      },
      fail(error) {
        reject(new Error(error && error.errMsg ? error.errMsg : 'request failed'));
      }
    }));
  });
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
    if (author.author && author.author.display_name) {
      return author.author.display_name;
    }
    return '';
  }).filter(Boolean).join(', ');
}

function stripHtml(value) {
  return compactText(String(value || '').replace(/<[^>]+>/g, ' '));
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

function abstractFromInvertedIndex(index) {
  if (!index) {
    return '';
  }
  const words = [];
  Object.keys(index).forEach((word) => {
    const positions = index[word] || [];
    positions.forEach((position) => {
      words[position] = word;
    });
  });
  return compactText(words.join(' '));
}

function normalizePaper(paper) {
  const summary = compactText(paper.summary || '');
  return Object.assign({}, paper, {
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
    sourceLabel: SOURCE_LABELS.hf,
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

function fetchHuggingFaceDaily(maxResults) {
  return request({
    url: 'https://huggingface.co/api/daily_papers',
    method: 'GET'
  }).then((items) => {
    if (!Array.isArray(items)) {
      return [];
    }
    return items.slice(0, maxResults).map(normalizeHuggingFaceItem);
  });
}

function tagValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? compactText(match[1]) : '';
}

function attrValue(attrs, name) {
  const match = attrs.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'));
  return match ? decodeEntities(match[1]) : '';
}

function parseArxivEntries(xml) {
  const entries = String(xml || '').match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map((block) => {
    const idUrl = tagValue(block, 'id');
    const arxivId = arxivIdFromUrl(idUrl);
    const title = tagValue(block, 'title');
    const summary = tagValue(block, 'summary');
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
      sourceLabel: SOURCE_LABELS.arxiv,
      title,
      summary,
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

function fetchArxivPapers(settings) {
  const query = encodeURIComponent(settings.arxivQuery);
  const maxResults = settings.maxResults || 20;
  const sortBy = encodeURIComponent(settings.arxivSortBy || 'submittedDate');
  const url = `https://export.arxiv.org/api/query?search_query=${query}&start=0&max_results=${maxResults}&sortBy=${sortBy}&sortOrder=descending`;

  return request({
    url,
    method: 'GET'
  }).then(parseArxivEntries);
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
    sourceLabel: SOURCE_LABELS.openalex,
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

function fetchOpenAlexPapers(settings) {
  const query = encodeURIComponent(settings.literatureQuery || settings.arxivQuery || 'large language models');
  const maxResults = settings.maxResults || 20;
  const url = `https://api.openalex.org/works?search=${query}&per-page=${maxResults}&sort=publication_date:desc`;

  return request({
    url,
    method: 'GET'
  }).then((data) => {
    const results = data && data.results ? data.results : [];
    return results.map(normalizeOpenAlexWork);
  });
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
    sourceLabel: SOURCE_LABELS.crossref,
    title: compactText((work.title && work.title[0]) || ''),
    summary: stripHtml(work.abstract || ''),
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

function fetchCrossrefPapers(settings) {
  const query = encodeURIComponent(settings.literatureQuery || 'large language models');
  const maxResults = settings.maxResults || 20;
  const url = `https://api.crossref.org/works?query=${query}&rows=${maxResults}&sort=published&order=desc`;

  return request({
    url,
    method: 'GET'
  }).then((data) => {
    const items = data && data.message && data.message.items ? data.message.items : [];
    return items.map(normalizeCrossrefWork).filter((paper) => paper.title);
  });
}

function articleIdValue(block, type) {
  const match = block.match(new RegExp(`<ArticleId[^>]*IdType=["']${type}["'][^>]*>([\\s\\S]*?)<\\/ArticleId>`, 'i'));
  return match ? compactText(match[1]) : '';
}

function parsePubDate(block) {
  const pubDate = block.match(/<PubDate>([\s\S]*?)<\/PubDate>/i);
  if (!pubDate) {
    return '';
  }
  const dateBlock = pubDate[1];
  const year = tagValue(dateBlock, 'Year') || String(tagValue(dateBlock, 'MedlineDate')).slice(0, 4);
  if (!year) {
    return '';
  }
  const monthValue = tagValue(dateBlock, 'Month') || '01';
  const day = String(tagValue(dateBlock, 'Day') || '01').padStart(2, '0');
  const monthMap = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12'
  };
  const month = String(monthMap[monthValue] || monthValue || '01').padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parsePubMedArticles(xml) {
  const articles = String(xml || '').match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
  return articles.map((block) => {
    const pmid = tagValue(block, 'PMID');
    const doi = articleIdValue(block, 'doi');
    const pmc = articleIdValue(block, 'pmc');
    const title = stripHtml(tagValue(block, 'ArticleTitle'));
    const abstractBlocks = block.match(/<AbstractText[^>]*>[\s\S]*?<\/AbstractText>/g) || [];
    const summary = abstractBlocks.map(stripHtml).join('\n\n');
    const authorBlocks = block.match(/<Author\b[^>]*>[\s\S]*?<\/Author>/g) || [];
    const authors = authorBlocks.map((authorBlock) => {
      const foreName = tagValue(authorBlock, 'ForeName') || tagValue(authorBlock, 'Initials');
      const lastName = tagValue(authorBlock, 'LastName');
      return `${foreName} ${lastName}`.trim();
    }).filter(Boolean);
    const journal = tagValue(block, 'Title');
    const tags = [journal].filter(Boolean);

    return normalizePaper({
      id: `pubmed-${pmid}`,
      doi,
      source: 'pubmed',
      sourceLabel: SOURCE_LABELS.pubmed,
      title,
      summary: summary || journal,
      authors: authors.join(', '),
      publishedAt: parsePubDate(block),
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      absUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      pdfUrl: pmc ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmc}/pdf/` : '',
      codeUrl: '',
      thumbnail: '',
      tags,
      scoreText: pmc ? 'PMC full text' : ''
    });
  }).filter((paper) => paper.title);
}

function fetchPubMedPapers(settings) {
  const query = encodeURIComponent(settings.literatureQuery || 'large language models');
  const maxResults = settings.maxResults || 20;
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${query}&retmode=json&retmax=${maxResults}&sort=pub+date`;

  return request({
    url: searchUrl,
    method: 'GET'
  }).then((data) => {
    const ids = data && data.esearchresult && data.esearchresult.idlist ? data.esearchresult.idlist : [];
    if (!ids.length) {
      return [];
    }
    const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml`;
    return request({
      url: fetchUrl,
      method: 'GET'
    }).then(parsePubMedArticles);
  });
}

function fetchCloudPapers(source, settings) {
  const app = getApp();
  if (!wx.cloud || !app.globalData.cloudReady) {
    return Promise.reject(new Error(`${SOURCE_LABELS[source]} needs cloud function searchPapers`));
  }

  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'searchPapers',
      data: {
        source,
        query: settings.literatureQuery || 'large language models',
        arxivQuery: settings.arxivQuery,
        arxivSortBy: settings.arxivSortBy,
        maxResults: settings.maxResults || 20
      },
      success(res) {
        const result = res.result || {};
        if (!result.ok) {
          reject(new Error(result.error || `${SOURCE_LABELS[source]} failed`));
          return;
        }
        resolve((result.papers || []).map(normalizePaper));
      },
      fail(error) {
        reject(error);
      }
    });
  });
}

function sortPapers(papers) {
  return papers.slice().sort((a, b) => {
    const left = new Date(a.publishedAt || 0).getTime();
    const right = new Date(b.publishedAt || 0).getTime();
    return right - left;
  });
}

module.exports = {
  SOURCE_LABELS,
  fetchArxivPapers,
  fetchCloudPapers,
  fetchCrossrefPapers,
  fetchHuggingFaceDaily,
  fetchOpenAlexPapers,
  fetchPubMedPapers,
  sortPapers
};
