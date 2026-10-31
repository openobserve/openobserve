// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

export const HTML_LINK_SELECTORS = {
  blankLink: "#o2-blank-link",
  blankMixedCaseLink: "#o2-blank-mixed-case-link",
  blankForm: "#o2-blank-form",
  blankArea: "#o2-blank-area",
  blankSvgLink: "#o2-blank-svg-link",
  namedLink: "#o2-named-link",
  topLink: "#o2-top-link",
  selfLink: "#o2-self-link",
  parentLink: "#o2-parent-link",
  namedForm: "#o2-named-form",
  plainLink: "#o2-plain-link",
  shadowedForm: "#o2-shadowed-form",
  shadowedFormButton: "#o2-shadowed-form button",
  clobberedForm: "#o2-clobbered-form",
  afterFormsLink: "#o2-after-forms-link",
  popupLink: "#o2-popup-link",
};

export const BLANK_TARGET_HTML_SNIPPET = `<h1>Blank Target Test</h1>
<a id="o2-blank-link" href="https://example.com/a" target="_blank" rel="opener">Blank link</a>
<a id="o2-blank-mixed-case-link" href="https://example.com/b" target="  _BLANK ">Mixed case link</a>
<form id="o2-blank-form" action="https://example.com/submit" target="_blank"><button type="submit">Go</button></form>
<map name="o2-map"><area id="o2-blank-area" shape="rect" coords="0,0,10,10" href="https://example.com/c" target="_blank" alt="area"></map>
<svg width="20" height="20"><a id="o2-blank-svg-link" href="https://example.com/d" target="_blank"><rect width="10" height="10"></rect></a></svg>`;

export const DROPPED_TARGET_HTML_SNIPPET = `<h1>Dropped Target Test</h1>
<a id="o2-named-link" href="https://example.com/a" target="o2frame">Named link</a>
<a id="o2-top-link" href="https://example.com/b" target="_top">Top link</a>
<a id="o2-self-link" href="https://example.com/c" target="_self">Self link</a>
<a id="o2-parent-link" href="https://example.com/d" target="_parent">Parent link</a>
<form id="o2-named-form" action="https://example.com/submit" target="o2frame"><button type="submit">Go</button></form>
<a id="o2-plain-link" href="https://example.com/e" rel="nofollow">Plain link</a>`;

// a shadowed getAttribute must not blank the panel; a shadowed nodeName form is dropped as clobbered
export const SHADOWED_FORM_HTML_SNIPPET = `<h1>Shadowed Form Test</h1>
<form id="o2-shadowed-form" action="https://example.com/submit" target="_blank">
  <input name="getAttribute" value="a">
  <button type="submit">Send</button>
</form>
<form id="o2-clobbered-form" action="https://example.com/submit" target="_blank">
  <input name="nodeName" value="b">
</form>
<a id="o2-after-forms-link" href="https://example.com/a" target="_blank">After forms</a>`;

export const POPUP_HTML_SNIPPET = `<h1>Popup Link Test</h1>
<a id="o2-popup-link" href="/healthz" target="_blank">Open in new tab</a>`;
