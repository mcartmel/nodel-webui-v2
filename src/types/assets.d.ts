declare module '*?url&no-inline' {
  const url: string;
  export default url;
}

declare module '*.css?inline' {
  const css: string;
  export default css;
}
