const config = require('./config');

const KEYS = {
  settings: 'paper_reader_settings',
  favorites: 'paper_reader_favorites',
  read: 'paper_reader_read',
  analyses: 'paper_reader_analyses',
  currentPaper: 'paper_reader_current_paper',
  library: 'paper_reader_library'
};

function readObject(key, fallback) {
  const value = wx.getStorageSync(key);
  if (!value) {
    return fallback;
  }
  return value;
}

function getSettings() {
  return Object.assign({}, config.defaultSettings, readObject(KEYS.settings, {}));
}

function saveSettings(settings) {
  const next = Object.assign({}, getSettings(), settings);
  wx.setStorageSync(KEYS.settings, next);
  return next;
}

function getFavorites() {
  return readObject(KEYS.favorites, []);
}

function getFavoriteMap() {
  return getFavorites().reduce((map, item) => {
    map[item.id] = true;
    return map;
  }, {});
}

function isFavorite(id) {
  return !!getFavoriteMap()[id];
}

function toggleFavorite(paper) {
  const favorites = getFavorites();
  const index = favorites.findIndex((item) => item.id === paper.id);
  if (index >= 0) {
    favorites.splice(index, 1);
    wx.setStorageSync(KEYS.favorites, favorites);
    return false;
  }
  favorites.unshift(Object.assign({}, paper, { savedAt: Date.now() }));
  wx.setStorageSync(KEYS.favorites, favorites);
  return true;
}

function clearFavorites() {
  wx.setStorageSync(KEYS.favorites, []);
}

function getReadMap() {
  return readObject(KEYS.read, {});
}

function markRead(id) {
  const read = getReadMap();
  read[id] = Date.now();
  wx.setStorageSync(KEYS.read, read);
}

function getAnalysis(id) {
  return readObject(KEYS.analyses, {})[id] || '';
}

function getLibrary() {
  return readObject(KEYS.library, []);
}

function saveLibrary(papers) {
  wx.setStorageSync(KEYS.library, papers || []);
}

function mergeLibrary(papers) {
  const byId = {};
  getLibrary().forEach((paper) => {
    byId[paper.id] = paper;
  });
  (papers || []).forEach((paper) => {
    byId[paper.id] = Object.assign({}, byId[paper.id] || {}, paper, { archivedAt: byId[paper.id] && byId[paper.id].archivedAt || Date.now() });
  });
  const next = Object.keys(byId).map((id) => byId[id]).sort((a, b) => {
    const left = new Date(a.publishedAt || 0).getTime();
    const right = new Date(b.publishedAt || 0).getTime();
    return right - left;
  }).slice(0, 500);
  saveLibrary(next);
  return next;
}

function saveAnalysis(id, analysis) {
  const analyses = readObject(KEYS.analyses, {});
  analyses[id] = analysis;
  wx.setStorageSync(KEYS.analyses, analyses);
}

function setCurrentPaper(paper) {
  wx.setStorageSync(KEYS.currentPaper, paper);
}

function getCurrentPaper() {
  return wx.getStorageSync(KEYS.currentPaper);
}

module.exports = {
  clearFavorites,
  getAnalysis,
  getFavoriteMap,
  getFavorites,
  getLibrary,
  getReadMap,
  getSettings,
  getCurrentPaper,
  isFavorite,
  markRead,
  mergeLibrary,
  saveAnalysis,
  saveLibrary,
  saveSettings,
  setCurrentPaper,
  toggleFavorite
};
