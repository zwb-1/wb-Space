const https = require('https');

const DEFAULT_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';
const PWC_BASE_URL = 'https://arxiv.paperswithcode.com/api/v0/papers/';

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = options.body ? JSON.stringify(options.body) : '';
    const req = https.request({
      hostname: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      method: options.method || 'GET',
      headers: Object.assign({
        'Content-Type': 'application/json'
      }, options.headers || {}, body ? { 'Content-Length': Buffer.byteLength(body) } : {})
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 180)}`));
          return;
        }
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function arxivIdFromPaper(paper) {
  const text = `${paper.arxivId || ''} ${paper.url || ''} ${paper.absUrl || ''}`;
  const match = text.match(/(\d{4}\.\d{4,5})(v\d+)?/);
  return match ? match[1] : '';
}

async function getCodeLink(arxivId) {
  if (!arxivId) {
    return '';
  }
  try {
    const data = await requestJson(`${PWC_BASE_URL}${arxivId}`);
    return data && data.official && data.official.url ? data.official.url : '';
  } catch (error) {
    return '';
  }
}

function fallbackAnalysis(paper) {
  const summary = String(paper.summary || '').replace(/\s+/g, ' ').trim();
  return [
    '【快速抓要点】',
    `${paper.title} 需要重点看它解决的问题、提出的方法和摘要中给出的实验结论。`,
    '',
    '【逻辑推导】',
    `背景：${summary.slice(0, 140)}${summary.length > 140 ? '...' : ''}`,
    '破局：从标题和摘要中定位作者的新方法、新数据、新训练目标或新评测方式。',
    '拆解：1. 标出任务；2. 找核心模块；3. 对照 baseline；4. 看消融实验；5. 记录可复现线索。',
    '',
    '【技术细节】',
    '建议优先核对模型结构、损失函数、数据集规模、评价指标和代码/项目页。',
    '',
    '【局限性】',
    '当前为离线结果，请结合论文的 limitation、appendix 和实验设置进一步确认。',
    '',
    '【专业知识解释】',
    '配置 DEEPSEEK_API_KEY 后会生成更贴近论文内容的术语解释。'
  ].join('\n');
}

function buildPrompt(paper, profile = {}) {
  const focus = Array.isArray(profile.researchFocus) ? profile.researchFocus.join('；') : '';
  const keywords = Array.isArray(profile.includeKeywords) ? profile.includeKeywords.join('，') : '';
  return `你是一个学术论文分析专家。请根据下面论文的标题和摘要，生成中文深度解读。

论文标题：${paper.title}
论文摘要：${paper.summary}
论文来源：${paper.sourceLabel || paper.source || ''}
我的研究方向：${profile.name || ''}
我的关键词：${keywords}
我的关注重点：${focus}

请严格按以下结构输出：

【快速抓要点】
用简洁语言说明这项研究解决什么问题、提出什么方法、得到什么结论。

【逻辑推导】
不要堆砌技术细节，还原作者思路：
背景：为什么这个问题之前不好解决？
破局：作者的核心直觉是什么？
拆解：方法从输入到输出分几步实现，用 1、2、3 列出。

【技术细节】
补充论文中最关键的 1-2 个技术实现细节，例如训练目标、模型结构、数据处理、推理流程或评测方式。

【局限性】
指出潜在不足或需要继续验证的地方。

【专业知识解释】
解释摘要中最重要的 2-4 个专业术语，面向有 AI 基础但还没读过这篇论文的读者。`;
}

async function deepSeekAnalysis(paper, profile) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return fallbackAnalysis(paper);
  }

  const data = await requestJson(process.env.DEEPSEEK_API_URL || DEFAULT_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: {
      model: process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
      messages: [
        {
          role: 'system',
          content: '你是一个学术分析专家，擅长把复杂的人工智能论文总结得清晰、准确、可行动。'
        },
        {
          role: 'user',
          content: buildPrompt(paper, profile)
        }
      ],
      temperature: 0.2,
      stream: false
    }
  });

  if (data.error) {
    throw new Error(data.error.message || 'DeepSeek API error');
  }

  return data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : fallbackAnalysis(paper);
}

exports.main = async (event) => {
  const paper = event.paper || {};
  const profile = event.profile || {};
  const arxivId = arxivIdFromPaper(paper);
  const codeUrl = paper.codeUrl || await getCodeLink(arxivId);

  try {
    const analysis = await deepSeekAnalysis(paper, profile);
    return {
      ok: true,
      analysis,
      codeUrl
    };
  } catch (error) {
    return {
      ok: false,
      analysis: fallbackAnalysis(paper),
      codeUrl,
      error: error.message
    };
  }
};
