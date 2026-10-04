import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../assets/js/features/chat.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/chat.css', import.meta.url), 'utf8');

test('le chat global utilise une languette mobile et un tiroir à rail permanent', () => {
  assert.match(chat, /class="chat-edge-tab"/);
  assert.match(chat, /class="chat-drawer"/);
  assert.match(chat, /class="chat-rail"/);
  assert.match(chat, /localStorage\.setItem\('chat-tab-y'/);
  assert.match(css, /\.chat-edge-tab\s*\{[^}]*width:\s*44px/s);
  assert.match(css, /\.chat-drawer\s*\{[^}]*width:\s*min\(var\(--chat-drawer-w\),100vw\)/s);
});

test('les échos restent bornés, temporisés et ouvrent leur conversation', () => {
  assert.match(chat, /while \(host\.children\.length > 3\)/);
  assert.match(chat, /setTimeout\(\(\) => _dismissEcho\(el\), 6500\)/);
  assert.match(chat, /if \(_muted && !mention\) return/);
  assert.match(chat, /_openDrawer\(event\.convoId\)/);
  assert.match(chat, /_sendTextTo\(event\.convoId, text\)/);
});

test('le fil compact conserve réponses édition réactions mentions et dés rapides', () => {
  assert.match(chat, /chat-msg--compact/);
  assert.match(chat, /chat-unread-line/);
  assert.match(chat, /data-action="chatReplyMsg"/);
  assert.match(chat, /data-action="chatEditMsg"/);
  assert.match(chat, /data-action="chatReact"/);
  assert.match(chat, /\[4, 6, 8, 10, 12, 20, 100\]/);
  assert.match(chat, /mentionButtons\.length && \(e\.key === 'ArrowDown'/);
  assert.match(chat, /chat-msg-image/);
  assert.match(chat, /imageName/);
  assert.match(chat, /avatarSrcOf\(_profileOf\(m\.senderId\)\)/);
  assert.match(chat, /chat-react-chip[\s\S]*?<span>\$\{counts\[e\]\}<\/span>/);
});

test('le tiroir gère épinglage responsive et feuilles internes sans dépasser les modales', () => {
  assert.match(chat, /document\.body\.classList\.toggle\('chat-drawer-pinned'/);
  assert.match(chat, /_sheet === 'new'/);
  assert.match(chat, /_sheet === 'manage'/);
  assert.match(css, /body\.chat-drawer-pinned #app\s*\{[^}]*calc\(100% - var\(--chat-drawer-w\)\)/s);
  assert.match(css, /@media \(max-width:\s*559px\)[\s\S]*body\.chat-drawer-pinned #app\s*\{[^}]*width:\s*100%/);
  assert.match(css, /\.chat-drawer\s*\{[^}]*z-index:\s*840/s);
});
