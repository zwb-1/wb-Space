const storage = require('../../utils/storage');
const {
  buildAnnualMarkdown,
  buildDailyMarkdown,
  buildRoadmap,
  buildRoadmapMarkdown,
  keywordStats,
  sourceStats,
  topPapers,
  yearlyStats
} = require('../../utils/reports');

Page({
  data: {
    library: [],
    top: [],
    years: [],
    sources: [],
    keywords: [],
    roadmap: null,
    activeReport: 'daily',
    markdown: ''
  },

  onShow() {
    this.load();
  },

  load() {
    const settings = storage.getSettings();
    const library = storage.getLibrary();
    const roadmap = buildRoadmap(library, settings);
    const markdown = this.reportMarkdown(this.data.activeReport, library, settings);

    this.setData({
      library,
      top: topPapers(library, 8),
      years: yearlyStats(library),
      sources: sourceStats(library),
      keywords: keywordStats(library),
      roadmap,
      markdown
    });
  },

  switchReport(event) {
    const report = event.currentTarget.dataset.report;
    const settings = storage.getSettings();
    const library = this.data.library;
    const markdown = this.reportMarkdown(report, library, settings);
    this.setData({ activeReport: report, markdown });
  },

  reportMarkdown(report, library, settings) {
    if (report === 'annual') {
      return buildAnnualMarkdown(library, settings);
    }
    if (report === 'roadmap') {
      return buildRoadmapMarkdown(library, settings);
    }
    return buildDailyMarkdown(library, settings);
  },

  copyMarkdown() {
    wx.setClipboardData({
      data: this.data.markdown,
      success() {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  },

  openPaper(event) {
    const id = event.currentTarget.dataset.id;
    const paper = this.data.library.find((item) => item.id === id);
    if (!paper) {
      return;
    }
    storage.setCurrentPaper(paper);
    wx.navigateTo({ url: '/pages/detail/detail' });
  }
});
