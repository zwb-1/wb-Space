const config = require('../../utils/config');
const storage = require('../../utils/storage');
const { splitTerms } = require('../../utils/relevance');

function joinLines(values) {
  return splitTerms(values).join('\n');
}

Page({
  data: {
    settings: storage.getSettings(),
    arxivQueryDraft: '',
    literatureQueryDraft: '',
    profileNameDraft: '',
    profileDescDraft: '',
    includeKeywordsDraft: '',
    mustHaveDraft: '',
    excludeKeywordsDraft: '',
    researchFocusDraft: '',
    cloudReady: false
  },

  onLoad() {
    const app = getApp();
    const settings = storage.getSettings();
    const profile = settings.profile || {};
    this.setData({
      settings,
      arxivQueryDraft: settings.arxivQuery,
      literatureQueryDraft: settings.literatureQuery,
      profileNameDraft: profile.name || '',
      profileDescDraft: profile.description || '',
      includeKeywordsDraft: joinLines(profile.includeKeywords || profile.keywords),
      mustHaveDraft: joinLines(profile.mustHaveAny),
      excludeKeywordsDraft: joinLines(profile.excludeKeywords),
      researchFocusDraft: joinLines(profile.researchFocus),
      cloudReady: !!app.globalData.cloudReady
    });
  },

  onSwitchChange(event) {
    const key = event.currentTarget.dataset.key;
    const settings = storage.saveSettings({ [key]: event.detail.value });
    this.setData({ settings });
  },

  onMaxChange(event) {
    const settings = storage.saveSettings({ maxResults: event.detail.value });
    this.setData({ settings });
  },

  onArxivQueryInput(event) {
    this.setData({ arxivQueryDraft: event.detail.value });
  },

  onLiteratureQueryInput(event) {
    this.setData({ literatureQueryDraft: event.detail.value });
  },

  onProfileInput(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [key]: event.detail.value });
  },

  saveQueries() {
    const settings = storage.saveSettings({
      arxivQuery: this.data.arxivQueryDraft.trim() || config.defaultSettings.arxivQuery,
      literatureQuery: this.data.literatureQueryDraft.trim() || config.defaultSettings.literatureQuery
    });
    this.setData({
      settings,
      arxivQueryDraft: settings.arxivQuery,
      literatureQueryDraft: settings.literatureQuery
    });
    wx.showToast({ title: 'Saved', icon: 'success' });
  },

  resetQueries() {
    const settings = storage.saveSettings({
      arxivQuery: config.defaultSettings.arxivQuery,
      literatureQuery: config.defaultSettings.literatureQuery
    });
    this.setData({
      settings,
      arxivQueryDraft: settings.arxivQuery,
      literatureQueryDraft: settings.literatureQuery
    });
  },

  saveProfile() {
    const oldProfile = this.data.settings.profile || {};
    const profile = Object.assign({}, oldProfile, {
      name: this.data.profileNameDraft.trim() || config.defaultSettings.profile.name,
      description: this.data.profileDescDraft.trim(),
      includeKeywords: splitTerms(this.data.includeKeywordsDraft),
      mustHaveAny: splitTerms(this.data.mustHaveDraft),
      excludeKeywords: splitTerms(this.data.excludeKeywordsDraft),
      researchFocus: splitTerms(this.data.researchFocusDraft)
    });
    const settings = storage.saveSettings({ profile });
    this.setData({ settings });
    wx.showToast({ title: 'Profile saved', icon: 'success' });
  },

  resetProfile() {
    const profile = config.defaultSettings.profile;
    const settings = storage.saveSettings({ profile });
    this.setData({
      settings,
      profileNameDraft: profile.name,
      profileDescDraft: profile.description,
      includeKeywordsDraft: joinLines(profile.includeKeywords),
      mustHaveDraft: joinLines(profile.mustHaveAny),
      excludeKeywordsDraft: joinLines(profile.excludeKeywords),
      researchFocusDraft: joinLines(profile.researchFocus)
    });
  }
});
