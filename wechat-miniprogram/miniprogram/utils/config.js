module.exports = {
  cloudEnv: '',
  defaultSettings: {
    maxResults: 20,
    useHuggingFace: false,
    useArxiv: true,
    useOpenAlex: true,
    useCrossref: false,
    usePubMed: false,
    useCore: false,
    useSemanticScholar: false,
    literatureQuery: 'large language models',
    arxivQuery: 'abs:LLM OR abs:"AI Agent" OR abs:"Deep Learning"',
    arxivSortBy: 'submittedDate',
    activeProfileId: 'llm_agents',
    profile: {
      id: 'llm_agents',
      name: 'LLM 与 Agent',
      description: '关注大语言模型、AI Agent、RAG、推理、工具调用、训练与部署优化。',
      includeKeywords: [
        'large language model',
        'LLM',
        'AI agent',
        'agentic',
        'RAG',
        'retrieval augmented generation',
        'reasoning',
        'tool use',
        'alignment',
        'inference',
        'serving'
      ],
      mustHaveAny: [
        'LLM',
        'large language model',
        'agent',
        'retrieval augmented generation',
        'reasoning'
      ],
      excludeKeywords: [
        'protein',
        'molecule',
        'wireless',
        'satellite'
      ],
      researchFocus: [
        '方法是否提出新的推理、检索或工具使用机制',
        '是否有可靠实验、消融和开源代码',
        '是否能启发个人论文阅读小程序或科研工作流'
      ],
      minScore: 6,
      ingestMinScore: 2
    }
  },
  sourceTabs: [
    { key: 'all', label: '全部' },
    { key: 'top', label: '推荐' },
    { key: 'hf', label: 'HF' },
    { key: 'arxiv', label: 'ArXiv' },
    { key: 'openalex', label: 'OpenAlex' },
    { key: 'pubmed', label: 'PubMed' },
    { key: 'crossref', label: 'Crossref' },
    { key: 'core', label: 'CORE' },
    { key: 'semantic', label: 'Semantic' }
  ]
};
