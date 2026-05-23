declare module 'pagedown' {
  export class Converter {
    makeHtml(text: string): string;
  }

  export function getSanitizingConverter(): Converter;
}
