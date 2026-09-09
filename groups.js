(function attachGroups(root) {
  const DEFAULTS = Object.freeze({ groups: [], memberships: {} });
  const STORAGE_VERSION = 1;

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeState(value) {
    const source = isRecord(value) ? value : {};
    const groups = Array.isArray(source.groups) ? source.groups : [];
    const memberships = isRecord(source.memberships) ? source.memberships : {};

    return {
      groups: groups
        .filter((group) => group && typeof group.id === 'string' && typeof group.name === 'string')
        .map((group) => ({ id: group.id, name: group.name, collapsed: Boolean(group.collapsed) })),
      memberships: Object.fromEntries(
        Object.entries(memberships)
          .filter(([groupId, chats]) => typeof groupId === 'string' && Array.isArray(chats))
          .map(([groupId, chats]) => [groupId, chats.filter((chat) => chat && typeof chat.href === 'string' && typeof chat.title === 'string')])
      )
    };
  }

  function addChat(state, groupId, chat) {
    const next = normalizeState(state);
    if (typeof groupId !== 'string' || !chat || typeof chat.href !== 'string' || typeof chat.title !== 'string') return next;
    const chats = next.memberships[groupId] || [];
    if (!chats.some((item) => item.href === chat.href)) chats.push({ href: chat.href, title: chat.title });
    next.memberships[groupId] = chats;
    return next;
  }

  function removeChat(state, groupId, href) {
    const next = normalizeState(state);
    if (typeof groupId !== 'string' || typeof href !== 'string' || !next.groups.some((group) => group.id === groupId)) return next;
    next.memberships[groupId] = (next.memberships[groupId] || []).filter((chat) => chat.href !== href);
    return next;
  }

  function removeGroup(state, groupId) {
    const next = normalizeState(state);
    next.groups = next.groups.filter((group) => group.id !== groupId);
    delete next.memberships[groupId];
    return next;
  }

  function applyOperation(state, operation) {
    const next = normalizeState(state);
    if (!isRecord(operation) || typeof operation.type !== 'string') return next;

    if (operation.type === 'create-group') {
      const group = operation.group;
      if (!isRecord(group) || typeof group.id !== 'string' || typeof group.name !== 'string') return next;
      if (!next.groups.some((item) => item.id === group.id)) {
        next.groups.push({ id: group.id, name: group.name, collapsed: Boolean(group.collapsed) });
      }
      if (operation.chat) return addChat(next, group.id, operation.chat);
      return next;
    }

    if (operation.type === 'add-chat') {
      if (!next.groups.some((group) => group.id === operation.groupId)) return next;
      return addChat(next, operation.groupId, operation.chat);
    }

    if (operation.type === 'remove-chat') return removeChat(next, operation.groupId, operation.href);
    if (operation.type === 'remove-group') return removeGroup(next, operation.groupId);

    if (operation.type === 'rename-group') {
      if (typeof operation.groupId !== 'string' || typeof operation.name !== 'string') return next;
      const group = next.groups.find((item) => item.id === operation.groupId);
      if (group) group.name = operation.name;
      return next;
    }

    if (operation.type === 'set-collapsed') {
      if (typeof operation.groupId !== 'string') return next;
      const group = next.groups.find((item) => item.id === operation.groupId);
      if (group) group.collapsed = Boolean(operation.collapsed);
      return next;
    }

    return next;
  }

  function makeStoredRecord(state, revision = 0) {
    return {
      version: STORAGE_VERSION,
      revision: Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0,
      state: normalizeState(state)
    };
  }

  function normalizeStoredRecord(value) {
    if (!isRecord(value)) return null;
    if (isRecord(value.state)) {
      return makeStoredRecord(value.state, value.revision);
    }
    if (Array.isArray(value.groups) || isRecord(value.memberships)) {
      return makeStoredRecord(value, 0);
    }
    return null;
  }

  const api = {
    DEFAULTS,
    STORAGE_VERSION,
    normalizeState,
    normalizeStoredRecord,
    makeStoredRecord,
    applyOperation,
    addChat,
    removeChat,
    removeGroup
  };
  root.DEEPSEEK_GROUPS = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
