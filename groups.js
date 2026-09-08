(function attachGroups(root) {
  const DEFAULTS = Object.freeze({ groups: [], memberships: {} });

  function normalizeState(value) {
    const source = value && typeof value === 'object' ? value : {};
    const groups = Array.isArray(source.groups) ? source.groups : [];
    const memberships = source.memberships && typeof source.memberships === 'object' ? source.memberships : {};

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
    const chats = next.memberships[groupId] || [];
    if (!chats.some((item) => item.href === chat.href)) chats.push({ href: chat.href, title: chat.title });
    next.memberships[groupId] = chats;
    return next;
  }

  function removeGroup(state, groupId) {
    const next = normalizeState(state);
    next.groups = next.groups.filter((group) => group.id !== groupId);
    delete next.memberships[groupId];
    return next;
  }

  const api = { DEFAULTS, normalizeState, addChat, removeGroup };
  root.DEEPSEEK_GROUPS = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
