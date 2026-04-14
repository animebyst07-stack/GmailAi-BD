/* ===== GmailAi BD — Chat / Agent JS ===== */

let chatLoaded = false;

const EXAMPLES = {
  1: `test@gmail.com:MyPass123\nuser2@gmail.com:Qwerty_456\nadmin@gmail.com:Admin_789`,
  2: `Почта: worker@gmail.com\nПароль: Work_pass99\n2FA: JBSWY3DPEHPK3PXP\nСтатус: аппеляция\nЗаметка: куплен 10.01.2025`,
  3: `Обнови аккаунт с email test@gmail.com — поставь статус "продан" и добавь заметку "отгружен клиенту"`
};

async function loadChatHistory() {
  if (chatLoaded) return;
  chatLoaded = true;

  try {
    const history = await fetch('/api/chat/history?limit=40').then(r => r.json());
    const container = document.getElementById('chat-messages');

    if (history.length === 0) return;

    container.innerHTML = '';
    history.forEach(msg => {
      appendMessage(msg.role, msg.content, msg.actions_count, msg.created_at, false);
    });
    scrollChat();
  } catch (e) {
    console.error('Ошибка загрузки истории:', e);
  }
}

function appendMessage(role, content, actionsCount = 0, timestamp = null, animate = true) {
  const container = document.getElementById('chat-messages');

  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const msg = document.createElement('div');
  msg.className = `msg ${role}`;
  if (!animate) msg.style.animation = 'none';

  const avatarContent = role === 'user'
    ? 'Я'
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

  const time = timestamp ? timeAgo(timestamp) : 'сейчас';

  let actionsHtml = '';
  if (role === 'assistant' && actionsCount > 0) {
    actionsHtml = `
      <div class="msg-actions">
        <span class="msg-action-chip added">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${actionsCount} действий
        </span>
      </div>`;
  }

  msg.innerHTML = `
    <div class="msg-avatar">${avatarContent}</div>
    <div>
      <div class="msg-bubble">${escHtmlChat(content)}${actionsHtml}</div>
      <div class="msg-time">${time}</div>
    </div>
  `;

  container.appendChild(msg);
  return msg;
}

function appendActionSummary(msgEl, added, updated, deleted) {
  const bubble = msgEl.querySelector('.msg-bubble');
  if (!bubble || (added === 0 && updated === 0 && deleted === 0)) return;

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'msg-actions';

  if (added > 0) {
    actionsDiv.innerHTML += `
      <span class="msg-action-chip added">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        +${added} добавлено
      </span>`;
  }
  if (updated > 0) {
    actionsDiv.innerHTML += `
      <span class="msg-action-chip updated">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/></svg>
        ${updated} обновлено
      </span>`;
  }
  if (deleted > 0) {
    actionsDiv.innerHTML += `
      <span class="msg-action-chip deleted">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        ${deleted} удалено
      </span>`;
  }

  bubble.appendChild(actionsDiv);
}

function appendTyping() {
  const container = document.getElementById('chat-messages');
  const typing = document.createElement('div');
  typing.className = 'msg assistant chat-typing-wrap';
  typing.id = 'chat-typing';
  typing.innerHTML = `
    <div class="msg-avatar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    </div>
    <div class="typing-dots">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
  `;
  container.appendChild(typing);
  scrollChat();
  return typing;
}

function removeTyping() {
  const t = document.getElementById('chat-typing');
  if (t) t.remove();
}

function scrollChat() {
  const c = document.getElementById('chat-messages');
  c.scrollTop = c.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  const sendBtn = document.getElementById('chat-send-btn');
  sendBtn.disabled = true;
  input.value = '';
  input.style.height = 'auto';

  appendMessage('user', message, 0, null, true);
  const typingEl = appendTyping();
  scrollChat();

  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    removeTyping();

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Неизвестная ошибка' }));
      appendMessage('assistant', err.error || 'Ошибка сервера', 0, null, true);
    } else {
      const data = await resp.json();
      const msgEl = appendMessage('assistant', data.reply, 0, null, true);
      appendActionSummary(msgEl, data.accounts_added, data.accounts_updated, data.accounts_deleted);

      if (data.accounts_added > 0 || data.accounts_updated > 0 || data.accounts_deleted > 0) {
        const total = data.accounts_added + data.accounts_updated + data.accounts_deleted;
        toast(`Агент выполнил ${total} действий в БД`, 'ok');

        if (document.getElementById('page-database').classList.contains('active')) {
          setTimeout(loadAccounts, 300);
        }
        if (document.getElementById('page-dashboard').classList.contains('active')) {
          setTimeout(loadDashboard, 300);
        }
      }
    }
  } catch (e) {
    removeTyping();
    appendMessage('assistant', `Ошибка соединения: ${e.message}`, 0, null, true);
  } finally {
    sendBtn.disabled = false;
    scrollChat();
    input.focus();
  }
}

function chatKeydown(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendChatMessage();
  }
  const ta = e.target;
  setTimeout(() => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
  }, 0);
}

function fillExample(num) {
  const input = document.getElementById('chat-input');
  input.value = EXAMPLES[num] || '';
  input.focus();
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
}

async function clearChat() {
  if (!confirm('Очистить всю историю чата?')) return;
  try {
    await fetch('/api/chat/history', { method: 'DELETE' });
    document.getElementById('chat-messages').innerHTML = `
      <div class="chat-welcome">
        <div class="welcome-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <h3>Gmail ИИ Агент</h3>
        <p>Вставь сюда сырой текст с аккаунтами — логи, выгрузки из магазинов, заметки в любом формате. Агент автоматически структурирует данные и занесёт их в базу.</p>
        <div class="welcome-examples">
          <div class="example-chip" onclick="fillExample(1)">Пример: email:пароль</div>
          <div class="example-chip" onclick="fillExample(2)">Пример: многострочный</div>
          <div class="example-chip" onclick="fillExample(3)">Пример: изменить статус</div>
        </div>
      </div>`;
    chatLoaded = false;
    toast('История очищена', 'ok');
  } catch (e) {
    toast('Ошибка очистки', 'err');
  }
}

function escHtmlChat(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/\n/g,'<br>');
}

function timeAgo(ts) {
  if (!ts) return 'сейчас';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff/60)}м назад`;
  if (diff < 86400) return `${Math.floor(diff/3600)}ч назад`;
  return `${Math.floor(diff/86400)}д назад`;
}
