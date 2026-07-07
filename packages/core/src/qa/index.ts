/**
 * qa 模块入口：Wiki 问答（索引加载、检索、带来源回答）。
 */

export { loadWikiIndex, WikiNotFoundError, type WikiIndexEntry } from './wiki-index.js';
export { retrieve, tokenize, type RetrievedPage } from './retriever.js';
export { answerQuestion, type QaAnswer } from './answerer.js';
