const config = require('../../utils/config');
const {
  SOURCE_LABELS,
  fetchArxivPapers,
  fetchCloudPapers,
  fetchCrossrefPapers,
  fetchHuggingFaceDaily,
  fetchOpenAlexPapers,
  fetchPubMedPapers,
  sortPapers
} = require('../../utils/papers');
const storage = require('../../utils/storage');
const { formatDate } = require('../../utils/format');
const { decorateWithRelevance, dedupePapers } = require('../../utils/relevance');

Page({
  data: {
    papers: [],
    filteredPapers: [],
    activeSource: 'all',
    sources: config.sourceTabs,
    keyword: '',
    loading: false,
    error: '',
    lastUpdated: '',
    remoteKeyword: ''
  },

  onLoad() {
    this.refresh();
  },

  onShow() {
    this.applyMarks();
  },

  refresh() {
    const settings = storage.getSettings();
    const keyword = this.data.keyword.trim();
    const runtimeSettings = Object.assign({}, settings);
    if (keyword) {
      runtimeSettings.literatureQuery = keyword;
      runtimeSettings.arxivQuery = `all:"${keyword.replace(/"/g, '\\"')}"`;
    }
    const tasks = [];
    const sourceTask = (source, directTask) => fetchCloudPapers(source, runtimeSettings).catch((cloudError) => (
      directTask().catch((directError) => {
        const label = SOURCE_LABELS[source] || source;
        const cloudMessage = cloudError && cloudError.message ? cloudError.message : 'cloud failed';
        const directMessage = directError && (directError.message || directError.errMsg) ? (directError.message || directError.errMsg) : 'request failed';
        throw new Error(`${label}: ${cloudMessage}; ${directMessage}`);
      })
    ));

    if (runtimeSettings.useHuggingFace) {
      tasks.push(sourceTask('hf', () => fetchHuggingFaceDaily(runtimeSettings.maxResults)));
    }
    if (runtimeSettings.useArxiv) {
      tasks.push(sourceTask('arxiv', () => fetchArxivPapers(runtimeSettings)));
    }
    if (runtimeSettings.useOpenAlex) {
      tasks.push(sourceTask('openalex', () => fetchOpenAlexPapers(runtimeSettings)));
    }
    if (runtimeSettings.useCrossref) {
      tasks.push(sourceTask('crossref', () => fetchCrossrefPapers(runtimeSettings)));
    }
    if (runtimeSettings.usePubMed) {
      tasks.push(sourceTask('pubmed', () => fetchPubMedPapers(runtimeSettings)));
    }
    if (runtimeSettings.useCore) {
      tasks.push(fetchCloudPapers('core', runtimeSettings));
    }
    if (runtimeSettings.useSemanticScholar) {
      tasks.push(fetchCloudPapers('semantic', runtimeSettings));
    }

    if (!tasks.length) {
      this.setData({ papers: [], filteredPapers: [], error: '请在设置中至少打开一个论文来源' });
      return;
    }

    this.setData({ loading: true, error: '' });
    const settledTasks = tasks.map((task) => task.then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason })
    ));

    Promise.all(settledTasks)
      .then((results) => {
        const papers = [];
        const errors = [];
        results.forEach((result) => {
          if (result.status === 'fulfilled') {
            papers.push.apply(papers, result.value);
          } else {
            errors.push(result.reason && result.reason.message ? result.reason.message : '请求失败');
          }
        });

        const enriched = decorateWithRelevance(sortPapers(dedupePapers(papers)), runtimeSettings);
        storage.mergeLibrary(enriched);

        this.setData({
          papers: this.decoratePapers(enriched),
          lastUpdated: formatDate(new Date()),
          remoteKeyword: keyword,
          error: errors.length ? `部分来源刷新失败：${errors.join('；')}` : ''
        });
        this.applyFilters();
      })
      .catch((error) => {
        this.setData({ error: error.message || '刷新失败' });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  decoratePapers(papers) {
    const favoriteMap = storage.getFavoriteMap();
    const readMap = storage.getReadMap();
    return papers.map((paper) => Object.assign({}, paper, {
      favorite: !!favoriteMap[paper.id],
      read: !!readMap[paper.id]
    }));
  },

  applyMarks() {
    if (!this.data.papers.length) {
      return;
    }
    this.setData({ papers: this.decoratePapers(this.data.papers) });
    this.applyFilters();
  },

  applyFilters() {
    const source = this.data.activeSource;
    const keyword = this.data.keyword.trim().toLowerCase();
    const shouldFilterKeyword = keyword && keyword !== this.data.remoteKeyword.trim().toLowerCase();
    const filtered = this.data.papers.filter((paper) => {
      const sourceMatch = source === 'all'
        || (source === 'top' && paper.isRecommended)
        || paper.source === source
        || (paper.sources || []).indexOf(source) >= 0;
      const haystack = `${paper.title} ${paper.summary} ${paper.authors} ${(paper.tags || []).join(' ')}`.toLowerCase();
      const keywordMatch = !shouldFilterKeyword || haystack.indexOf(keyword) >= 0;
      return sourceMatch && keywordMatch;
    });
    this.setData({ filteredPapers: filtered });
  },

  changeSource(event) {
    this.setData({ activeSource: event.currentTarget.dataset.source });
    this.applyFilters();
  },

  onSearchInput(event) {
    this.setData({ keyword: event.detail.value });
    this.applyFilters();
  },

  clearSearch() {
    this.setData({ keyword: '' });
    this.applyFilters();
  },

  openPaper(event) {
    const id = event.currentTarget.dataset.id;
    const paper = this.data.papers.find((item) => item.id === id);
    if (!paper) {
      return;
    }
    storage.markRead(id);
    storage.setCurrentPaper(paper);
    wx.navigateTo({ url: '/pages/detail/detail' });
  },

  toggleFavorite(event) {
    const id = event.currentTarget.dataset.id;
    const paper = this.data.papers.find((item) => item.id === id);
    if (!paper) {
      return;
    }
    storage.toggleFavorite(paper);
    this.applyMarks();
  },

  goFavorites() {
    wx.navigateTo({ url: '/pages/favorites/favorites' });
  },

  goReports() {
    wx.navigateTo({ url: '/pages/reports/reports' });
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  }
});
