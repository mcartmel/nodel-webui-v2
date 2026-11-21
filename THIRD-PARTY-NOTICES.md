# Third-Party Notices

The Nodel Web UI release bundle includes bundled code and assets from open source npm packages. Exact package versions are recorded in `package-lock.json` for each source release.

| Package | License |
| --- | --- |
| `@antv/x6` | MIT |
| `@codemirror/autocomplete` | MIT |
| `@codemirror/commands` | MIT |
| `@codemirror/lang-css` | MIT |
| `@codemirror/lang-html` | MIT |
| `@codemirror/lang-java` | MIT |
| `@codemirror/lang-javascript` | MIT |
| `@codemirror/lang-json` | MIT |
| `@codemirror/lang-markdown` | MIT |
| `@codemirror/lang-python` | MIT |
| `@codemirror/lang-sql` | MIT |
| `@codemirror/lang-xml` | MIT |
| `@codemirror/language` | MIT |
| `@codemirror/legacy-modes` | MIT |
| `@codemirror/lint` | MIT |
| `@codemirror/search` | MIT |
| `@codemirror/state` | MIT |
| `@codemirror/streamparser` | MIT |
| `@codemirror/view` | MIT |
| `@fortawesome/fontawesome-common-types` | MIT |
| `@fortawesome/fontawesome-free` | (CC-BY-4.0 AND OFL-1.1 AND MIT) |
| `@fortawesome/free-brands-svg-icons` | (CC-BY-4.0 AND MIT) |
| `@fortawesome/free-regular-svg-icons` | (CC-BY-4.0 AND MIT) |
| `@fortawesome/free-solid-svg-icons` | (CC-BY-4.0 AND MIT) |
| `@kurkle/color` | MIT |
| `@lezer/common` | MIT |
| `@lezer/css` | MIT |
| `@lezer/highlight` | MIT |
| `@lezer/html` | MIT |
| `@lezer/java` | MIT |
| `@lezer/javascript` | MIT |
| `@lezer/json` | MIT |
| `@lezer/lr` | MIT |
| `@lezer/markdown` | MIT |
| `@lezer/python` | MIT |
| `@lezer/xml` | MIT |
| `@mdi/svg` | Apache-2.0 |
| `@marijn/find-cluster-break` | MIT |
| `ansi-regex` | MIT |
| `ansi-styles` | MIT |
| `camelcase` | MIT |
| `chart.js` | MIT |
| `codemirror` | MIT |
| `dom-align` | MIT |
| `cliui` | ISC |
| `color-convert` | MIT |
| `color-name` | MIT |
| `crelt` | MIT |
| `cuint` | MIT |
| `decamelize` | MIT |
| `dijkstrajs` | MIT |
| `emoji-regex` | MIT |
| `find-up` | MIT |
| `get-caller-file` | ISC |
| `identicon.js` | BSD |
| `is-fullwidth-code-point` | MIT |
| `jquery` | MIT |
| `jsviews` | MIT |
| `locate-path` | MIT |
| `lodash-es` | MIT |
| `mousetrap` | Apache-2.0 WITH LLVM-exception |
| `p-limit` | MIT |
| `p-locate` | MIT |
| `p-try` | MIT |
| `pagedown` | MIT |
| `path-exists` | MIT |
| `qrcode` | MIT |
| `pngjs` | MIT |
| `require-directory` | MIT |
| `require-main-filename` | ISC |
| `set-blocking` | ISC |
| `string-width` | MIT |
| `strip-ansi` | MIT |
| `style-mod` | MIT |
| `tslib` | 0BSD |
| `utility-types` | MIT |
| `w3c-keyname` | MIT |
| `which-module` | ISC |
| `wrap-ansi` | MIT |
| `xxhashjs` | MIT |
| `y18n` | ISC |
| `yargs` | MIT |
| `yargs-parser` | ISC |

The project source license is provided separately in `LICENSE`.

## Topology SimpleName transliteration data

The separate `topology-simple-name-transliterations.json` data is adapted from
[CIRCLE](https://stackoverflow.com/users/2011284/circle)'s Stack Overflow
[answer to “How do I remove diacritics (accents) from a string in .NET?”](https://stackoverflow.com/a/34272324),
[revision 2, 14 December 2015](https://stackoverflow.com/revisions/34272324/2),
licensed under [CC BY-SA 3.0 Unported](https://creativecommons.org/licenses/by-sa/3.0/).
The ordered table was extracted into JSON and its replacement strings were
lowercased to reproduce Java `SimpleName` under `Locale.ROOT`. The 2024 edit
is not used. The adaptation, including its bundled representation, is
distributed under CC BY-SA 3.0; this does not license the application under CC BY-SA.

The answer identifies its CodeIgniter origin. For the matching upstream table,
retained MIT attribution, and separately MPL-2.0 Java-derived comparator, see
`v2/licenses/topology-simple-name-NOTICE.txt` (`public/v2/licenses/` in the
source checkout). The installed `v2/licenses/` directory includes the
corresponding JSON data and offline license texts.

## Material Design Icons

This release includes SVG icon artwork from **Material Design Icons**, distributed in the exact production package `@mdi/svg@7.4.47` (Pictogrammers, <https://pictogrammers.com/>; upstream project: <https://github.com/Templarian/MaterialDesign-SVG>). The package metadata identifies Apache-2.0 as its license. The package's accompanying `LICENSE` identifies the icon collection as the Pictogrammers Free License and states:

> This icon collection is released as free, open source, and GPL friendly by the Pictogrammers icon group. You may use it for commercial projects, open source projects, or anything really.
>
> Icons: Apache 2.0 (https://www.apache.org/licenses/LICENSE-2.0). Some of the icons are redistributed under the Apache 2.0 license. All other icons are either redistributed under their respective licenses or are distributed under the Apache 2.0 license.
>
> Fonts: Apache 2.0 (https://www.apache.org/licenses/LICENSE-2.0). All web and desktop fonts are distributed under the Apache 2.0 license. Web and desktop fonts contain some icons that are redistributed under the Apache 2.0 license. All other icons are either redistributed under their respective licenses or are distributed under the Apache 2.0 license.
>
> Code: MIT (https://opensource.org/licenses/MIT). The MIT license applies to all non-font and non-icon files.

Only entries in the package's `meta.json` tagged exactly **`Brand / Logo`** are omitted from this product's generated icon catalogue. Pictogrammers' licensing guidance excludes Brand / Logos from the general icon licence: no such entries are included or represented here as covered by Apache-2.0. This exclusion does not imply a general licence to use the upstream excluded brand/logo artwork.

The Apache License, Version 2.0 applies to the included MDI icon artwork; the complete license terms follow.

```text
                                  Apache License
                            Version 2.0, January 2004
                         http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition,
      "submitted" means any form of electronic, verbal, or written
      communication sent to the Licensor or its representatives, including
      but not limited to communication on electronic mailing lists, source
      code control systems, and issue tracking systems that are managed by,
      or on behalf of, the Licensor for the purpose of discussing and
      improving the Work, but excluding communication that is conspicuously
      marked or otherwise designated in writing by the copyright owner as
      "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work or a
      Contribution incorporated within the Work constitutes direct or
      contributory patent infringement, then any patent licenses granted to
      You under this License for that Work shall terminate as of the date
      such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or Derivative
          Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work, excluding
          those notices that do not pertain to any part of the Derivative
          Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one of
          the following places: within a NOTICE text file distributed as
          part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and do not
          modify the License. You may add Your own attribution notices
          within Derivative Works that You distribute, alongside or as
          an addendum to the NOTICE text from the Work, provided that such
          additional attribution notices cannot be construed as modifying
          the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions for
      use, reproduction, or distribution of Your modifications, or for any
      such Derivative Works as a whole, provided Your use, reproduction,
      and distribution of the Work otherwise complies with the conditions
      stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or agreed
      to in writing, Licensor provides the Work (and each Contributor
      provides its Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES
      OR CONDITIONS OF ANY KIND, either express or implied, including,
      without limitation, any warranties or conditions of TITLE,
      NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR
      PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this
      License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all other
      commercial damages or losses), even if such Contributor has been
      advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing the
      Work or Derivative Works thereof, You may choose to offer, and charge
      a fee for, acceptance of support, warranty, indemnity, or other
      liability obligations and/or rights consistent with this License.
      However, in accepting such obligations, You may act only on Your own
      behalf and on Your sole responsibility, not on behalf of any other
      Contributor, and only if You agree to indemnify, defend, and hold
      each Contributor harmless for any liability incurred by, or claims
      asserted against, such Contributor by reason of your accepting any
      such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include the
      brackets!) The text should be enclosed in the appropriate comment
      syntax for the file format. We also recommend that a file or class
      name and description of purpose be included on the same "printed
      page" as the copyright notice for easier identification within
      third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```
