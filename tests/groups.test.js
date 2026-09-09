const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULTS,
  normalizeState,
  normalizeStoredRecord,
  makeStoredRecord,
  applyOperation,
  addChat,
  removeGroup
} = require('../groups.js');

test('normalizes malformed local group storage', () => {
  assert.deepEqual(normalizeState(), DEFAULTS);
  assert.deepEqual(normalizeState({ groups: [{ id: 'study', name: '学习' }], memberships: { study: [{ href: '/a/chat/s/1', title: '题目' }, null] } }), {
    groups: [{ id: 'study', name: '学习', collapsed: false, color: null, icon: null, pinned: false }],
    memberships: { study: [{ href: '/a/chat/s/1', title: '题目' }] }
  });
});

test('adds a chat once per group while allowing it in multiple groups', () => {
  const state = { groups: [{ id: 'study', name: '学习' }, { id: 'work', name: '工作' }], memberships: {} };
  const chat = { href: '/a/chat/s/1', title: '题目' };
  const withStudy = addChat(state, 'study', chat);
  const withBoth = addChat(withStudy, 'work', chat);

  assert.deepEqual(addChat(withBoth, 'study', chat).memberships.study, [chat]);
  assert.deepEqual(withBoth.memberships.work, [chat]);
});

test('deletes a group and its memberships without deleting other groups', () => {
  const state = {
    groups: [{ id: 'study', name: '学习' }, { id: 'work', name: '工作' }],
    memberships: { study: [{ href: '/a/chat/s/1', title: '题目' }], work: [{ href: '/a/chat/s/1', title: '题目' }] }
  };

  assert.deepEqual(removeGroup(state, 'study'), {
    groups: [{ id: 'work', name: '工作', collapsed: false, color: null, icon: null, pinned: false }],
    memberships: { work: [{ href: '/a/chat/s/1', title: '题目' }] }
  });
});

test('replays journal operations idempotently on top of a stored snapshot', () => {
  const create = {
    type: 'create-group',
    group: { id: 'study', name: '学习', collapsed: false },
    chat: { href: '/a/chat/s/1', title: '题目' },
    opId: 'writer-1',
    createdAt: 1
  };
  const rename = { type: 'rename-group', groupId: 'study', name: '重点学习', opId: 'writer-2', createdAt: 2 };
  const collapse = { type: 'set-collapsed', groupId: 'study', collapsed: true, opId: 'writer-3', createdAt: 3 };

  let state = applyOperation(DEFAULTS, create);
  state = applyOperation(state, rename);
  state = applyOperation(state, collapse);
  state = applyOperation(state, create);

  assert.deepEqual(state, {
    groups: [{ id: 'study', name: '重点学习', collapsed: true, color: null, icon: null, pinned: false }],
    memberships: { study: [{ href: '/a/chat/s/1', title: '题目' }] }
  });
});

test('accepts legacy state and keeps the newest valid stored record', () => {
  const legacy = normalizeStoredRecord({
    groups: [{ id: 'study', name: '学习' }],
    memberships: { study: [] }
  });
  const current = makeStoredRecord({ groups: [], memberships: {} }, 4);

  assert.deepEqual(legacy, {
    version: 1,
    revision: 0,
    state: { groups: [{ id: 'study', name: '学习', collapsed: false, color: null, icon: null, pinned: false }], memberships: { study: [] } }
  });
  assert.deepEqual(normalizeStoredRecord(current), current);
});

test('reorders groups, applies visual markers, and removes multiple missing chats', () => {
  const state = normalizeState({
    groups: [{ id: 'study', name: '学习' }, { id: 'work', name: '工作' }],
    memberships: {
      work: [{ href: '/a/chat/1', title: '保留' }, { href: '/a/chat/2', title: '移除' }]
    }
  });
  const marked = applyOperation(state, {
    type: 'set-group-marker',
    groupId: 'work',
    color: '#ABCDEF',
    icon: '⭐',
    pinned: true
  });
  assert.deepEqual(marked.groups[0], {
    id: 'work',
    name: '工作',
    collapsed: false,
    color: '#abcdef',
    icon: '⭐',
    pinned: true
  });

  const reordered = applyOperation(marked, { type: 'reorder-groups', groupIds: ['study', 'work'] });
  assert.deepEqual(reordered.groups.map((group) => group.id), ['study', 'work']);
  const cleaned = applyOperation(reordered, {
    type: 'remove-chats',
    groupId: 'work',
    hrefs: ['/a/chat/2', '/a/chat/2']
  });
  assert.deepEqual(cleaned.memberships.work, [{ href: '/a/chat/1', title: '保留' }]);
  assert.deepEqual(applyOperation(cleaned, { type: 'remove-chats', groupId: 'work', hrefs: ['/a/chat/2'] }), cleaned);
});
