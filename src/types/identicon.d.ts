declare module 'identicon.js' {
  interface IdenticonOptions {
    background?: [number, number, number, number];
    margin?: number;
    size?: number;
    format?: 'svg' | 'png';
  }

  class Identicon {
    constructor(hash: string, options?: IdenticonOptions);
    toString(): string;
  }

  export default Identicon;
}
