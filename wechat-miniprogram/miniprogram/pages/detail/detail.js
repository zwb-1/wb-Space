const storage = require('../../utils/storage');

function offlineAnalysis(paper) {
  return [
    '【快速抓要点】',
    `${paper.title} 关注的问题可以先从摘要中的任务、方法和结果三层阅读。当前为离线速读，适合在未配置 DeepSeek 云函数时先建立阅读入口。`,
    '',
    '【逻辑推导】',
    `背景：${paper.summary.slice(0, 120)}${paper.summary.length > 120 ? '...' : ''}`,
    '破局：优先定位作者提出的新表示、新训练目标、新数据流程或新评测设置。',
    '拆解：1. 看研究动机；2. 找核心方法；3. 对照实验结果；4. 记录局限与可复现线索。',
    '',
    '【技术细节】',
    '请在论文方法与实验部分重点标记模型结构、损失函数、数据集、评测指标和消融实验。',
    '',
    '【局限性】',
    '离线模式无法替代阅读全文，建议结合 PDF 中的 limitation、appendix 和实验设置确认。',
    '',
    '【专业知识解释】',
    '配置 DeepSeek 云函数后，这里会生成更具体的中文术语解释。'
  ].join('\n');
}

Page({
  data: {
    paper: null,
    favorite: false,
    analysis: '',
    analyzing: false
  },

  onLoad() {
    const paper = storage.getCurrentPaper();
    if (!paper) {
      return;
    }
    storage.markRead(paper.id);
    this.setData({
      paper,
      favorite: storage.isFavorite(paper.id),
      analysis: storage.getAnalysis(paper.id)
    });
  },

  analyze() {
    const paper = this.data.paper;
    if (!paper || this.data.analyzing) {
      return;
    }

    this.setData({ analyzing: true });
    const app = getApp();
    if (!app.globalData.cloudReady || !wx.cloud) {
      const analysis = offlineAnalysis(paper);
      storage.saveAnalysis(paper.id, analysis);
      this.setData({ analysis, analyzing: false });
      return;
    }

    wx.cloud.callFunction({
      name: 'analyzePaper',
      data: {
        paper,
        profile: storage.getSettings().profile
      },
      success: (res) => {
        const result = res.result || {};
        const analysis = result.analysis || offlineAnalysis(paper);
        const nextPaper = Object.assign({}, paper);
        if (result.codeUrl && !nextPaper.codeUrl) {
          nextPaper.codeUrl = result.codeUrl;
          storage.setCurrentPaper(nextPaper);
        }
        storage.saveAnalysis(paper.id, analysis);
        this.setData({ paper: nextPaper, analysis });
      },
      fail: () => {
        const analysis = offlineAnalysis(paper);
        storage.saveAnalysis(paper.id, analysis);
        this.setData({ analysis });
      },
      complete: () => {
        this.setData({ analyzing: false });
      }
    });
  },

  toggleFavorite() {
    const next = storage.toggleFavorite(this.data.paper);
    this.setData({ favorite: next });
  },

  copyLink(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) {
      return;
    }
    wx.setClipboardData({
      data: url,
      success() {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  }
});
