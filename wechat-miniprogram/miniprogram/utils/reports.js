const { formatDate } = require('./format');
const { profileFromSettings } = require('./relevance');

function yearOf(paper) {
  const date = new Date(paper.publishedAt || 0);
  if (Number.isNaN(date.getTime())) {
    return String(paper.publishedAt || '').slice(0, 4) || 'unknown';
  }
  return String(date.getFullYear());
}

function topPapers(papers, limit) {
  return papers.slice().sort((a, b) => {
    const scoreDiff = Number(b.relevanceScore || 0) - Number(a.relevanceScore || 0);
    if (scoreDiff) {
      return scoreDiff;
    }
    return new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
  }).slice(0, limit);
}

function sourceStats(papers) {
  const stats = {};
  papers.forEach((paper) => {
    const sources = paper.sources && paper.sources.length ? paper.sources : [paper.source || 'unknown'];
    sources.forEach((source) => {
      stats[source] = (stats[source] || 0) + 1;
    });
  });
  return Object.keys(stats).sort().map((source) => ({ source, count: stats[source] }));
}

function keywordStats(papers) {
  const stats = {};
  papers.forEach((paper) => {
    (paper.keywordHits || []).forEach((keyword) => {
      stats[keyword] = (stats[keyword] || 0) + 1;
    });
  });
  return Object.keys(stats).map((keyword) => ({ keyword, count: stats[keyword] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

function yearlyStats(papers) {
  const stats = {};
  papers.forEach((paper) => {
    const year = yearOf(paper);
    if (!stats[year]) {
      stats[year] = { year, count: 0, recommended: 0 };
    }
    stats[year].count += 1;
    if (paper.isRecommended) {
      stats[year].recommended += 1;
    }
  });
  return Object.keys(stats).sort().reverse().map((year) => stats[year]);
}

function buildDailyMarkdown(papers, settings) {
  const profile = profileFromSettings(settings);
  const today = formatDate(new Date());
  const recommended = topPapers(papers.filter((paper) => paper.isRecommended), 12);
  const lines = [
    `# ${today} 论文日报`,
    '',
    `方向：${profile.name}`,
    `本地文献库：${papers.length} 篇；推荐：${recommended.length} 篇`,
    '',
    '## 今日推荐'
  ];

  if (!recommended.length) {
    lines.push('', '暂无高分推荐，可放宽关键词或先刷新更多来源。');
  }

  recommended.forEach((paper, index) => {
    lines.push(
      '',
      `### ${index + 1}. ${paper.title}`,
      `- 来源：${paper.sourceLabel || paper.source}`,
      `- 日期：${paper.dateText || formatDate(paper.publishedAt)}`,
      `- 评分：${paper.rating || 1}★ / ${paper.relevanceScore || 0}`,
      `- 命中：${(paper.keywordHits || []).join(', ') || '无'}`,
      `- 链接：${paper.url || paper.absUrl || ''}`,
      `- 摘要：${paper.shortSummary || paper.summary || ''}`
    );
  });

  return lines.join('\n');
}

function buildAnnualMarkdown(papers, settings) {
  const profile = profileFromSettings(settings);
  const years = yearlyStats(papers);
  const keywords = keywordStats(papers);
  const top = topPapers(papers, 15);
  const lines = [
    `# ${profile.name} 年度文献概览`,
    '',
    `文献总数：${papers.length}`,
    '',
    '## 年份分布'
  ];

  years.forEach((item) => {
    lines.push(`- ${item.year}: ${item.count} 篇，推荐 ${item.recommended} 篇`);
  });

  lines.push('', '## 高频方向');
  keywords.forEach((item) => {
    lines.push(`- ${item.keyword}: ${item.count}`);
  });

  lines.push('', '## 高分论文');
  top.forEach((paper, index) => {
    lines.push(`${index + 1}. ${paper.title} (${paper.relevanceScore || 0})`);
  });

  return lines.join('\n');
}

function buildRoadmap(papers, settings) {
  const profile = profileFromSettings(settings);
  const branches = profile.includeKeywords.slice(0, 8).map((keyword) => {
    const related = topPapers(papers.filter((paper) => {
      const hits = paper.keywordHits || [];
      return hits.indexOf(keyword) >= 0 || String(paper.title || '').toLowerCase().indexOf(keyword.toLowerCase()) >= 0;
    }), 4);
    return {
      keyword,
      count: related.length,
      papers: related
    };
  }).filter((branch) => branch.count > 0);

  return {
    profile,
    branches,
    nextSteps: [
      '优先精读 4-5 星论文，记录方法、实验和可复现线索。',
      '对高频关键词分支补充综述或经典论文。',
      '把收藏论文按问题、方法、数据集三类重新归档。'
    ]
  };
}

function buildRoadmapMarkdown(papers, settings) {
  const roadmap = buildRoadmap(papers, settings);
  const lines = [
    `# ${roadmap.profile.name} 研究方向地图`,
    '',
    roadmap.profile.description || '',
    '',
    '## 分支'
  ];

  roadmap.branches.forEach((branch) => {
    lines.push('', `### ${branch.keyword}`);
    branch.papers.forEach((paper, index) => {
      lines.push(`${index + 1}. ${paper.title} (${paper.relevanceScore || 0})`);
    });
  });

  lines.push('', '## 下一步');
  roadmap.nextSteps.forEach((step) => {
    lines.push(`- ${step}`);
  });

  return lines.join('\n');
}

module.exports = {
  buildAnnualMarkdown,
  buildDailyMarkdown,
  buildRoadmap,
  buildRoadmapMarkdown,
  keywordStats,
  sourceStats,
  topPapers,
  yearlyStats
};
