(function initializeContentScript() {
  const settingsApi = globalThis.DEEPSEEK_SCROLL_SETTINGS;
  const groupsApi = globalThis.DEEPSEEK_GROUPS;
  const LIGHT = { thumb: '#2674ff', track: '#dbe7ff' };
  const DARK = { thumb: '#79a7ff', track: '#1d2c49' };
  const state = {
    container: null,
    settings: settingsApi.normalizeSettings(),
    observer: null,
    resizeObserver: null,
    resizeSize: null,
    refreshTimer: null,
    fadeTimer: null,
    scrollListener: null,
    initialChanges: {},
    initialized: false,
    groupState: groupsApi.normalizeState(),
    groupRoot: null,
    activeChat: null,
    groupTab: 'time',
    editingGroupId: null,
    editingGroupDraft: null,
    groupEditBlurTimer: null,
    groupStorageReady: false,
    groupStorageRevision: 0,
    groupStorageRecord: null,
    groupSaveQueue: [],
    groupSaveInFlight: false,
    groupOperationSequence: 0,
    groupWriterId: `writer-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    groupMenuCloseTimer: null
  };
  const colorScheme = matchMedia('(prefers-color-scheme: dark)');
  const GROUP_STORAGE_KEY = 'dsaGroups';
  const GROUP_BACKUP_KEY = 'dsaGroupsBackup';
  const GROUP_OPERATION_PREFIX = 'dsaGroupsOp:';

  function storedGroupRecord(stored) {
    const records = [
      groupsApi.normalizeStoredRecord(stored?.[GROUP_STORAGE_KEY]),
      groupsApi.normalizeStoredRecord(stored?.[GROUP_BACKUP_KEY])
    ].filter(Boolean);
    return records.sort((a, b) => b.revision - a.revision)[0] || groupsApi.makeStoredRecord(groupsApi.DEFAULTS);
  }

  function storedGroupOperations(stored) {
    return Object.entries(stored || {})
      .filter(([key, value]) => key.startsWith(GROUP_OPERATION_PREFIX) && value && typeof value === 'object')
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => {
        const timeDifference = (a.value.createdAt || 0) - (b.value.createdAt || 0);
        return timeDifference || a.key.localeCompare(b.key);
      })
      .map(({ value }) => value);
  }

  function loadGroups() {
    chrome.storage.local.get(null, (stored) => {
      const record = storedGroupRecord(stored);
      let next = record.state;
      for (const operation of storedGroupOperations(stored)) next = groupsApi.applyOperation(next, operation);
      state.groupState = groupsApi.normalizeState(next);
      state.groupStorageRecord = groupsApi.makeStoredRecord(state.groupState, record.revision);
      state.groupStorageRevision = record.revision;
      state.groupStorageReady = true;
      renderGroups();
    });
  }

  function applyRemoteGroupChanges(changes) {
    if (!state.groupStorageReady || !changes) return;
    let shouldRender = false;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(GROUP_OPERATION_PREFIX) || !change?.newValue) continue;
      state.groupState = groupsApi.applyOperation(state.groupState, change.newValue);
      shouldRender = true;
    }
    for (const key of [GROUP_STORAGE_KEY, GROUP_BACKUP_KEY]) {
      const record = groupsApi.normalizeStoredRecord(changes[key]?.newValue);
      if (!record || record.revision < state.groupStorageRevision) continue;
      state.groupStorageRevision = record.revision;
      if (key === GROUP_STORAGE_KEY) state.groupStorageRecord = record;
    }
    if (shouldRender) renderGroups();
  }

  function flushGroupSaves() {
    if (state.groupSaveInFlight || !state.groupSaveQueue.length || !state.groupStorageReady) return;
    const pending = state.groupSaveQueue.shift();
    const currentRecord = state.groupStorageRecord || groupsApi.makeStoredRecord(groupsApi.DEFAULTS, state.groupStorageRevision);
    const revision = Math.max(state.groupStorageRevision, currentRecord.revision) + 1;
    const nextRecord = groupsApi.makeStoredRecord(pending.snapshot, revision);
    const operationKey = `${GROUP_OPERATION_PREFIX}${pending.operation.opId}`;
    state.groupStorageRecord = nextRecord;
    state.groupStorageRevision = revision;
    state.groupSaveInFlight = true;
    try {
      chrome.storage.local.set({
        [operationKey]: pending.operation,
        [GROUP_STORAGE_KEY]: nextRecord,
        [GROUP_BACKUP_KEY]: currentRecord
      }, () => {
        state.groupSaveInFlight = false;
        flushGroupSaves();
      });
    } catch (error) {
      state.groupSaveInFlight = false;
      state.groupStorageRecord = currentRecord;
      state.groupStorageRevision = currentRecord.revision;
      state.groupSaveQueue.unshift(pending);
    }
  }

  function saveGroups(operation) {
    if (!state.groupStorageReady || !operation) return;
    const operationId = `${state.groupWriterId}-${Date.now()}-${++state.groupOperationSequence}`;
    state.groupSaveQueue.push({
      operation: { ...operation, opId: operationId, createdAt: Date.now() },
      snapshot: groupsApi.normalizeState(state.groupState)
    });
    flushGroupSaves();
  }

  function commitGroupOperation(operation) {
    if (!state.groupStorageReady) return false;
    state.groupState = groupsApi.applyOperation(state.groupState, operation);
    saveGroups(operation);
    renderGroups();
    return true;
  }

  function createGroup(name, chat) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || !state.groupStorageReady) return null;
    const group = {
      id: `group-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: trimmed,
      collapsed: false
    };
    commitGroupOperation({ type: 'create-group', group, ...(chat ? { chat } : {}) });
    return group;
  }

  function focusEditingGroup() {
    if (!state.editingGroupId) return;
    const root = document.querySelector('#dsa-sidebar-groups');
    const input = [...(root?.querySelectorAll('[data-dsa-group-name]') || [])]
      .find((element) => element.getAttribute('data-dsa-group-name') === state.editingGroupId);
    if (!input) return;
    input.focus();
    input.select?.();
  }

  function finishGroupEditing(groupId, value) {
    if (state.editingGroupId !== groupId) return;
    if (state.groupEditBlurTimer !== null) {
      clearTimeout(state.groupEditBlurTimer);
      state.groupEditBlurTimer = null;
    }
    const group = state.groupState.groups.find((item) => item.id === groupId);
    if (!group) {
      state.editingGroupId = null;
      state.editingGroupDraft = null;
      return;
    }
    const name = (typeof value === 'string' ? value : state.editingGroupDraft || '').trim() || '新分组';
    state.editingGroupId = null;
    state.editingGroupDraft = null;
    if (name !== group.name) commitGroupOperation({ type: 'rename-group', groupId, name });
    else renderGroups();
    showGroupsTab();
  }

  function cancelGroupEditing(groupId) {
    if (state.editingGroupId !== groupId) return;
    if (state.groupEditBlurTimer !== null) {
      clearTimeout(state.groupEditBlurTimer);
      state.groupEditBlurTimer = null;
    }
    state.editingGroupId = null;
    state.editingGroupDraft = null;
    renderGroups();
    showGroupsTab();
  }

  function finishCurrentGroupEditing() {
    if (!state.editingGroupId) return;
    finishGroupEditing(state.editingGroupId, state.editingGroupDraft);
  }

  function scheduleGroupEditingFinish(groupId, input) {
    if (state.groupEditBlurTimer !== null) clearTimeout(state.groupEditBlurTimer);
    state.groupEditBlurTimer = setTimeout(() => {
      state.groupEditBlurTimer = null;
      finishGroupEditing(groupId, input.value);
    }, 0);
  }

  function beginGroupEditing(groupId, draft) {
    if (!state.groupState.groups.some((group) => group.id === groupId)) return;
    if (state.editingGroupId && state.editingGroupId !== groupId) finishCurrentGroupEditing();
    state.groupTab = 'groups';
    state.editingGroupId = groupId;
    state.editingGroupDraft = draft;
    renderGroups();
    focusEditingGroup();
    applyGroupTab();
  }

  function createGroupInline(chat) {
    finishCurrentGroupEditing();
    const group = createGroup('新分组', chat);
    if (!group) return;
    state.editingGroupId = group.id;
    state.editingGroupDraft = '';
    state.groupTab = 'groups';
    renderGroups();
    focusEditingGroup();
    applyGroupTab();
  }

  function findTimelines() {
    return [...new Set([...document.querySelectorAll('a[href^="/a/chat/s/"]')]
      .filter((link) => !link.closest?.('#dsa-sidebar-groups'))
      .map((link) => link.parentElement)
      .filter(Boolean))];
  }

  function chatFromLink(link) {
    return { href: link.getAttribute('href'), title: link.querySelector('.c08e6e93')?.innerText || link.innerText.trim() || '未命名对话' };
  }

  function closeGroupMenu() {
    if (state.groupMenuCloseTimer !== null) {
      clearTimeout(state.groupMenuCloseTimer);
      state.groupMenuCloseTimer = null;
    }
    document.querySelector('.dsa-group-menu-option.dsa-group-menu-open')?.classList.remove('dsa-group-menu-open');
    document.querySelector('.dsa-group-menu-option[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
    document.querySelector('#dsa-group-menu')?.remove();
  }

  function cancelGroupMenuClose() {
    if (state.groupMenuCloseTimer === null) return;
    clearTimeout(state.groupMenuCloseTimer);
    state.groupMenuCloseTimer = null;
  }

  function scheduleGroupMenuClose() {
    cancelGroupMenuClose();
    state.groupMenuCloseTimer = setTimeout(() => {
      state.groupMenuCloseTimer = null;
      const option = document.querySelector('.dsa-group-menu-option.dsa-group-menu-open');
      const submenu = document.querySelector('#dsa-group-menu');
      if (option?.matches?.(':hover') || submenu?.matches?.(':hover')) return;
      closeGroupMenu();
    }, 180);
  }

  function findDirectMenuItem(menu, keyword, excluded) {
    return [...(menu.children || [])]
      .filter((item) => item !== excluded && item.id !== 'dsa-group-menu')
      .find((item) => item.textContent?.replace(/\s+/g, '').includes(keyword));
  }

  function placeGroupMenuOption(menu, option) {
    const multiSelect = findDirectMenuItem(menu, '\u591a\u9009', option);
    const deleteItem = findDirectMenuItem(menu, '\u5220\u9664', option);
    const children = [...(menu.children || [])];
    const multiIndex = multiSelect ? children.indexOf(multiSelect) : -1;
    const deleteIndex = deleteItem ? children.indexOf(deleteItem) : -1;
    let reference = null;

    if (deleteItem && (multiIndex < 0 || multiIndex < deleteIndex)) reference = deleteItem;
    else if (multiSelect) reference = multiSelect.nextElementSibling;
    else if (deleteItem) reference = deleteItem;

    if (reference && reference !== option && option.nextElementSibling !== reference) menu.insertBefore(option, reference);
    else if (!option.parentElement) menu.append(option);
  }

  function showGroupMenu(option, chat) {
    closeGroupMenu();
    const submenu = document.createElement('div');
    submenu.id = 'dsa-group-menu';
    submenu.addEventListener('mouseenter', cancelGroupMenuClose);
    submenu.addEventListener('mouseleave', scheduleGroupMenuClose);
    for (const group of state.groupState.groups) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `加入 ${group.name}`;
      button.addEventListener('click', () => {
        commitGroupOperation({ type: 'add-chat', groupId: group.id, chat });
        closeGroupMenu();
      });
      submenu.append(button);
    }
    const create = document.createElement('button');
    create.type = 'button';
    create.textContent = '新建分组并加入';
    create.addEventListener('click', () => {
      createGroupInline(chat);
      closeGroupMenu();
    });
    submenu.append(create);
    const rect = option.getBoundingClientRect();
    document.body.append(submenu);
    let left = rect.right + 6;
    let top = rect.top;
    const viewportWidth = globalThis.innerWidth || document.documentElement?.clientWidth || 0;
    const viewportHeight = globalThis.innerHeight || document.documentElement?.clientHeight || 0;
    if (viewportWidth && left + submenu.offsetWidth > viewportWidth - 8) {
      left = Math.max(8, rect.left - submenu.offsetWidth - 6);
    }
    if (viewportHeight && top + submenu.offsetHeight > viewportHeight - 8) {
      top = Math.max(8, viewportHeight - submenu.offsetHeight - 8);
    }
    submenu.style.left = `${Math.round(left)}px`;
    submenu.style.top = `${Math.round(top)}px`;
    option.classList.add('dsa-group-menu-open');
    option.setAttribute('aria-expanded', 'true');
  }

  function handleGroupMenuPointerDown(event) {
    const option = event.target.closest?.('.dsa-group-menu-option');
    if (option) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!event.target.closest?.('#dsa-group-menu')) closeGroupMenu();
  }

  function addGroupMenuAction() {
    const menu = document.querySelector('[role="menu"].ds-dropdown-menu');
    if (!state.groupStorageReady || !menu || !state.activeChat) return;
    let option = menu.querySelector('.dsa-group-menu-option');
    if (!option) {
      option = document.createElement('div');
      option.className = 'ds-dropdown-menu-option ds-dropdown-menu-option--none dsa-group-menu-option';
      option.setAttribute('role', 'menuitem');
      option.tabIndex = 0;
      option.setAttribute('aria-haspopup', 'menu');
      option.setAttribute('aria-expanded', 'false');
      option.setAttribute('aria-label', '加入分组，打开分组列表');
      option.title = '选择一个分组';
      option.innerHTML = '<div class="ds-dropdown-menu-option__icon">+</div><div class="ds-dropdown-menu-option__label">加入分组</div><span class="dsa-group-menu-hint" aria-hidden="true">›</span>';
      option.addEventListener('mouseenter', () => {
        cancelGroupMenuClose();
        if (!document.querySelector('#dsa-group-menu')) showGroupMenu(option, state.activeChat);
      });
      option.addEventListener('mouseleave', scheduleGroupMenuClose);
      option.addEventListener('focus', () => {
        cancelGroupMenuClose();
        if (!document.querySelector('#dsa-group-menu')) showGroupMenu(option, state.activeChat);
      });
      option.addEventListener('blur', scheduleGroupMenuClose);
      option.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      menu.append(option);
    }
    placeGroupMenuOption(menu, option);
  }

  function applyGroupTab() {
    const root = document.querySelector('#dsa-sidebar-groups');
    if (!root) {
      state.groupRoot = null;
      return;
    }
    state.groupRoot = root;
    const list = root.querySelector('.dsa-group-list');
    if (!list) return;
    const groupsVisible = state.groupTab === 'groups';
    for (const timeline of findTimelines()) timeline.hidden = groupsVisible;
    list.hidden = !groupsVisible;
    const tabButtons = root.querySelectorAll('.dsa-sidebar-tabs button');
    tabButtons[0]?.classList.toggle('dsa-tab-active', !groupsVisible);
    tabButtons[1]?.classList.toggle('dsa-tab-active', groupsVisible);
  }

  function showGroupsTab() {
    state.groupTab = 'groups';
    applyGroupTab();
  }

  function showTimelineTab() {
    state.groupTab = 'time';
    applyGroupTab();
  }

  function renderGroups() {
    if (!state.groupStorageReady) return;
    const timelines = findTimelines();
    if (!timelines.length) return;
    let root = document.querySelector('#dsa-sidebar-groups');
    if (!root) {
      root = document.createElement('section');
      root.id = 'dsa-sidebar-groups';
      timelines[0].before(root);
    }
    state.groupRoot = root;
    root.replaceChildren();
    const tabs = document.createElement('div');
    tabs.className = 'dsa-sidebar-tabs';
    const timeTab = document.createElement('button');
    timeTab.type = 'button';
    timeTab.textContent = '时间';
    const groupTab = document.createElement('button');
    groupTab.type = 'button';
    groupTab.textContent = '分组';
    timeTab.addEventListener('click', showTimelineTab);
    groupTab.addEventListener('click', showGroupsTab);
    tabs.append(timeTab, groupTab);
    const list = document.createElement('div');
    list.className = 'dsa-group-list';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'dsa-new-group';
    add.textContent = '+ 新建分组';
    add.addEventListener('click', () => createGroupInline());
    list.append(add);
    for (const group of state.groupState.groups) {
      const section = document.createElement('section');
      section.className = 'dsa-group';
      const header = document.createElement('div');
      header.className = 'dsa-group-header';
      const editing = state.editingGroupId === group.id;
      let groupNameInput = null;
      if (editing) {
        groupNameInput = document.createElement('input');
        groupNameInput.type = 'text';
        groupNameInput.className = 'dsa-group-name-input';
        groupNameInput.value = state.editingGroupDraft ?? group.name;
        groupNameInput.placeholder = '分组名称';
        groupNameInput.setAttribute('data-dsa-group-name', group.id);
        groupNameInput.setAttribute('aria-label', '分组名称');
        groupNameInput.addEventListener('input', () => { state.editingGroupDraft = groupNameInput.value; });
        groupNameInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finishGroupEditing(group.id, groupNameInput.value);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelGroupEditing(group.id);
          }
        });
        groupNameInput.addEventListener('blur', () => scheduleGroupEditingFinish(group.id, groupNameInput));
        header.append(groupNameInput);
      } else {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.textContent = `${group.collapsed ? '▸' : '▾'} ${group.name} (${(state.groupState.memberships[group.id] || []).length})`;
        toggle.addEventListener('click', () => {
          const current = state.groupState.groups.find((item) => item.id === group.id);
          if (!current) return;
          commitGroupOperation({ type: 'set-collapsed', groupId: group.id, collapsed: !current.collapsed });
          showGroupsTab();
        });
        header.append(toggle);
      }
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.textContent = editing ? '完成' : '编辑';
      rename.addEventListener('click', () => {
        if (editing) finishGroupEditing(group.id, groupNameInput.value);
        else beginGroupEditing(group.id, group.name);
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '删除';
      remove.addEventListener('click', () => {
        if (confirm(`删除分组“${group.name}”？不会删除 DeepSeek 对话。`)) {
          commitGroupOperation({ type: 'remove-group', groupId: group.id });
          showGroupsTab();
        }
      });
      header.append(rename, remove);
      section.append(header);
      if (!group.collapsed) {
        for (const chat of state.groupState.memberships[group.id] || []) {
          const item = document.createElement('div');
          item.className = 'dsa-group-chat';
          const link = document.createElement('a');
          link.href = chat.href;
          link.textContent = chat.title;
          const removeChat = document.createElement('button');
          removeChat.type = 'button';
          removeChat.textContent = '移除';
          removeChat.addEventListener('click', () => {
            commitGroupOperation({ type: 'remove-chat', groupId: group.id, href: chat.href });
            showGroupsTab();
          });
          item.append(link, removeChat);
          section.append(item);
        }
      }
      list.append(section);
    }
    root.append(tabs, list);
    applyGroupTab();
  }

  function findOfficialChatLink(groupLink, href) {
    return [...document.querySelectorAll('a[href^="/a/chat/s/"]')]
      .find((link) => link !== groupLink && link.getAttribute('href') === href && !link.closest?.('#dsa-sidebar-groups'));
  }

  function navigateFromGroupLink(link, href) {
    const officialLink = findOfficialChatLink(link, href);
    if (officialLink?.click) {
      officialLink.click();
      return true;
    }
    if (!globalThis.history?.pushState || !globalThis.dispatchEvent) return false;
    try {
      globalThis.history.pushState({}, '', href);
      const PopState = globalThis.PopStateEvent || globalThis.Event;
      globalThis.dispatchEvent(new PopState('popstate'));
      return true;
    } catch (error) {
      return false;
    }
  }

  function handleGroupChatClick(event) {
    const link = event.target.closest?.('#dsa-sidebar-groups a[href^="/a/chat/s/"]');
    if (!link || (event.button !== undefined && event.button !== 0) || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = link.getAttribute('href');
    if (!href || (!findOfficialChatLink(link, href) && !globalThis.history?.pushState)) return;
    event.preventDefault();
    event.stopPropagation();
    state.groupTab = 'groups';
    navigateFromGroupLink(link, href);
    applyGroupTab();
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 240 && rect.height > 180 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isScrollable(element) {
    const style = getComputedStyle(element);
    return element.scrollHeight - element.clientHeight > 24 && /(auto|scroll)/.test(style.overflowY);
  }

  function findScrollContainer() {
    return [...document.querySelectorAll('body *')]
      .filter((element) => !element.id.startsWith('dsa-') && isVisible(element) && isScrollable(element))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0]?.element || null;
  }

  function activePreset() {
    return colorScheme.matches ? DARK : LIGHT;
  }

  function clearContainer() {
    state.resizeObserver?.disconnect();
    state.resizeObserver = null;
    state.resizeSize = null;
    if (!state.container) return;
    delete state.container.dataset.dsaScrollContainer;
    state.container.style.removeProperty('--dsa-width');
    state.container.style.removeProperty('--dsa-thumb-color');
    state.container.style.removeProperty('--dsa-track-color');
    state.container = null;
  }

  function removeControls() {
    if (state.fadeTimer !== null) {
      clearTimeout(state.fadeTimer);
      state.fadeTimer = null;
    }
    if (state.container && state.scrollListener) {
      state.container.removeEventListener('scroll', state.scrollListener);
      state.scrollListener = null;
    }
    document.querySelector('#dsa-position-label')?.remove();
    document.querySelector('#dsa-actions')?.remove();
  }

  function renderScrollState() {
    const label = document.querySelector('#dsa-position-label');
    const topButton = document.querySelector('#dsa-scroll-top');
    const latestButton = document.querySelector('#dsa-scroll-latest');
    if (!state.container || !label || !topButton || !latestButton) return;
    const maximum = Math.max(0, state.container.scrollHeight - state.container.clientHeight);
    const percent = maximum === 0 ? 0 : Math.round((state.container.scrollTop / maximum) * 100);
    label.value = `${percent}%`;
    topButton.classList.toggle('dsa-hidden', state.container.scrollTop <= 24);
    latestButton.classList.toggle('dsa-hidden', maximum - state.container.scrollTop <= 24);
  }

  function ensureControls() {
    let label = document.querySelector('#dsa-position-label');
    if (!label) {
      label = document.createElement('output');
      label.id = 'dsa-position-label';
      label.className = 'dsa-hidden';
      label.setAttribute('aria-live', 'off');
      document.body.append(label);
    }
    let actions = document.querySelector('#dsa-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.id = 'dsa-actions';
      actions.innerHTML = '<button id="dsa-scroll-top" type="button" aria-label="回到对话顶部">顶部</button><button id="dsa-scroll-latest" type="button" aria-label="跳到最新消息">最新</button>';
      document.body.append(actions);
    }
    document.querySelector('#dsa-scroll-top').addEventListener('click', () => {
      state.container?.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.querySelector('#dsa-scroll-latest').addEventListener('click', () => {
      state.container?.scrollTo({ top: state.container.scrollHeight, behavior: 'smooth' });
    });
    state.scrollListener = () => {
      label.classList.remove('dsa-hidden');
      renderScrollState();
      if (state.fadeTimer !== null) clearTimeout(state.fadeTimer);
      state.fadeTimer = setTimeout(() => {
        label.classList.add('dsa-hidden');
        state.fadeTimer = null;
      }, 900);
    };
    state.container.addEventListener('scroll', state.scrollListener);
    renderScrollState();
  }

  function applySettings(settings) {
    const preset = activePreset();
    if (!state.container || !settings.enabled) return;
    state.container.dataset.dsaScrollContainer = 'true';
    state.container.style.setProperty('--dsa-width', `${settings.width}px`);
    state.container.style.setProperty('--dsa-thumb-color', settings.thumbColor || preset.thumb);
    state.container.style.setProperty('--dsa-track-color', settings.trackColor || preset.track);
  }

  function refreshContainer() {
    if (!state.settings.enabled) {
      removeControls();
      clearContainer();
      return;
    }
    const nextContainer = findScrollContainer();
    if (nextContainer === state.container) {
      applySettings(state.settings);
      renderScrollState();
      return;
    }
    removeControls();
    clearContainer();
    state.container = nextContainer;
    if (!state.container) return;
    if (globalThis.ResizeObserver) {
      let receivedInitialResize = false;
      state.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target !== state.container) continue;
          const { width, height } = entry.contentRect;
          if (!receivedInitialResize) {
            state.resizeSize = { width, height };
            receivedInitialResize = true;
            continue;
          }
          if (width === state.resizeSize.width && height === state.resizeSize.height) continue;
          state.resizeSize = { width, height };
          scheduleRefresh();
        }
      });
      state.resizeObserver.observe(state.container);
    }
    applySettings(state.settings);
    ensureControls();
  }

  function scheduleRefresh() {
    if (!state.initialized) return;
    if (state.refreshTimer !== null) clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      refreshContainer();
    }, 150);
  }

  function updateSettings(changes) {
    const next = { ...state.settings };
    for (const key of Object.keys(settingsApi.DEFAULTS)) {
      if (!changes[key]) continue;
      next[key] = changes[key].newValue;
      if (!state.initialized) state.initialChanges[key] = changes[key].newValue;
    }
    state.settings = settingsApi.normalizeSettings(next);
    if (state.initialized) refreshContainer();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') updateSettings(changes);
    if (areaName === 'local') applyRemoteGroupChanges(changes);
  });

  chrome.storage.sync.get(settingsApi.DEFAULTS, (stored) => {
    state.settings = settingsApi.normalizeSettings({ ...stored, ...state.initialChanges });
    state.initialized = true;
    refreshContainer();
  });

  colorScheme.addEventListener('change', () => applySettings(state.settings));
  window.addEventListener('resize', scheduleRefresh);

  state.observer = new MutationObserver((mutations = []) => {
    const pageChanged = mutations.length === 0 || mutations.some((mutation) =>
      !(mutation.target?.id?.startsWith('dsa-') || mutation.target?.closest?.('#dsa-sidebar-groups')) &&
      [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
        if (node.nodeType !== undefined && node.nodeType !== 1) return false;
        return !node.id?.startsWith('dsa-') && !(node.closest ? node.closest('#dsa-sidebar-groups') : false);
      }));
    if (pageChanged) {
      scheduleRefresh();
      addGroupMenuAction();
      if (!document.querySelector('#dsa-sidebar-groups')) renderGroups();
      else applyGroupTab();
    }
  });
  state.observer.observe(document.body, { childList: true, subtree: true });

  if (chrome.storage.local) {
    loadGroups();
  }

  document.addEventListener?.('pointerdown', (event) => {
    const link = event.target.closest?.('a[href^="/a/chat/s/"]');
    if (link) state.activeChat = chatFromLink(link);
  }, true);

  document.addEventListener?.('pointerdown', handleGroupMenuPointerDown, true);
  document.addEventListener?.('click', handleGroupChatClick, true);
})();
