export const authoredPageScaffold = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script>
    (() => {
      const root = document.documentElement;
      let theme = root.dataset.theme;
      if (theme !== 'light' && theme !== 'dark') {
        try {
          const stored = window.localStorage.getItem('nodel.theme');
          theme = stored === 'light' || stored === 'dark' ? stored : undefined;
        } catch {}
      }
      if (theme !== 'light' && theme !== 'dark') {
        try {
          theme = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        } catch {
          theme = 'light';
        }
      }
      root.dataset.theme = theme;
    })();
  </script>
  <link rel="stylesheet" href="./v2/nodel-webui.css" />
  <script type="module" src="./v2/nodel-webui.js"></script>
</head>
<body>
  <nodel-app>
    <nodel-toolbar></nodel-toolbar>
    <nodel-page title="Page">
      <nodel-row>
        <nodel-column>
          
        </nodel-column>
      </nodel-row>
    </nodel-page>
  </nodel-app>
</body>
</html>`;

export const authoredPageScaffoldSnippet = `<nodel-page title="Page">
  <nodel-row>
    <nodel-column>
      \${}
    </nodel-column>
  </nodel-row>
</nodel-page>`;

export const authoredPageDocumentSnippet = authoredPageScaffold.replace('          \n', '          \${}\n');

export const authoredPageHead = authoredPageScaffold.slice(0, authoredPageScaffold.indexOf('</head>') + 7);
