import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editor = readFileSync(new URL('../assets/js/shared/rich-text-quill.js', import.meta.url), 'utf8');
const reader = readFileSync(new URL('../assets/js/shared/rich-text.js', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../assets/js/features/chat.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/rich-text-quill.css', import.meta.url), 'utf8');
const characterCss = readFileSync(new URL('../assets/css/characters.css', import.meta.url), 'utf8');
const featureCss = readFileSync(new URL('../assets/css/features.css', import.meta.url), 'utf8');
const world = readFileSync(new URL('../assets/js/features/world.js', import.meta.url), 'utf8');
const histoire = readFileSync(new URL('../assets/js/features/histoire.js', import.meta.url), 'utf8');

test('l éditeur enrichi expose la barre adaptative et les outils du handoff', () => {
  assert.match(editor, /data-rtq-menu="style"/);
  assert.match(editor, /data-rtq-menu="more"/);
  assert.match(editor, /data-rtq-menu="insert"/);
  assert.match(editor, /class="rtq-insert-label">Insérer/);
  assert.match(editor, /data-rtq-find/);
  assert.match(editor, /data-rtq-table-size/);
  assert.match(editor, /data-rtq-table-head/);
  assert.match(editor, /data-rtq-table-select="column"/);
  assert.match(editor, /copyTableSelection/);
  assert.match(editor, /pasteTableMatrix/);
  assert.match(editor, /s\.tableDrag = \{ startCell: cell/);
  assert.match(editor, /document\.elementFromPoint\(e\.clientX, e\.clientY\)/);
  assert.match(editor, /addEventListener\('mousemove'/);
  assert.match(editor, /Les listes ne peuvent pas être appliquées dans une cellule de tableau/);
  assert.match(editor, /data-rtq-command="italic"/);
  assert.match(editor, /#ec4899/);
  assert.match(editor, /loadCollection\('shop'\)/);
  assert.match(editor, /data-rtq-mention-kind/);
  assert.match(editor, /data-rtq-image-tools/);
  assert.match(editor, /data-rtq-bubble/);
  assert.match(editor, /data-rtq-status/);
  assert.match(css, /@container \(max-width: 720px\)/);
  assert.match(css, /\.rtq-wrap\.is-focus/);
  assert.match(css, /max-height:\s*none/);
  assert.match(css, /\.rtc em, \.rtc i \{ font-style: italic; font-synthesis: style; \}/);
  assert.match(css, /\.rt-mention\[data-kind='objet'\]/);
  assert.match(css, /\.rt-mention\[data-kind='joueur'\]/);
  assert.match(css, /\[data-rtq-selected-cell\]/);
  assert.match(css, /\.rtq-wrap\.is-table-selecting \.ql-editor \{ user-select: none; cursor: cell; \}/);
  assert.match(css, /data-rtq-tone='danger'/);
  assert.doesNotMatch(css, /max-height:\s*min\(62vh/);
  assert.match(characterCss, /\.note-modal-content \.ql-editor \{[^}]*max-height:\s*none;/s);
});

test('les blocs JDR restent sérialisables et les secrets sont masqués aux joueurs', () => {
  assert.match(editor, /static blotName = 'dice'/);
  assert.match(editor, /static blotName = 'mention'/);
  assert.match(editor, /static blotName = 'callout'/);
  assert.match(editor, /className = 'rt-check'/);
  assert.match(editor, /prepareHtmlForQuill/);
  assert.match(editor, /item\.setAttribute\('data-list'/);
  assert.match(reader, /\.rt-callout\[data-kind="secret"\]/);
  assert.match(reader, /\['rte-content', 'rtc', className\]/);
});

test('les éditeurs visibles du guide et de l histoire reçoivent le nouveau rendu', () => {
  assert.match(world, /quillEditorHtml\(\{/);
  assert.match(world, /bindQuillEditors\(host\)/);
  assert.match(featureCss, /\.world-editor--rich \.ql-editor \{[^}]*min-height:\s*max\(520px/s);
  assert.match(featureCss, /width:\s*min\(100%, 1080px\)/);
  assert.match(featureCss, /\.world-section-content\s*\{[^}]*width:\s*min\(100%, 1080px\)/s);
  assert.match(featureCss, /body:has\(\.world-editor--rich\)[^{]*\{[^}]*overflow-x:\s*clip/s);
  assert.match(featureCss, /\.world-editor--rich \.rtq-toolbar\.ql-toolbar\.ql-snow\s*\{[^}]*top:\s*calc\(var\(--header-height, 64px\) \+ 24px\)/s);
  assert.match(featureCss, /@media \(min-width: 769px\)[^{]*\{[\s\S]*?\.world-editor--rich \.rtq-toolbar\.ql-toolbar\.ql-snow \{ top: 16px; \}/);
  assert.match(histoire, /className:\s*'hist-editor rtc'/);
  assert.match(histoire, /type:\s*'block'/);
  assert.match(histoire, /type:\s*'align'/);
});

test('un jet intégré reprend le moteur et le canal du chat global', () => {
  assert.match(editor, /app:rich-text-dice/);
  assert.match(reader, /app:rich-text-dice/);
  assert.match(chat, /addEventListener\('app:rich-text-dice'/);
  assert.match(chat, /_sendRoll\(roll\)/);
});
