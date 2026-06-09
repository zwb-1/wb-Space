const storage = require('../../utils/storage');

Page({
  data: {
    favorites: []
  },

  onShow() {
    this.loadFavorites();
  },

  loadFavorites() {
    this.setData({ favorites: storage.getFavorites() });
  },

  openPaper(event) {
    const id = event.currentTarget.dataset.id;
    const paper = this.data.favorites.find((item) => item.id === id);
    if (!paper) {
      return;
    }
    storage.markRead(id);
    storage.setCurrentPaper(paper);
    wx.navigateTo({ url: '/pages/detail/detail' });
  },

  removeFavorite(event) {
    const id = event.currentTarget.dataset.id;
    const paper = this.data.favorites.find((item) => item.id === id);
    if (!paper) {
      return;
    }
    storage.toggleFavorite(paper);
    this.loadFavorites();
  },

  clearAll() {
    wx.showModal({
      title: '清空收藏',
      content: '确认清空全部收藏？',
      success: (res) => {
        if (res.confirm) {
          storage.clearFavorites();
          this.loadFavorites();
        }
      }
    });
  }
});
