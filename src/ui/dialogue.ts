// 對話框：顯示對話樹，選項可以跳到下一段或執行動作（導航、傳送…）。
import { t } from '../core/i18n';
import type { Dialogue, DialogueAction } from '../core/types';
import { button, el } from './dom';

export type ActionHandler = (action: DialogueAction) => void;

export class DialogueBox {
  private root: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private textEl: HTMLDivElement;
  private choicesEl: HTMLDivElement;
  private dialogue: Dialogue | null = null;
  isOpen = false;
  onClose: (() => void) | null = null;

  /** 動作註冊表：之後的小遊戲、給道具等等都在這裡新增 type */
  readonly actions = new Map<string, ActionHandler>();

  constructor(parent: HTMLElement) {
    this.root = el('div', 'dialogue hidden', undefined, parent);
    this.nameEl = el('div', 'dialogue-name', '', this.root);
    this.textEl = el('div', 'dialogue-text', '', this.root);
    this.choicesEl = el('div', 'dialogue-choices', undefined, this.root);
    this.actions.set('end', () => this.close());
  }

  open(speaker: string, dialogue: Dialogue) {
    this.dialogue = dialogue;
    this.nameEl.textContent = speaker;
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.show(dialogue.start);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.onClose?.();
  }

  private show(nodeId: string) {
    const node = this.dialogue?.nodes[nodeId];
    if (!node) { this.close(); return; }
    this.textEl.textContent = t(node.text);
    this.choicesEl.innerHTML = '';
    const choices = node.choices?.length ? node.choices : [{ text: 'ui.dialogue.end', action: { type: 'end' } }];
    for (const c of choices) {
      button('dialogue-choice', t(c.text), () => {
        if (c.action) {
          const handler = this.actions.get(c.action.type);
          if (handler) handler(c.action);
          else console.warn('未註冊的對話動作', c.action.type);
          if (c.action.type !== 'end' && !c.next) this.close();
        }
        if (c.next) this.show(c.next);
      }, this.choicesEl);
    }
  }
}
