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
    groupTab: 'time'
  };
  const colorScheme = matchMedia('(prefers-color-scheme: dark)');

  function saveGroups() {
    chrome.storage.local.set({ dsaGroups: state.groupState });
  }

  function createGroup(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    state.groupState.groups.push({ id: `group-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: trimmed, collapsed: false });
    saveGroups();
    renderGroups();
  }

  function findTimelines() {
    return [...new Set([...document.querySelectorAll('a[href^="/a/chat/s/"]')].map((link) => link.parentElement).filter(Boolean))];
  }

  function chatFromLink(link) {
    return { href: link.getAttribute('href'), title: link.querySelector('.c08e6e93')?.innerText || link.innerText.trim() || '未命名对话' };
  }

  function closeGroupMenu() {
    document.querySelector('#dsa-group-menu')?.remove();
  }

  function showGroupMenu(menu, chat) {
    closeGroupMenu();
    const submenu = document.createElement('div');
    submenu.id = 'dsa-group-menu';
    for (const group of state.groupState.groups) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `加入 ${group.name}`;
      button.addEventListener('click', () => {
        state.groupState = groupsApi.addChat(state.groupState, group.id, chat);
        saveGroups();
        closeGroupMenu();
        renderGroups();
      });
      submenu.append(button);
    }
    const create = document.createElement('button');
    create.type = 'button';
    create.textContent = '新建分组并加入';
    create.addEventListener('click', () => {
      const name = prompt('分组名称');
      if (!name?.trim()) return;
      createGroup(name);
      const group = state.groupState.groups.at(-1);
      state.groupState = groupsApi.addChat(state.groupState, group.id, chat);
      saveGroups();
      closeGroupMenu();
      renderGroups();
    });
    submenu.append(create);
    menu.append(submenu);
  }

  function addGroupMenuAction() {
    const menu = document.querySelector('[role="menu"].ds-dropdown-menu');
    if (!menu || menu.querySelector('.dsa-group-menu-option') || !state.activeChat) return;
    const option = document.createElement('div');
    option.className = 'ds-dropdown-menu-option ds-dropdown-menu-option--none dsa-group-menu-option';
    option.setAttribute('role', 'menuitem');
    option.innerHTML = '<div class="ds-dropdown-menu-option__icon">+</div><div class="ds-dropdown-menu-option__label">加入分组</div>';
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      showGroupMenu(menu, state.activeChat);
    });
    menu.append(option);
  }

  function renderGroups() {
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
    const showGroups = () => {
      state.groupTab = 'groups';
      for (const timeline of timelines) timeline.hidden = true;
      root.querySelector('.dsa-group-list').hidden = false;
      timeTab.classList.remove('dsa-tab-active');
      groupTab.classList.add('dsa-tab-active');
    };
    const showTimeline = () => {
      state.groupTab = 'time';
      for (const timeline of timelines) timeline.hidden = false;
      root.querySelector('.dsa-group-list').hidden = true;
      timeTab.classList.add('dsa-tab-active');
      groupTab.classList.remove('dsa-tab-active');
    };
    timeTab.addEventListener('click', showTimeline);
    groupTab.addEventListener('click', showGroups);
    tabs.append(timeTab, groupTab);
    const list = document.createElement('div');
    list.className = 'dsa-group-list';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'dsa-new-group';
    add.textContent = '+ 新建分组';
    add.addEventListener('click', () => createGroup(prompt('分组名称') || ''));
    list.append(add);
    for (const group of state.groupState.groups) {
      const section = document.createElement('section');
      section.className = 'dsa-group';
      const header = document.createElement('div');
      header.className = 'dsa-group-header';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.textContent = `${group.collapsed ? '▸' : '▾'} ${group.name} (${(state.groupState.memberships[group.id] || []).length})`;
      toggle.addEventListener('click', () => {
        group.collapsed = !group.collapsed;
        saveGroups();
        renderGroups();
        showGroups();
      });
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.textContent = '编辑';
      rename.addEventListener('click', () => {
        const name = prompt('分组名称', group.name);
        if (name?.trim()) { group.name = name.trim(); saveGroups(); renderGroups(); showGroups(); }
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '删除';
      remove.addEventListener('click', () => {
        if (confirm(`删除分组“${group.name}”？不会删除 DeepSeek 对话。`)) { state.groupState = groupsApi.removeGroup(state.groupState, group.id); saveGroups(); renderGroups(); showGroups(); }
      });
      header.append(toggle, rename, remove);
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
            state.groupState.memberships[group.id] = state.groupState.memberships[group.id].filter((item) => item.href !== chat.href);
            saveGroups(); renderGroups(); showGroups();
          });
          item.append(link, removeChat);
          section.append(item);
        }
      }
      list.append(section);
    }
    root.append(tabs, list);
    if (state.groupTab === 'groups') showGroups();
    else showTimeline();
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
      [...mutation.addedNodes, ...mutation.removedNodes].some((node) => !node.id?.startsWith('dsa-')));
    if (pageChanged) {
      scheduleRefresh();
      addGroupMenuAction();
      if (!document.querySelector('#dsa-sidebar-groups')) renderGroups();
    }
  });
  state.observer.observe(document.body, { childList: true, subtree: true });

  if (chrome.storage.local) {
    chrome.storage.local.get({ dsaGroups: groupsApi.DEFAULTS }, (stored) => {
      state.groupState = groupsApi.normalizeState(stored.dsaGroups);
      renderGroups();
    });
  }

  document.addEventListener?.('pointerdown', (event) => {
    const link = event.target.closest?.('a[href^="/a/chat/s/"]');
    if (link) state.activeChat = chatFromLink(link);
  }, true);

  document.addEventListener?.('click', (event) => {
    if (event.target.closest?.('#dsa-sidebar-groups a[href^="/a/chat/s/"]')) {
      state.groupTab = 'groups';
    }
  }, true);
})();
