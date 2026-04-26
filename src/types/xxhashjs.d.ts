declare module 'xxhashjs' {
  interface XXH64Result {
    toString(radix?: number): string;
  }

  const XXH: {
    h64(value: string, seed: number): XXH64Result;
  };

  export default XXH;
}
