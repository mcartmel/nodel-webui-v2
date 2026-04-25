import type { JQueryStatic } from 'jquery';

declare global {
  interface Window {
    $: JQueryStatic;
    jQuery: JQueryStatic;
  }

  interface JQueryStatic {
    templates(...args: any[]): any;
    observable(value: any): {
      setProperty(path: string, value: any): void;
      setProperty(path: Record<string, unknown>): void;
    };
  }
}

declare module 'jsviews';

export {};
