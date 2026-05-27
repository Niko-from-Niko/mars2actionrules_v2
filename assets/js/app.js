const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const toast = $("#toast");
let toastTimer;
const channelMeta = {
  center: { label: "Центр уведомлений", icon: "#i-bell" },
  email: { label: "E-mail", icon: "#i-mail" },
  telegram: { label: "Telegram", icon: "#i-send" },
  team: { label: "Команда", icon: "#i-users" },
  sms: { label: "SMS", icon: "#i-message" }
};
const incidentMeta = {
  "sphere-incidents": { label: "Сфера Инциденты", icon: "#i-incident" },
  "sphere-outages": { label: "Сфера Аварии", icon: "#i-outage" }
};
const ruleSteps = {
  initial: {
    exists: true,
    name: "Начальные действия",
    channels: new Set(),
    incidents: new Set(),
    actionLabels: new Set(),
    actionSettings: {},
    activeActionLabel: "",
    recovery: false,
    delayEnabled: false,
    delayMinutes: 60,
    order: 0
  }
};
let currentStep = "initial";
let stepPendingDelete = null;
let escalationId = 0;
let stepOrder = 0;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function closeMenus(except) {
  $$(".select-wrap.open, .dropdown.open").forEach((node) => {
    if (node !== except) node.classList.remove("open");
  });
}

function updateStepTabsLayout() {
  const tabs = $(".step-tabs");
  if (!tabs) return;

  const tabItems = $$(".step-tab-item", tabs).filter((item) => !item.hidden);
  const count = tabItems.length;
  if (!count) return;

  const addButton = $("#add-step-tab");
  const available = Math.max(0, tabs.clientWidth - (addButton?.offsetWidth || 0));
  const gap = Math.min(4, available / Math.max(count * 18, 1));
  const basis = Math.min(260, Math.max(0, (available - gap * count) / count));
  const manyTabs = count > 5;
  const activeBasis = manyTabs ? Math.min(280, basis * 1.25) : basis;
  const inactiveBasis = manyTabs && count > 1
    ? Math.max(0, (available - gap * count - activeBasis) / (count - 1))
    : basis;

  tabs.style.setProperty("--step-tab-gap", `${gap}px`);
  tabs.style.setProperty("--step-tab-basis", `${manyTabs ? inactiveBasis : basis}px`);
  tabs.style.setProperty("--step-tab-active-basis", `${activeBasis}px`);
  tabs.classList.toggle("many-tabs", manyTabs);
  tabs.classList.toggle("compressed", basis < 120);
  tabs.classList.toggle("dense", basis < 72);

  const activeTab = $(".step-tab-item.active", tabs);
  const activeLeft = activeTab ? Math.max(0, activeTab.offsetLeft) : 0;
  const activeRight = activeTab ? Math.min(tabs.clientWidth, activeTab.offsetLeft + activeTab.offsetWidth) : 0;
  tabs.style.setProperty("--step-tab-left-line", `${activeLeft}px`);
  tabs.style.setProperty("--step-tab-right-line-left", `${activeRight}px`);
}

function scheduleStepTabsLayout() {
  requestAnimationFrame(updateStepTabsLayout);
}

function isEscalationStep(stepName) {
  return stepName !== "initial";
}

function getOrderedStepNames() {
  return Object.entries(ruleSteps)
    .filter(([, step]) => step.exists)
    .sort(([, first], [, second]) => first.order - second.order)
    .map(([stepName]) => stepName);
}

function getEscalationStepNames() {
  return getOrderedStepNames().filter(isEscalationStep);
}

function getStepNumber(stepName) {
  const index = getOrderedStepNames().indexOf(stepName);
  return index >= 0 ? index + 1 : 0;
}

function updateBreadcrumbTitle() {
  const title = $("#rule-name").value.trim();
  $(".crumb-current").textContent = title || "New Action Rule";
}

function updateCreateState() {
  const hasName = $("#rule-name").value.trim().length > 0;
  const hasActiveAction = Object.values(ruleSteps).some((step) => (
    step.exists && (step.channels.size > 0 || step.incidents.size > 0 || step.actionLabels?.size > 0)
  ))
    || $$(".channel .check-button.active, .incident-channel .check-button.active").length > 0;
  $("#create").disabled = !(hasName && hasActiveAction);
}

function getActiveChannelIds() {
  return $$(".channel")
    .filter((channel) => $(".check-button", channel).classList.contains("active"))
    .map((channel) => channel.dataset.channel);
}

function getActiveIncidentIds() {
  return $$(".incident-channel")
    .filter((channel) => $(".check-button", channel).classList.contains("active"))
    .map((channel) => channel.dataset.incidentChannel);
}

function pluralize(value, forms) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function delayLabel(value) {
  const totalMinutes = Math.max(0, Math.floor(Number(value) || 0));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days) {
    parts.push(`${days} ${pluralize(days, ["день", "дня", "дней"])}`);
  }

  if (hours) {
    parts.push(`${hours} ${pluralize(hours, ["час", "часа", "часов"])}`);
  }

  if (minutes) {
    parts.push(`${minutes} ${pluralize(minutes, ["минута", "минуты", "минут"])}`);
  }

  return parts.length ? parts.join(" ") : "0 минут";
}

function normalizeDelayMinutes(value) {
  const minutes = Math.floor(Number(value) || 0);
  return Math.max(1, minutes);
}

function renderStepSummary(stepName) {
  const summary = $(`[data-step-summary="${stepName}"]`);
  const step = ruleSteps[stepName];
  if (!summary) return;

  const selectedChannels = Array.from(step.channels);
  const selectedIncidents = Array.from(step.incidents);
  const selectedActions = Array.from(step.actionLabels || []);
  if (!selectedChannels.length && !selectedIncidents.length && !selectedActions.length) {
    summary.textContent = "Действия не выбраны";
    return;
  }

  if (selectedActions.length) {
    summary.innerHTML = `<span class="summary-line"><span class="summary-icons">${selectedActions.map((label) => {
      const icon = activeChannelIcons[label];
      return icon ? `<svg class="icon icon-sm" aria-label="${label}"><use href="${icon}"></use></svg>` : "";
    }).join("")}</span></span>`;
    return;
  }

  const notificationIcons = selectedChannels.map((id) => {
    const meta = channelMeta[id];
    return meta ? `<svg class="icon icon-sm" aria-label="${meta.label}"><use href="${meta.icon}"></use></svg>` : "";
  }).join("");
  const incidentIcons = selectedIncidents.map((id) => {
    const meta = incidentMeta[id];
    return meta ? `<svg class="icon icon-sm" aria-label="${meta.label}"><use href="${meta.icon}"></use></svg>` : "";
  }).join("");
  const lines = [];

  if (notificationIcons) {
    lines.push(`<span class="summary-line"><span>Оповещения:</span><span class="summary-icons">${notificationIcons}</span></span>`);
  }

  if (incidentIcons) {
    lines.push(`<span class="summary-line"><span>Инциденты:</span><span class="summary-icons">${incidentIcons}</span></span>`);
  }

  summary.innerHTML = lines.join("");
}

function updateStepSummaries() {
  getOrderedStepNames().forEach(renderStepSummary);
}

function updateStepName(stepName) {
  const step = ruleSteps[stepName];
  const stepNumber = getStepNumber(stepName);
  const label = $(`[data-step-label="${stepName}"]`);
  const cardTitle = $(`[data-step-card-title="${stepName}"]`);
  if (label) label.textContent = step.name;
  if (cardTitle && cardTitle.dataset.editing !== "true") {
    cardTitle.textContent = `Шаг ${stepNumber}: ${step.name}`;
  }
  $$(`[data-rename-step="${stepName}"]`).forEach((button) => {
    button.setAttribute("aria-label", `Переименовать этап ${step.name}`);
  });
  $$(`[data-delete-step="${stepName}"]`).forEach((button) => {
    button.setAttribute("aria-label", `Удалить шаг ${step.name}`);
  });
}

function updateStepNames() {
  getOrderedStepNames().forEach(updateStepName);
  renderActiveStepBar();
}

function renameStep(stepName) {
  const step = ruleSteps[stepName];
  const cardTitle = $(`[data-step-card-title="${stepName}"]`);
  if (!step || !cardTitle) return;

  const existingInput = $(".step-name-input", cardTitle);
  if (existingInput) {
    existingInput.focus();
    existingInput.select();
    return;
  }

  const stepNumber = getStepNumber(stepName);
  const originalName = step.name;
  const prefix = document.createElement("span");
  const input = document.createElement("input");
  let finished = false;

  prefix.className = "step-name-prefix";
  prefix.textContent = `Шаг ${stepNumber}:`;
  input.className = "step-name-input";
  input.type = "text";
  input.value = originalName;
  input.setAttribute("aria-label", "Название этапа");

  cardTitle.dataset.editing = "true";
  cardTitle.classList.add("editing");
  cardTitle.textContent = "";
  cardTitle.append(prefix, input);

  function finishEditing(commit) {
    if (finished) return;
    finished = true;

    const nextName = input.value.trim();
    delete cardTitle.dataset.editing;
    cardTitle.classList.remove("editing");

    if (commit && nextName) {
      step.name = nextName;
    } else if (commit && !nextName) {
      showToast("Название этапа не может быть пустым");
    }

    updateStepName(stepName);
    scheduleStepTabsLayout();
  }

  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("mousedown", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finishEditing(true);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      finishEditing(false);
    }
  });
  input.addEventListener("blur", () => finishEditing(true));

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function persistCurrentStep() {
  const step = ruleSteps[currentStep];
  if (!step) return;
  step.channels = new Set(getActiveChannelIds());
  step.incidents = new Set(getActiveIncidentIds());
  step.recovery = $("#recovery").checked;
  step.delayEnabled = $("#delay-enabled").checked;
  step.delayMinutes = normalizeDelayMinutes($("#delay-minutes").value);
  updateStepDelayBadge(currentStep);
  updateStepSummaries();
  updateCreateState();
}

function updateStepDelayBadge(stepName) {
  const step = ruleSteps[stepName];
  const badge = $(`[data-step-delay-badge="${stepName}"]`);
  if (!step || !badge) return;

  badge.textContent = step.delayEnabled ? `Через ${delayLabel(step.delayMinutes)}` : "Сейчас";
  badge.classList.toggle("delayed", step.delayEnabled);
}

function syncDelayUi() {
  const delay = ruleSteps[currentStep];
  $("#delay-enabled").checked = delay.delayEnabled;
  $("#delay-minutes").value = delay.delayMinutes;
  $("#delay-minutes").disabled = !delay.delayEnabled;
  $("#delay-input").hidden = !delay.delayEnabled;
  $$("[data-delay-step]").forEach((button) => {
    button.disabled = !delay.delayEnabled;
  });
  updateStepDelayBadge(currentStep);
}

function syncStepNavigation() {
  $$(".step-tab").forEach((tab) => {
    const isActive = tab.dataset.stepTab === currentStep;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  $$(".step-tab-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.stepTabWrap === currentStep);
  });

  $$(".step-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.stepCard === currentStep);
  });
  scheduleStepTabsLayout();
}

function applyStepState(stepName) {
  const step = ruleSteps[stepName];
  $$(".channel").forEach((channel) => {
    const button = $(".check-button", channel);
    const active = step.channels.has(channel.dataset.channel);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$(".incident-channel").forEach((channel) => {
    const button = $(".check-button", channel);
    const active = step.incidents.has(channel.dataset.incidentChannel);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#recovery").checked = step.recovery;
  syncStepNavigation();
  syncDelayUi();
  syncChannelSettings();
  syncIncidentChannels();
  updateStepSummaries();
  updateCreateState();
}

function bindStepTab(button) {
  button.addEventListener("click", () => setCurrentStep(button.dataset.stepTab));
}

function bindStepCard(card) {
  card.addEventListener("click", () => setCurrentStep(card.dataset.stepCard));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setCurrentStep(card.dataset.stepCard);
    }
  });
}

function bindRenameButton(button) {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    renameStep(button.dataset.renameStep);
  });
  button.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });
}

function bindDeleteButton(button) {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    openDeleteStepModal(button.dataset.deleteStep);
  });
  button.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });
}

function createEscalationState() {
  escalationId += 1;
  stepOrder += 1;

  const stepName = `escalation-${escalationId}`;
  ruleSteps[stepName] = {
    exists: true,
    name: escalationId === 1 ? "Эскалация" : `Эскалация ${escalationId}`,
    channels: new Set(),
    incidents: new Set(),
    actionLabels: new Set(),
    actionSettings: {},
    activeActionLabel: "",
    recovery: false,
    delayEnabled: false,
    delayMinutes: 60,
    order: stepOrder
  };

  return stepName;
}

function renderEscalationTab(stepName) {
  const tabWrap = document.createElement("span");
  tabWrap.className = "step-tab-item";
  tabWrap.dataset.stepTabWrap = stepName;
  tabWrap.innerHTML = `
    <button class="step-tab" type="button" role="tab" aria-selected="false" data-step-tab="${stepName}">
      <span data-step-label="${stepName}"></span>
    </button>
    <button class="delete-step" type="button" data-delete-step="${stepName}">
      <svg class="icon icon-sm"><use href="#i-close"></use></svg>
    </button>
  `;

  $("#add-step-tab").before(tabWrap);
  bindStepTab($(".step-tab", tabWrap));
  bindDeleteButton($(".delete-step", tabWrap));
  scheduleStepTabsLayout();
}

function renderEscalationCard(stepName) {
  const card = document.createElement("div");
  card.className = "step-card";
  card.setAttribute("role", "button");
  card.tabIndex = 0;
  card.dataset.stepCard = stepName;
  card.innerHTML = `
    <span class="step-card-head">
      <span class="step-dot"></span>
      <span class="step-card-title" data-step-card-title="${stepName}"></span>
      <span class="step-card-actions">
        <button class="card-rename-step" type="button" data-rename-step="${stepName}">
          <svg class="icon icon-sm"><use href="#i-pencil"></use></svg>
        </button>
        <span class="step-badge" data-step-delay-badge="${stepName}">Сейчас</span>
      </span>
    </span>
    <span class="step-summary" data-step-summary="${stepName}">Действия не выбраны</span>
  `;

  $(".step-cards").append(card);
  bindStepCard(card);
  bindRenameButton($("[data-rename-step]", card));
}

function renderEscalationStep(stepName) {
  renderEscalationTab(stepName);
  renderEscalationCard(stepName);
  updateStepName(stepName);
  updateStepDelayBadge(stepName);
  renderStepSummary(stepName);
}

function removeStepElements(stepName) {
  $(`[data-step-tab-wrap="${stepName}"]`)?.remove();
  $(`[data-step-card="${stepName}"]`)?.remove();
  scheduleStepTabsLayout();
}

function setCurrentStep(stepName) {
  if (!ruleSteps[stepName] || !ruleSteps[stepName].exists) return;

  if (stepName === currentStep) {
    applyStepState(stepName);
    applyActionTogglesForStep(stepName);
    renderActiveStepBar();
    return;
  }
  persistCurrentStep();
  persistCurrentActionToggles();
  currentStep = stepName;
  applyStepState(stepName);
  applyActionTogglesForStep(stepName);
  renderActiveStepBar();
}

function addEscalationStep() {
  persistCurrentActionToggles();
  const stepName = createEscalationState();
  renderEscalationStep(stepName);
  updateStepNames();
  setCurrentStep(stepName);
  showToast("Добавлен шаг эскалации");
}

function closeDeleteStepModal() {
  stepPendingDelete = null;
  $("#delete-step-modal").hidden = true;
}

function openDeleteStepModal(stepName) {
  if (stepName === "initial") {
    showToast("Вкладку Начальные действия удалить нельзя");
    return;
  }

  if (!ruleSteps[stepName] || !ruleSteps[stepName].exists) return;

  stepPendingDelete = stepName;
  $("#delete-step-modal").hidden = false;
  $("#delete-step-cancel").focus();
}

function deleteStep(stepName) {
  if (stepName === "initial") {
    showToast("Вкладку Начальные действия удалить нельзя");
    return;
  }

  if (!ruleSteps[stepName] || !ruleSteps[stepName].exists) return;

  if (currentStep !== stepName) {
    persistCurrentStep();
    persistCurrentActionToggles();
  }

  if (currentStep === stepName) {
    currentStep = "initial";
  }

  removeStepElements(stepName);
  delete ruleSteps[stepName];
  updateStepNames();
  applyStepState(currentStep);
  applyActionTogglesForStep(currentStep);
  renderActiveStepBar();
  syncChannelSettings();
  updateCreateState();
  showToast("Шаг эскалации удален");
}

function syncChannelSettings() {
  const showSettings = $("#make-default").checked && $(".group-field")?.dataset.selected === "true";
  $$(".channel").forEach((channel) => {
    const active = $(".check-button", channel).classList.contains("active");
    channel.dataset.active = String(active);
    $$(".channel-options, .select-wrap", channel).forEach((node) => {
      const visible = showSettings && active;
      node.hidden = !visible;
      if (!visible) node.classList.remove("open");
    });
  });
}

function syncIncidentChannels() {
  $$(".incident-channel").forEach((channel) => {
    const active = $(".check-button", channel).classList.contains("active");
    const settings = $(".incident-settings", channel);
    if (settings) {
      settings.hidden = !active;
      if (!active) {
        $$(".select-wrap.open", settings).forEach((select) => select.classList.remove("open"));
      }
    }
  });
}

function setCurrentTab(name) {
  $$(".tab").forEach((tab) => {
    const isActive = tab.dataset.tab === name;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  $$(".panel-section").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });
}

const channelExtraSettings = {
  "Центр Уведомлений": {
    placeholder: "Получатели из группы"
  },
  "E-mail": {
    options: ["Выбрать из списка", "Ввести адрес"],
    placeholder: "E-mail или список рассылки"
  },
  "Telegram": {
    options: ["Выбрать из списка", "Ввести ID"],
    placeholder: "Telegram ID группового чата"
  },
  "Команда": {
    options: ["Выбрать из списка", "Ввести ID"],
    placeholder: "Team ID группового чата"
  },
  "SMS": {
    placeholder: "Телефон или дежурный контакт"
  }
};

const activeChannelIcons = {
  "Центр Уведомлений": "#i-bell",
  "E-mail": "#i-mail",
  "Telegram": "#i-send",
  "Команда": "#i-users",
  "SMS": "#i-message",
  "Сфера Инциденты": "#i-incident",
  "Сфера Аварии": "#i-outage"
};

function ensureStepActionState(stepName = currentStep) {
  const step = ruleSteps[stepName];
  if (step && !step.actionLabels) {
    step.actionLabels = new Set();
  }
  if (step && !step.actionSettings) {
    step.actionSettings = {};
  }
  if (step && typeof step.activeActionLabel !== "string") {
    step.activeActionLabel = "";
  }
  return step;
}

function getActionSettings(label, stepName = currentStep) {
  const step = ensureStepActionState(stepName);
  if (!step || !label) return null;

  if (!step.actionSettings[label]) {
    step.actionSettings[label] = {
      recovery: false,
      delayEnabled: false,
      delayMinutes: 60
    };
  }

  return step.actionSettings[label];
}

function getActiveActionLabels() {
  return $$("[data-channel-toggle]")
    .filter((toggle) => toggle.checked)
    .map((toggle) => toggle.dataset.activeLabel);
}

function isEscalationEnabled() {
  return Boolean($("#escalation-enabled")?.checked);
}

function getCurrentActionLabels() {
  if (isEscalationEnabled()) {
    return Array.from(ensureStepActionState()?.actionLabels || []);
  }

  return getActiveActionLabels();
}

function getActiveActionLabel() {
  const step = ensureStepActionState();
  const labels = getCurrentActionLabels();
  if (!isEscalationEnabled()) return null;

  if (!step.activeActionLabel || !step.actionLabels.has(step.activeActionLabel)) {
    step.activeActionLabel = labels[0] || "";
  }

  return step.activeActionLabel || null;
}

function persistCurrentActionToggles() {
  const step = ensureStepActionState();
  if (!step) return;
  step.actionLabels = new Set(getActiveActionLabels());
}

function applyActionTogglesForStep(stepName = currentStep) {
  const step = ensureStepActionState(stepName);
  const selected = step?.actionLabels || new Set();

  $$("[data-channel-toggle]").forEach((toggle) => {
    toggle.checked = selected.has(toggle.dataset.activeLabel);
  });
  syncActionPickerUi();
  renderActiveActionTabs();
  renderActiveActionDelayControl();
  renderActiveChannelList();
}

function syncActionPickerUi() {
  const selected = new Set(getCurrentActionLabels());
  $$("[data-action-choice]").forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function renderActiveActionTabs() {
  const tabs = $("#active-action-tabs");
  if (!tabs) return;

  const labels = getCurrentActionLabels();
  const activeLabel = getActiveActionLabel();
  tabs.hidden = !isEscalationEnabled() || labels.length === 0;
  tabs.innerHTML = labels
    .map((label) => {
      const icon = activeChannelIcons[label];
      const active = label === activeLabel ? " active" : "";
      return `
        <button class="active-action-tab${active}" type="button" data-action-tab="${label}">
          ${icon ? `<svg class="icon icon-sm"><use href="${icon}"></use></svg>` : ""}
          <span>${label}</span>
        </button>
      `;
    })
    .join("");
}

function getVisibleActionLabels() {
  if (isEscalationEnabled()) {
    const activeLabel = getActiveActionLabel();
    return activeLabel ? [activeLabel] : [];
  }

  return getCurrentActionLabels();
}

function renderActiveActionDelayControl() {
  const container = $("#active-action-delay");
  if (!container) return;

  const activeLabel = getActiveActionLabel();
  const step = ensureStepActionState();
  container.hidden = !isEscalationEnabled() || !activeLabel;
  if (!activeLabel || !step) {
    container.innerHTML = "";
    return;
  }

  const delayInput = step.delayEnabled
    ? `
      <div class="active-delay-input">
        <span class="delay-input-label">Минуты</span>
        <div class="delay-stepper">
          <button class="delay-stepper-button" type="button" aria-label="Уменьшить задержку" data-active-delay-step="-1">-</button>
          <span class="delay-divider" aria-hidden="true"></span>
          <input type="text" data-active-delay-minutes value="${step.delayMinutes}" inputmode="numeric" pattern="[0-9]*" aria-label="Количество минут задержки">
          <span class="delay-divider" aria-hidden="true"></span>
          <button class="delay-stepper-button" type="button" aria-label="Увеличить задержку" data-active-delay-step="1">+</button>
        </div>
      </div>
    `
    : "";

  container.innerHTML = `
    <label class="active-option-row">
      <span class="switch">
        <span class="sr-only">Отложенное реагирование</span>
        <input type="checkbox" data-active-delay-enabled ${step.delayEnabled ? "checked" : ""}>
        <span class="switch-track"></span>
      </span>
      <span>Отложенное реагирование</span>
    </label>
    ${delayInput}
  `;
}

function renderChannelExtra(label, showSettings) {
  const settings = channelExtraSettings[label];
  if (!showSettings || !settings) return "";

  const options = settings.options
    ? `<div class="channel-extra-options" aria-label="Режим ввода">${settings.options.map((option, index) => (
      `<button class="tiny-pill${index === 0 ? " active" : ""}" type="button">${option}</button>`
    )).join("")}</div>`
    : "";

  return `
    <div class="channel-extra">
      <div class="channel-extra-field${options ? " has-options" : ""}">
        <input class="channel-extra-input" type="text" placeholder="${settings.placeholder}" autocomplete="off">
        ${options}
      </div>
    </div>
  `;
}

function renderSphereIncidentFields(label) {
  if (label !== "Сфера Инциденты") return "";

  return `
    <div class="incident-settings active-incident-settings">
      <div class="incident-field">
        <div class="incident-field-label">Уровень инцидента</div>
        <div class="incident-levels" role="radiogroup" aria-label="Уровень инцидента">
          <button class="radio-option active" type="button" role="radio" aria-checked="true">
            <span class="radio-mark"></span>
            Деградация
          </button>
          <button class="radio-option" type="button" role="radio" aria-checked="false">
            <span class="radio-mark"></span>
            Низкий
          </button>
          <button class="radio-option" type="button" role="radio" aria-checked="false">
            <span class="radio-mark"></span>
            Средний
          </button>
          <button class="radio-option" type="button" role="radio" aria-checked="false">
            <span class="radio-mark"></span>
            Высокий
          </button>
          <button class="radio-option" type="button" role="radio" aria-checked="false">
            <span class="radio-mark"></span>
            Критичный
          </button>
        </div>
      </div>

      <div class="incident-fields-grid">
        <div class="incident-field">
          <div class="incident-field-label">ИТ Система<span class="required">*</span></div>
          <div class="select-wrap incident-required">
            <button class="select-button" type="button" aria-required="true">
              <span class="select-value">Выберите ИТ Систему</span>
              <svg class="icon icon-sm"><use href="#i-chevron"></use></svg>
            </button>
            <div class="menu">
              <button type="button" data-value="PostgreSQL Linux">PostgreSQL Linux</button>
              <button type="button" data-value="Платформа мониторинга">Платформа мониторинга</button>
              <button type="button" data-value="Биллинг">Биллинг</button>
              <button type="button" data-value="Клиентский портал">Клиентский портал</button>
              <button type="button" data-value="Data Platform">Data Platform</button>
            </div>
          </div>
        </div>

        <div class="incident-field">
          <div class="incident-field-label">Рабочая группа<span class="required">*</span></div>
          <div class="select-wrap incident-required">
            <button class="select-button" type="button" aria-required="true">
              <span class="select-value">Выберите рабочую группу</span>
              <svg class="icon icon-sm"><use href="#i-chevron"></use></svg>
            </button>
            <div class="menu">
              <button type="button" data-value="Администраторы PostgreSQL">Администраторы PostgreSQL</button>
              <button type="button" data-value="SRE PostgreSQL">SRE PostgreSQL</button>
              <button type="button" data-value="DBA Core">DBA Core</button>
              <button type="button" data-value="Инцидент-менеджеры">Инцидент-менеджеры</button>
              <button type="button" data-value="Service Desk L2">Service Desk L2</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderActiveChannelItem({ label, showExtra }) {
  const icon = activeChannelIcons[label];

  return `
    <div class="active-channel-item">
      <div class="active-channel-title">
        ${icon ? `<svg class="icon"><use href="${icon}"></use></svg>` : ""}
        <span>${label}</span>
      </div>
      ${renderChannelExtra(label, showExtra)}
      ${renderSphereIncidentFields(label)}
    </div>
  `;
}

function syncLegacyStepControls() {
  const step = ensureStepActionState();
  if (!step) return;

  const activeSettings = getActionSettings(getActiveActionLabel());
  $("#recovery").checked = activeSettings?.recovery || step.recovery;
  $("#delay-enabled").checked = step.delayEnabled;
  $("#delay-minutes").value = step.delayMinutes;
  syncDelayUi();
}

function renderActiveRecoveryOption({ hasNotifications }) {
  const settings = getActionSettings(getActiveActionLabel());
  if (!settings || !hasNotifications) return "";

  return `
    <div class="active-step-options active-recovery-options">
      <label class="active-option-row">
        <span class="switch">
          <span class="sr-only">Получать recovery-события</span>
          <input type="checkbox" data-active-recovery ${settings.recovery ? "checked" : ""}>
          <span class="switch-track"></span>
        </span>
        <span>Получать recovery-события</span>
      </label>
    </div>
  `;
}

function renderActiveChannelList() {
  const list = $("#active-channel-list");
  if (!list) return;
  const showSettings = $("#make-default").checked && $(".group-field")?.dataset.selected === "true";

  const activeToggles = getVisibleActionLabels()
    .map((label) => ({
      label,
      showExtra: showSettings && Boolean(channelExtraSettings[label])
    }));

  list.hidden = activeToggles.length === 0;

  const notificationItems = activeToggles.filter((item) => channelExtraSettings[item.label]);
  const sphereItems = activeToggles.filter((item) => !channelExtraSettings[item.label]);
  const step = ensureStepActionState();
  if (step && !notificationItems.length) step.recovery = false;
  if (step && !activeToggles.length) step.delayEnabled = false;
  updateStepDelayBadge(currentStep);
  syncLegacyStepControls();

  const divider = notificationItems.length && sphereItems.length
    ? '<div class="active-channel-divider" aria-hidden="true"></div>'
    : "";

  list.innerHTML = [
    ...notificationItems.map(renderActiveChannelItem),
    renderActiveRecoveryOption({
      hasNotifications: notificationItems.length > 0
    }),
    divider,
    ...sphereItems.map(renderActiveChannelItem)
  ].join("");
}

function syncChannelToggleSettings() {
  syncActionPickerUi();
  renderActiveActionTabs();
  renderActiveActionDelayControl();
  renderActiveChannelList();
}

function renderActiveStepBar() {
  const bar = $("#active-step-bar");
  if (!bar) return;

  const enabled = $("#escalation-enabled")?.checked;
  bar.hidden = !enabled;
  if (!enabled) {
    bar.innerHTML = "";
    return;
  }

  const stepButtons = getOrderedStepNames().map((stepName) => {
    const step = ruleSteps[stepName];
    const stepNumber = getStepNumber(stepName);
    const label = stepName === "initial" ? "Шаг 1: Начальные действия" : `Шаг ${stepNumber}: ${step.name}`;
    const active = stepName === currentStep ? " active" : "";
    return `<button class="active-step-pill${active}" type="button" data-left-step="${stepName}">${label}</button>`;
  }).join("");

  bar.innerHTML = `
    <div class="active-step-pills">${stepButtons}</div>
    <button class="active-step-add" type="button" data-left-add-step aria-label="Добавить шаг эскалации">
      <svg class="icon icon-sm"><use href="#i-plus"></use></svg>
    </button>
  `;
}

function resetEscalationSteps() {
  persistCurrentActionToggles();
  getEscalationStepNames().forEach((stepName) => {
    removeStepElements(stepName);
    delete ruleSteps[stepName];
  });
  escalationId = 0;
  stepOrder = 0;
  currentStep = "initial";
  updateStepNames();
  applyStepState("initial");
  applyActionTogglesForStep("initial");
}

function syncEscalationUi() {
  const enabled = $("#escalation-enabled")?.checked;
  $(".step-cards").hidden = !enabled;
  $("#add-escalation").hidden = !enabled;
  $(".action-channel-toggles").hidden = enabled;
  $("#active-action-area").hidden = !enabled;

  if (!enabled) {
    $("#action-picker-menu").hidden = true;
    $("#active-action-delay").hidden = true;
    resetEscalationSteps();
  } else {
    persistCurrentActionToggles();
  }
  renderActiveStepBar();
  syncActionPickerUi();
  renderActiveActionTabs();
  renderActiveActionDelayControl();
  renderActiveChannelList();
}

$$(".nav, .brand").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.classList.contains("nav")) {
      $$(".nav").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    }
    showToast(button.title || button.dataset.toast || "Раздел открыт");
  });
});

$$(".segment").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".segment").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    showToast(button.dataset.mode === "advanced" ? "Включен продвинутый режим" : "Включен базовый режим");
  });
});

$$(".tab").forEach((button) => {
  button.addEventListener("click", () => setCurrentTab(button.dataset.tab));
});

$$(".step-tab").forEach((button) => {
  button.addEventListener("click", () => setCurrentStep(button.dataset.stepTab));
});

$$(".step-card").forEach((button) => {
  button.addEventListener("click", () => setCurrentStep(button.dataset.stepCard));
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setCurrentStep(button.dataset.stepCard);
    }
  });
});

$$("[data-rename-step]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    renameStep(button.dataset.renameStep);
  });
  button.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });
});

$$("[data-delete-step]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    openDeleteStepModal(button.dataset.deleteStep);
  });
  button.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });
});

$("#add-escalation")?.addEventListener("click", addEscalationStep);
$("#add-step-tab").addEventListener("click", addEscalationStep);

$$(".check-button").forEach((button) => {
  button.addEventListener("click", () => {
    const active = !button.classList.contains("active");
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    syncChannelSettings();
    syncIncidentChannels();
    persistCurrentStep();
    updateStepSummaries();
    updateCreateState();
  });
});

$$("[data-mode-pill]").forEach((button) => {
  button.addEventListener("click", () => {
    const group = button.closest(".channel-options");
    $$(".tiny-pill", group).forEach((pill) => pill.classList.remove("active"));
    button.classList.add("active");
    const select = button.closest(".channel").querySelector(".select-value");
    if (button.textContent.includes("адрес")) {
      select.textContent = "Введите групповой адрес";
    } else {
      const channelName = button.closest(".channel").querySelector(".channel-title > span").textContent;
      select.textContent = channelName === "Telegram"
        ? "Выберите получателей из списка или введите Telegram ID группового чата"
        : "Выберите получателей из списка";
    }
  });
});

$$(".select-button").forEach((button) => {
  button.addEventListener("click", (event) => {
    const wrap = button.closest(".select-wrap");
    closeMenus(wrap);
    wrap.classList.toggle("open");
    event.stopPropagation();
  });
});

$$(".select-wrap .menu button").forEach((button) => {
  button.addEventListener("click", () => {
    const wrap = button.closest(".select-wrap");
    const value = button.dataset.value || button.textContent.trim();
    const display = $(".select-value", wrap);
    const groupValue = $(".group-value", wrap);
    if (groupValue) {
      groupValue.textContent = value;
    } else if (display) {
      display.textContent = value;
    }
    wrap.dataset.selected = "true";
    wrap.classList.remove("open");
    syncChannelSettings();
    syncChannelToggleSettings();
    persistCurrentStep();
    updateCreateState();
  });
});

$$("[data-menu-trigger]").forEach((button) => {
  button.addEventListener("click", (event) => {
    const dropdown = button.closest(".dropdown");
    closeMenus(dropdown);
    dropdown.classList.toggle("open");
    event.stopPropagation();
  });
});

$$("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    $("#rule-name").value = button.textContent.trim();
    button.closest(".dropdown").classList.remove("open");
    showToast("Шаблон применен");
    updateBreadcrumbTitle();
    updateCreateState();
  });
});

$$("[data-add-chip]").forEach((button) => {
  button.addEventListener("click", () => {
    const chip = document.createElement("button");
    chip.className = "filter-chip";
    chip.type = "button";
    chip.dataset.filterChip = "";
    chip.innerHTML = '<span class="chip-x">×</span>' + button.dataset.addChip + '<svg class="icon icon-sm"><use href="#i-chevron"></use></svg>';
    $("#filter-row").insertBefore(chip, $(".filter-search"));
    chip.addEventListener("click", removeChip);
    button.closest(".dropdown").classList.remove("open");
  });
});

function removeChip(event) {
  event.currentTarget.remove();
  showToast("Фильтр удален");
}

$$("[data-filter-chip]").forEach((chip) => chip.addEventListener("click", removeChip));

$("#clear-filters").addEventListener("click", () => {
  $$("[data-filter-chip]").forEach((chip) => chip.remove());
  $("#filter-name").value = "";
  showToast("Фильтры очищены");
});

$("#toggle-filter").addEventListener("click", () => {
  const row = $("#filter-row");
  row.hidden = !row.hidden;
  $("#toggle-filter").firstChild.textContent = row.hidden
    ? "Показать фильтр в Консоли событий"
    : "Открыть фильтр в Консоли событий";
});

$$("[data-clear]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = $(button.dataset.clear);
    input.value = "";
    input.focus();
    if (input.id === "rule-name") updateBreadcrumbTitle();
    updateCreateState();
  });
});

$("#rule-name").addEventListener("input", () => {
  updateBreadcrumbTitle();
  updateCreateState();
});
$("#recovery").addEventListener("change", persistCurrentStep);

$("#delay-enabled").addEventListener("change", () => {
  persistCurrentStep();
  syncDelayUi();
});

$("#delay-minutes").addEventListener("input", () => {
  $("#delay-minutes").value = $("#delay-minutes").value.replace(/\D/g, "");
  ruleSteps[currentStep].delayMinutes = normalizeDelayMinutes($("#delay-minutes").value);
  persistCurrentStep();
  syncDelayUi();
});

$$("[data-delay-step]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextValue = normalizeDelayMinutes($("#delay-minutes").value) + Number(button.dataset.delayStep);
    $("#delay-minutes").value = normalizeDelayMinutes(nextValue);
    persistCurrentStep();
    syncDelayUi();
  });
});

$$(".radio-option").forEach((button) => {
  button.addEventListener("click", () => {
    const group = button.closest('[role="radiogroup"]') || document;
    $$(".radio-option", group).forEach((option) => {
      const active = option === button;
      option.classList.toggle("active", active);
      option.setAttribute("aria-checked", String(active));
    });
  });
});

function syncDefaultField() {
  const group = $(".group-field");
  const enabled = $("#make-default").checked;
  group.hidden = !enabled;
  if (!enabled) {
    $(".group-value").textContent = "";
    delete group.dataset.selected;
    group.classList.remove("open");
  }
}

$("#make-default").addEventListener("change", () => {
  syncDefaultField();
  syncChannelSettings();
  syncChannelToggleSettings();
});

$$("[data-channel-toggle]").forEach((toggle) => {
  toggle.addEventListener("change", () => {
    persistCurrentActionToggles();
    syncChannelToggleSettings();
  });
});

$("#escalation-enabled").addEventListener("change", syncEscalationUi);

$("#active-step-bar").addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-left-add-step]");
  if (addButton) {
    addEscalationStep();
    return;
  }

  const stepButton = event.target.closest("[data-left-step]");
  if (stepButton) {
    setCurrentStep(stepButton.dataset.leftStep);
  }
});

$("#add-action-trigger").addEventListener("click", (event) => {
  syncActionPickerUi();
  $("#action-picker-menu").hidden = !$("#action-picker-menu").hidden;
  event.stopPropagation();
});

$("#apply-actions").addEventListener("click", () => {
  const step = ensureStepActionState();
  if (!step) return;

  step.actionLabels = new Set(
    $$("[data-action-choice]")
      .filter((input) => input.checked)
      .map((input) => input.value)
  );
  if (!step.actionLabels.has(step.activeActionLabel)) {
    step.activeActionLabel = Array.from(step.actionLabels)[0] || "";
  }
  applyActionTogglesForStep(currentStep);
  updateStepSummaries();
  updateCreateState();
  $("#action-picker-menu").hidden = true;
});

$("#active-action-tabs").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-action-tab]");
  if (!tab) return;

  ensureStepActionState().activeActionLabel = tab.dataset.actionTab;
  renderActiveActionTabs();
  renderActiveActionDelayControl();
  renderActiveChannelList();
});

$("#delete-step-cancel").addEventListener("click", closeDeleteStepModal);

$("#delete-step-confirm").addEventListener("click", () => {
  const stepName = stepPendingDelete;
  closeDeleteStepModal();
  deleteStep(stepName);
});

$("#delete-step-modal").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) {
    closeDeleteStepModal();
  }
});

$("#cancel").addEventListener("click", () => {
  closeMenus();
  $("#rule-name").value = "PostgreSQL Linux";
  updateBreadcrumbTitle();
  $("#filter-name").value = "Processor";
  $("#make-default").checked = false;
  $("#escalation-enabled").checked = false;
  syncDefaultField();
  syncEscalationUi();
  ruleSteps.initial.channels.clear();
  ruleSteps.initial.incidents.clear();
  ruleSteps.initial.actionLabels.clear();
  ruleSteps.initial.actionSettings = {};
  ruleSteps.initial.activeActionLabel = "";
  ruleSteps.initial.recovery = false;
  ruleSteps.initial.delayEnabled = false;
  ruleSteps.initial.delayMinutes = 60;
  ruleSteps.initial.name = "Начальные действия";
  getEscalationStepNames().forEach((stepName) => {
    removeStepElements(stepName);
    delete ruleSteps[stepName];
  });
  escalationId = 0;
  stepOrder = 0;
  currentStep = "initial";
  updateStepNames();
  $$(".select-wrap").forEach((wrap) => delete wrap.dataset.selected);
  $$(".check-button").forEach((button) => {
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
  });
  $$("[data-channel-toggle]").forEach((toggle) => {
    toggle.checked = false;
  });
  renderActiveChannelList();
  syncChannelToggleSettings();
  $("#recovery").checked = false;
  applyStepState("initial");
  syncChannelSettings();
  syncIncidentChannels();
  updateCreateState();
  showToast("Изменения отменены");
});

$("#create").addEventListener("click", () => {
  showToast("Правило создано: " + $("#rule-name").value.trim());
});

$$("[data-toast]").forEach((button) => {
  button.addEventListener("click", () => showToast(button.dataset.toast));
});

document.addEventListener("click", (event) => {
  const button = event.target.closest(".channel-extra-options .tiny-pill");
  if (!button) return;

  const group = button.closest(".channel-extra-options");
  $$(".tiny-pill", group).forEach((pill) => pill.classList.toggle("active", pill === button));
});

document.addEventListener("click", (event) => {
  const selectButton = event.target.closest(".active-channel-list .select-button");
  if (!selectButton) return;

  const wrap = selectButton.closest(".select-wrap");
  closeMenus(wrap);
  wrap.classList.toggle("open");
  event.stopImmediatePropagation();
});

document.addEventListener("click", (event) => {
  const menuButton = event.target.closest(".active-channel-list .select-wrap .menu button");
  if (!menuButton) return;

  const wrap = menuButton.closest(".select-wrap");
  const value = menuButton.dataset.value || menuButton.textContent.trim();
  $(".select-value", wrap).textContent = value;
  wrap.dataset.selected = "true";
  wrap.classList.remove("open");
  event.stopImmediatePropagation();
});

document.addEventListener("click", (event) => {
  const radio = event.target.closest(".active-channel-list .radio-option");
  if (!radio) return;

  const group = radio.closest('[role="radiogroup"]');
  $$(".radio-option", group).forEach((option) => {
    const active = option === radio;
    option.classList.toggle("active", active);
    option.setAttribute("aria-checked", String(active));
  });
});

document.addEventListener("change", (event) => {
  const recovery = event.target.closest("[data-active-recovery]");
  if (recovery) {
    const settings = getActionSettings(getActiveActionLabel());
    if (settings) settings.recovery = recovery.checked;
    syncLegacyStepControls();
    renderActiveChannelList();
    return;
  }

  const delayEnabled = event.target.closest("[data-active-delay-enabled]");
  if (delayEnabled) {
    ruleSteps[currentStep].delayEnabled = delayEnabled.checked;
    ruleSteps[currentStep].delayMinutes = normalizeDelayMinutes(ruleSteps[currentStep].delayMinutes);
    syncLegacyStepControls();
    updateStepDelayBadge(currentStep);
    renderActiveActionDelayControl();
  }
});

document.addEventListener("input", (event) => {
  const input = event.target.closest("[data-active-delay-minutes]");
  if (!input) return;

  input.value = input.value.replace(/\D/g, "");
  ruleSteps[currentStep].delayMinutes = normalizeDelayMinutes(input.value);
  syncLegacyStepControls();
  updateStepDelayBadge(currentStep);
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-active-delay-step]");
  if (!button) return;

  const nextValue = normalizeDelayMinutes(ruleSteps[currentStep].delayMinutes) + Number(button.dataset.activeDelayStep);
  ruleSteps[currentStep].delayMinutes = normalizeDelayMinutes(nextValue);
  syncLegacyStepControls();
  updateStepDelayBadge(currentStep);
  renderActiveActionDelayControl();
});

$("#action-picker-menu").addEventListener("click", (event) => event.stopPropagation());

document.addEventListener("click", () => {
  $("#action-picker-menu").hidden = true;
  closeMenus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenus();
    closeDeleteStepModal();
  }
});
window.addEventListener("resize", updateStepTabsLayout);
const stepTabsNode = $(".step-tabs");
if (stepTabsNode && "ResizeObserver" in window) {
  new ResizeObserver(updateStepTabsLayout).observe(stepTabsNode);
}

$("#make-default").checked = false;
$("#escalation-enabled").checked = false;
syncDefaultField();
syncEscalationUi();
syncIncidentChannels();
renderActiveChannelList();
syncChannelToggleSettings();
updateBreadcrumbTitle();
updateStepNames();
currentStep = "initial";
applyStepState("initial");
updateStepTabsLayout();
