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
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
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
  const text = String(value || '');
  const match = text.match(/(\d{4}\.\d{4,5})(v\d+)?/);
  return match ? match[1] : text;
}

module.exports = {
  arxivIdFromUrl,
  compactText,
  decodeEntities,
  formatDate,
  truncate
};
