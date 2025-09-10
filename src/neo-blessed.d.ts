// Minimal neo-blessed type stubs to silence TS complaints.
// Extend as needed; kept deliberately light.

declare module 'neo-blessed' {
  import { EventEmitter } from 'node:events';
  namespace Widgets {
    interface BoxOptions { [k: string]: any }
    interface ListOptions extends BoxOptions { }
    interface ListElement extends EventEmitter {
      setItems(items: string[]): void;
      select(index: number): void;
      on(event: string, cb: (...args:any[])=>void): this;
      focused?: boolean;
      focus(): void;
      getItem?(index:number): any;
      add?(item: any): void;
      style?: any;
      setLabel?(str: string): void;
      selected?: number;
    }
    interface BoxElement extends EventEmitter {
      setContent(str: string): void;
      getContent(): string;
      setLabel(str: string): void;
      focused?: boolean;
      destroy(): void;
      focus(): void;
      setScrollPerc?(n:number): void;
    }
  }
  interface Screen extends EventEmitter {
    render(): void;
    key(keys: string | string[], cb: (ch: string, key: any) => void): void;
    on(event: string, cb: (...args:any[])=>void): void;
    destroy(): void;
    title: string;
    options: any;
  }
  function screen(opts?: any): Screen;
  function box(opts?: any): Widgets.BoxElement;
  function list(opts?: any): Widgets.ListElement;
  function textbox(opts?: any): Widgets.BoxElement; // minimal reuse of BoxElement
  const program: any;
  export { screen, list, box, textbox, Widgets };
  export default { screen, list, box, textbox };
}
