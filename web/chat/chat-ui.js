import { msgs, pendingRoll } from "./chat-controller.js";
import { character, step, pendingConfirm } from "../onboarding.js";
import { cleanDMText } from "./chat-controller.js";
import { hhmm, escapeHtml, formatMarkdown, now } from "../utils.js";
import { decorateDMs, hydrateSceneJobs } from "../scene-image.js";
import { createChatLoadingManager } from "../ui/loading.js";
import { setRenderCallback } from "./chat-controller.js";
import { setSending as applySending, setConfirmLoading as applyConfirmLoading } from "../ui/helpers.js";

let chatEl = null;
let chatLoadingEl = null;
let chatLoadingManager = null;
let inputEl = null;
let sendBtn = null;
let rollCta = null;
let rollSkillEl = null;
let resolveBtn = null;
let cancelBtn = null;
let firstRenderDone = false;
let chatLoading = true;

const chatUIState = { sending: false, confirmLoading: false };
const deps = { updateIdentityFromState: () => {}, handleConfirmDecision: () => {} };

export function initChatUI({ updateIdentityFromState = () => {}, handleConfirmDecision = () => {} } = {}) {
  chatEl = document.getElementById('chat');
  chatLoadingEl = document.getElementById('chat-loading');
  inputEl = document.getElementById('input');
  sendBtn = document.getElementById('send');
  rollCta = document.getElementById('roll-cta');
  rollSkillEl = document.getElementById('roll-skill');
  resolveBtn = document.getElementById('resolve-btn');
  cancelBtn = document.getElementById('cancel-btn');

  deps.updateIdentityFromState = updateIdentityFromState;
  deps.handleConfirmDecision = handleConfirmDecision;

  chatLoadingManager = createChatLoadingManager({ chatEl, overlayEl: chatLoadingEl });

  setRenderCallback(renderChat);
  window.render = renderChat;
  window.updatePlaceholder = updatePlaceholder;
}

export function getChatElements() {
  return { chatEl, inputEl, sendBtn, rollCta, rollSkillEl, resolveBtn, cancelBtn };
}

export function readInputValue() {
  return inputEl?.value || '';
}

export function clearInputValue() {
  if (inputEl) inputEl.value = '';
}

export function focusInput() {
  inputEl?.focus();
}

export function setChatLoading(on) {
  chatLoading = !!on;
  chatLoadingManager?.set(chatLoading);
}

export function isChatLoading() {
  return chatLoadingManager?.get?.() ?? chatLoading;
}

function scrollChatToBottom({ smooth = false } = {}) {
  if (!chatEl || chatLoading) return;
  const last = chatEl.lastElementChild;
  if (last?.scrollIntoView) {
    last.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' });
  } else {
    chatEl.scrollTop = chatEl.scrollHeight;
  }
}

export function setSending(on) {
  chatUIState.sending = !!on;
  applySending(chatUIState, chatUIState.sending, { sendBtn, inputEl });
}

export function setConfirmLoading(on) {
  chatUIState.confirmLoading = !!on;
  const yes = document.getElementById('confirm-yes-inline');
  const no = document.getElementById('confirm-no-inline');
  applyConfirmLoading(chatUIState, chatUIState.confirmLoading, yes, no);
}

export function updatePlaceholder() {
  const placeholders = {
    name: 'Tu nombre en el HoloNet…',
    species: 'Elige especie… (el Máster te da opciones)',
    role: 'Elige rol… (el Máster te da opciones)',
    done: 'Habla con el Máster… (usa /restart para reiniciar)'
  };
  if (inputEl) {
    const newPlaceholder = placeholders[step] || placeholders.done;
    console.log('[PLACEHOLDER] Setting placeholder for step:', step, '->', newPlaceholder, 'inputEl found:', !!inputEl);
    inputEl.placeholder = newPlaceholder;
    console.log('[PLACEHOLDER] Placeholder set successfully:', inputEl.placeholder);
  } else {
    console.warn('[PLACEHOLDER] inputEl not found!');
  }
}

export function updateRollCta() {
  if (!rollCta || !rollSkillEl) return;
  if (pendingRoll) {
    rollCta.classList.remove('hidden');
    rollSkillEl.textContent = pendingRoll.skill ? ` · ${pendingRoll.skill}` : '';
  } else {
    rollCta.classList.add('hidden');
    rollSkillEl.textContent = '';
  }
}

export function renderChat() {
  console.log('[RENDER] Starting render with:', { msgsCount: msgs.length, step, character: !!character, pendingConfirm });
  let html = msgs.map((m, i) => {
    const kind = (m && m.kind) === 'user' ? 'user' : 'dm';
    const tsSafe = Number(m?.ts) || (Date.now() + i);
    const isUser = (kind === 'user');
    const metaAlign = isUser ? 'text-right' : '';
    const labelUser = m?.user ? escapeHtml(m.user) : (isUser ? escapeHtml(character?.name || 'Tú') : 'Máster');
    const label = labelUser + ':';
    const msgBoxStyle = isUser
      ? 'display:flex; flex-direction:column; align-items:flex-end; width:fit-content; max-width:min(72ch, 92%); margin-left:auto;'
      : 'width:fit-content; max-width:min(72ch, 92%);';
    const textStyle = isUser ? 'text-align:left; width:100%;' : '';
    const timeBoxBase = 'background:none;border:none;box-shadow:none;padding:0;margin-top:2px;';
    const timeBoxStyle = isUser ? timeBoxBase + 'width:fit-content; margin-left:auto;' : timeBoxBase + 'width:fit-content;';

    return `
      <div class="msg ${kind}" data-key="${tsSafe}" style="${msgBoxStyle}">
        <div class="meta ${metaAlign}">${label}</div>
        <div class="text" style="${textStyle}">${formatMarkdown(kind === 'dm' ? cleanDMText(m?.text || '') : (m?.text || ''))}</div>
      </div>
      <div class="msg ${kind}" style="${timeBoxStyle}">
        <div class="meta ${metaAlign}" style="line-height:1;">${hhmm(tsSafe)}</div>
      </div>
    `;
  }).join('');

  if (pendingConfirm) {
    const summary = (pendingConfirm.type === 'name')
      ? `¿Confirmas el nombre: “${escapeHtml(pendingConfirm.name)}”?`
      : `¿Confirmas: ${escapeHtml(pendingConfirm.species)} — ${escapeHtml(pendingConfirm.role)}?`;
    html += `
      <div class="msg dm" style="width:fit-content; max-width:min(72ch, 85%);">
        <div class="meta meta--label">Máster:</div>
        <div class="text">
          <div class="confirm-cta-card">
            <strong>Confirmación:</strong> <span>${summary}</span>
            <div class="roll-cta__actions" style="margin-top:6px">
              <button id="confirm-yes-inline" type="button">Sí</button>
              <button id="confirm-no-inline" type="button" class="outline">No</button>
            </div>
          </div>
        </div>
      </div>
      <div class="msg dm" style="background:none;border:none;box-shadow:none;padding:0;margin-top:2px; width:fit-content;">
        <div class="meta meta--time" style="line-height:1;">${hhmm(now())}</div>
      </div>
    `;
  }

  if (!firstRenderDone) {
    document.getElementById('identity-bar')?.classList.add('hidden');
  }

  requestAnimationFrame(() => {
    if (chatEl) {
      chatEl.innerHTML = html;
      decorateDMs();
      hydrateSceneJobs();
      chatEl.scrollTop = chatEl.scrollHeight;
    }
    deps.updateIdentityFromState?.();

    const yes = document.getElementById('confirm-yes-inline');
    const no = document.getElementById('confirm-no-inline');
    if (yes) yes.onclick = () => deps.handleConfirmDecision?.('yes');
    if (no) no.onclick = () => deps.handleConfirmDecision?.('no');

    scrollChatToBottom({ smooth: firstRenderDone });
    setConfirmLoading(chatUIState.confirmLoading);
    firstRenderDone = true;
  });

  updatePlaceholder();
  updateRollCta();
  setSending(chatUIState.sending);
}

