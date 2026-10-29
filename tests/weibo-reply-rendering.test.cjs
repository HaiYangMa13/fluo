const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createMethodHarness } = require('./ets-loader.cjs');
function harness() {
  const calls = [], pending = [], toasts = [];
  const service = { fetchCommentReplies: (id, cursor, continuation, postId) => {
    calls.push({ id, cursor, continuation, postId });
    return new Promise((resolve, reject) => { const finish = value => value instanceof Error ? reject(value) : resolve(value); pending.push(finish); });
  } };
  const auth = { getSessionRevision: () => 1, isSessionChanging: () => false };
  const instance = createMethodHarness('pages/WeiboPostDetail.ets', ['loadReplies', 'collapseReplies', 'commentThreadKey', 'isCurrentSession', 'isCurrentCommentRequest', 'isCurrentReplyRequest'], {
    WeiboAuthManager: { getInstance: () => auth }, WeiboService: { getInstance: () => service }, hilog: { info() {} }, $r: id => id
  });
  Object.assign(instance, { postId: 'post', comments: [], commentsEpoch: 0, replyLoadingIds: [], expandedReplyIds: [], replyCursors: new Map(), replyContinuations: new Map(), replyEpochs: new Map(), commentLikeVersion: 0,
    applyConcurrentCommentLikes() {}, getUIContext: () => ({ getPromptAction: () => ({ showToast: value => toasts.push(value.message) }) }) });
  return { instance, calls, pending, toasts };
}
test('thread render identity changes from preview through two pages and terminal state', async () => {
  const h = harness(), v = h.instance;
  const comment = { id: 'root', replyCount: 12, replies: [] }, other = { id: 'other', replies: [] };
  v.comments = [comment, other];
  const idle = v.commentThreadKey(comment), otherKey = v.commentThreadKey(other), before = v.comments;
  const first = v.loadReplies(comment);
  assert.notEqual(v.comments, before);
  assert.notEqual(v.commentThreadKey(comment), idle);
  h.pending.shift()({ items: Array.from({ length: 10 }, (_, i) => ({ id: 'child-' + i })), nextMaxId: 'next', hasMore: true }); await first;
  const page1 = v.commentThreadKey(comment);
  assert.equal(comment.replies.length, 10);
  const second = v.loadReplies(comment);
  assert.notEqual(v.commentThreadKey(comment), page1);
  h.pending.shift()({ items: [{ id: 'child-9' }, { id: 'child-10' }, { id: 'child-11' }], nextMaxId: '0', hasMore: false }); await second;
  assert.equal(comment.replies.length, 12);
  assert.notEqual(v.commentThreadKey(comment), page1);
  assert.equal(v.commentThreadKey(other), otherKey);
  assert.equal(v.replyCursors.get('root'), '0');
  assert.equal(v.replyLoadingIds.length, 0);
  assert.deepEqual(h.calls.map(c => c.cursor), ['0', 'next']);
  await v.loadReplies(comment); assert.equal(h.calls.length, 2);
  v.collapseReplies('root'); assert.equal(v.replyCursors.has('root'), false);
});
test('duplicate page with unchanged cursor remains retryable and reports no progress', async () => {
  const h = harness(), v = h.instance, comment = { id: 'root', replies: [{ id: 'child' }] };
  v.comments = [comment]; v.expandedReplyIds = ['root']; v.replyCursors.set('root', 'next');
  const request = v.loadReplies(comment);
  h.pending.shift()({ items: [{ id: 'child' }], nextMaxId: 'next', hasMore: false }); await request;
  assert.equal(v.replyCursors.get('root'), 'next');
  assert.equal(comment.replies.length, 1);
  assert.equal(v.replyLoadingIds.length, 0);
  assert.equal(h.toasts.length, 1);
});
test('one load-more tap skips duplicate/empty pages, deduplicates within a page and keeps the endpoint', async () => {
  const h = harness(), v = h.instance, comment = { id: 'root', replies: [{ id: 'seen' }] };
  const desktop = { source: 'desktop', maxIdType: '0' };
  v.comments = [comment]; v.replyCursors.set('root', 'mobile-next');
  v.replyContinuations.set('root', { source: 'mobile', maxIdType: '1' });
  const request = v.loadReplies(comment);
  h.pending.shift()({ items: [{ id: 'seen' }], nextMaxId: 'd1', hasMore: true, replyContinuation: desktop });
  await new Promise(setImmediate);
  assert.equal(h.calls[1].cursor, 'd1'); assert.equal(h.calls[1].continuation.source, 'desktop'); assert.equal(h.calls[1].postId, 'post');
  h.pending.shift()({ items: [], nextMaxId: 'd2', hasMore: true, replyContinuation: desktop });
  await new Promise(setImmediate);
  h.pending.shift()({ items: [{ id: 'new' }, { id: 'new' }], nextMaxId: 'd3', hasMore: true, replyContinuation: desktop });
  await request;
  assert.equal(h.calls.length, 3); assert.deepEqual(Array.from(comment.replies, r => r.id), ['seen', 'new']);
  assert.equal(v.replyCursors.get('root'), 'd3'); assert.equal(v.replyLoadingIds.length, 0);
});
test('three no-progress pages stop with retry available; failure retains the last successful cursor and source', async () => {
  const h = harness(), v = h.instance, comment = { id: 'root', replies: [{ id: 'seen' }] };
  v.comments = [comment]; v.replyCursors.set('root', 'start');
  const request = v.loadReplies(comment);
  for (let i = 1; i <= 3; i++) {
    h.pending.shift()({ items: [], nextMaxId: `c${i}`, hasMore: true, replyContinuation: { source: 'desktop', maxIdType: '0' } });
    await new Promise(setImmediate);
  }
  await request; assert.equal(h.calls.length, 3); assert.equal(v.replyCursors.get('root'), 'c3'); assert.equal(h.toasts.length, 1);
  const retry = v.loadReplies(comment); h.pending.shift()(new Error('network')); await retry;
  assert.equal(v.replyCursors.get('root'), 'c3'); assert.equal(v.replyContinuations.get('root').source, 'desktop');
  assert.equal(comment.replies.length, 1); assert.equal(v.replyLoadingIds.length, 0);
  v.collapseReplies('root'); assert.equal(v.replyContinuations.has('root'), false);
});
test('collapse or comment refresh during an empty-page scan prevents another request or stale updates', async () => {
  const h = harness(), v = h.instance, comment = { id: 'root', replies: [{ id: 'seen' }] };
  v.comments = [comment]; v.replyCursors.set('root', 'first');
  const request = v.loadReplies(comment);
  h.pending.shift()({ items: [], nextMaxId: 'second', hasMore: true }); await new Promise(setImmediate);
  v.collapseReplies('root');
  h.pending.shift()({ items: [{ id: 'late' }], nextMaxId: 'third', hasMore: true, replyContinuation: { source: 'desktop', maxIdType: '0' } });
  await request;
  assert.equal(h.calls.length, 2); assert.equal(v.replyContinuations.size, 0); assert.equal(v.replyCursors.size, 0);
  assert.deepEqual(Array.from(comment.replies, r => r.id), ['seen']); assert.equal(v.replyLoadingIds.length, 0);
});

test('ArkUI root ForEach keys use reply state rather than only immutable comment ID', () => {
  const source = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets/pages/WeiboPostDetail.ets'), 'utf8');
  assert.ok(source.includes('(comment: WeiboComment): string => this.commentThreadKey(comment)'));
  assert.ok(source.includes("Text('已加载全部回复')"));
  const emptyPage = source.slice(source.indexOf('} else if (this.comments.length === 0) {'), source.indexOf('ForEach(this.comments,'));
  assert.ok(emptyPage.includes('this.hasMoreComments'));
  assert.ok(emptyPage.includes("Button($r('app.string.weibo_comments_load_more'))"));
  assert.ok(emptyPage.includes('this.loadMoreComments()'), 'an empty initial page must retain manual continuation');
});
