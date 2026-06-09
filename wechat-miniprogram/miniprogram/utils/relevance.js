const { compactText } = require('./format');

function normalize(value) {
  return compactText(value).toLowerCase();
}

function splitTerms(value) {
  if (Array.isArray(value)) {
    return value.map(compactText).filter(Boolean);
  }
  return String(value || '')
    .split(/\r?\n|[,，;]/)
    .map(compactText)
    .filter(Boolean);
}

function profileFromSettings(settings) {
  const profile = settings.profile || {};
  return {
    id: profile.id || settings.activeProfileId || 'default',
    name: profile.name || '默认方向',
    description: profile.description || '',
    includeKeywords: splitTerms(profile.includeKeywords || profile.keywords),
    mustHaveAny: splitTerms(profile.mustHaveAny),
    excludeKeywords: splitTerms(profile.excludeKeywords),
    researchFocus: splitTerms(profile.researchFocus),
    minScore: Number(profile.minScore || 6),
    ingestMinScore: Number(profile.ingestMinScore || 2)
  };
}

function termHits(text, terms) {
  const haystack = normalize(text);
  return terms.filter((term) => haystack.indexOf(normalize(term)) >= 0);
}

function scorePaper(paper, settings) {
  const profile = profileFromSettings(settings);
  const title = paper.title || '';
  const summary = paper.summary || '';
  const tags = (paper.tags || []).join(' ');
  const titleHits = termHits(title, profile.includeKeywords);
  const summaryHits = termHits(`${summary} ${tags}`, profile.includeKeywords);
  const mustHits = termHits(`${title} ${summary} ${tags}`, profile.mustHaveAny);
  const excludeHits = termHits(`${title} ${summary} ${tags}`, profile.excludeKeywords);
  const sourceBonus = paper.source === 'hf' ? 1 : 0;
  const citationBonus = paper.scoreText && /citation/.test(paper.scoreText) ? 1 : 0;

  let score = titleHits.length * 3 + summaryHits.length + mustHits.length * 2 + sourceBonus + citationBonus - excludeHits.length * 5;
  if (profile.mustHaveAny.length && !mustHits.length) {
    score -= 2;
  }
  score = Math.max(0, Math.min(30, score));

  let level = 'low';
  if (score >= 18) {
    level = 'high';
  } else if (score >= 10) {
    level = 'medium';
  }

  return {
    profileId: profile.id,
    profileName: profile.name,
    score,
    level,
    rating: Math.max(1, Math.min(5, Math.ceil(score / 6))),
    keywordHits: Array.from(new Set([].concat(titleHits, summaryHits, mustHits))).slice(0, 8),
    excludeHits,
    isRecommended: score >= profile.minScore,
    isLowTier: score >= profile.ingestMinScore && score < profile.minScore
  };
}

function normalizeTitleKey(title) {
  return normalize(title).replace(/[^a-z0-9]+/g, ' ').trim();
}

function paperKey(paper) {
  if (paper.doi) {
    return `doi:${normalize(paper.doi).replace(/^https?:\/\/doi\.org\//, '')}`;
  }
  if (paper.arxivId) {
    return `arxiv:${normalize(paper.arxivId).replace(/v\d+$/, '')}`;
  }
  return `title:${normalizeTitleKey(paper.title)}`;
}

function mergePaper(base, incoming) {
  const next = Object.assign({}, base, incoming);
  next.sources = Array.from(new Set([].concat(base.sources || base.source || [], incoming.sources || incoming.source || []).filter(Boolean)));
  next.sourceLabel = next.sources.length > 1 ? next.sources.join(' + ') : (incoming.sourceLabel || base.sourceLabel);
  next.summary = incoming.summary && incoming.summary.length > (base.summary || '').length ? incoming.summary : base.summary || incoming.summary;
  next.pdfUrl = base.pdfUrl || incoming.pdfUrl;
  next.codeUrl = base.codeUrl || incoming.codeUrl;
  next.url = base.url || incoming.url;
  next.tags = Array.from(new Set([].concat(base.tags || [], incoming.tags || []))).slice(0, 8);
  return next;
}

function dedupePapers(papers) {
  const map = {};
  const ordered = [];
  papers.forEach((paper) => {
    const key = paperKey(paper);
    if (!map[key]) {
      map[key] = Object.assign({}, paper, { dedupeKey: key, sources: [paper.source] });
      ordered.push(map[key]);
      return;
    }
    map[key] = mergePaper(map[key], paper);
    const index = ordered.findIndex((item) => item.dedupeKey === key);
    if (index >= 0) {
      ordered[index] = map[key];
    }
  });
  return ordered;
}

function decorateWithRelevance(papers, settings) {
  return papers.map((paper) => {
    const relevance = scorePaper(paper, settings);
    return Object.assign({}, paper, {
      relevance,
      relevanceScore: relevance.score,
      rating: relevance.rating,
      keywordHits: relevance.keywordHits,
      level: relevance.level,
      isRecommended: relevance.isRecommended
    });
  });
}

module.exports = {
  decorateWithRelevance,
  dedupePapers,
  paperKey,
  profileFromSettings,
  scorePaper,
  splitTerms
};
