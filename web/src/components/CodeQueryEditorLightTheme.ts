import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// Replaced One Light colors with VSCode Light colors
const chalky = "#267f99",
  coral = "#000000",
  cyan = "#383a42",
  invalid = "#e45649",
  ivory = "#383a42",
  stone = "#008000",
  malibu = "#795e26",
  sage = "#a31515",
  whiskey = "#0000ff",
  violet = "#af00db",
  lightBackground = "#ffffff",
  highlightBackground = "#99999926",
  background = "#ffffff",
  tooltipBackground = "#ffffff",
  selection = "#add6ff",
  cursor = "#000";

/** The colors used in the theme, as CSS color strings. */
const color = {
  chalky,
  coral,
  cyan,
  invalid,
  ivory,
  stone,
  malibu,
  sage,
  whiskey,
  violet,
  lightBackground,
  highlightBackground,
  background,
  tooltipBackground,
  selection,
  cursor,
};

/** The editor theme styles using VSCode Light colors. */
const oneLightTheme = EditorView.theme(
  {
    "&": {
      color: ivory,
      backgroundColor: background,
    },
    ".cm-content": {
      caretColor: cursor,
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: cursor },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: selection,
    },
    ".cm-panels": { backgroundColor: lightBackground, color: ivory },
    ".cm-panels.cm-panels-top": { borderBottom: "2px solid black" },
    ".cm-panels.cm-panels-bottom": { borderTop: "2px solid black" },
    ".cm-searchMatch": {
      backgroundColor: "#add6ff",
      outline: "1px solid #0070c1",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "#a8ac94",
    },
    ".cm-activeLine": { backgroundColor: "#99999926" },
    ".cm-selectionMatch": { backgroundColor: "#a8ac94" },
    "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: "#dddddd",
    },
    ".cm-gutters": {
      backgroundColor: background,
      color: stone,
      border: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: highlightBackground,
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "transparent",
      border: "none",
      color: "#ddd",
    },
    ".cm-tooltip": {
      border: "none",
      backgroundColor: "#F0F0F0",
    },
    ".cm-tooltip .cm-tooltip-arrow:before": {
      borderTopColor: "transparent",
      borderBottomColor: "transparent",
    },
    ".cm-tooltip .cm-tooltip-arrow:after": {
      borderTopColor: tooltipBackground,
      borderBottomColor: tooltipBackground,
    },
    ".cm-tooltip-autocomplete": {
      scrollbarColor: "#8f8f8f #F0F0F0", // thumb and track for Firefox
      borderRadius: "0px !important",

      "&::-webkit-scrollbar": {
        width: "8px",
      },
      "&::-webkit-scrollbar-track": {
        backgroundColor: "#f0f0f0 !important",
        borderRadius: "0px !important",
      },
      "&::-webkit-scrollbar-thumb": {
        backgroundColor: "#89f88f",
      },
      "&::-webkit-scrollbar-thumb:hover": {
        backgroundColor: "#8f8f8f",
      },
      "& > ul > li": {
        fontSize:"12px !important",
        },
      "& > ul > li[aria-selected]": {
        backgroundColor: '#035FC0',
        color: ivory,
        "& .cm-completionMatchedText": {
          color: "#BBE7FE"
        },
        "& .cm-completionLabel": {
          color: "#F4F7FC !important"
        }
      },
    },
    ".cm-completionMatchedText": {
      textDecoration: "none",          // removes underline
      fontWeight: "bold",
      color: "#0065BF"                 //: VSCode blue match color
      },
      ".cm-completionLabel": {
      color: "#000000"  // Set your unmatched text color here
      },
    ".cm-foldGutter .cm-gutterElement": {
      "& span": {
        fontSize: "18px !important",
        cursor: "pointer !important",
        display: "inline-block !important",
      }
    },
    ".cm-func-call span": {
      color: "#c700c7" /* function color like Monaco */
    }
  },
  { dark: false }
);

/** The highlighting style using VSCode Light colors. */
const oneLightHighlightStyle = HighlightStyle.define([
  {
    tag: tags.name,
    color: "#795E26", // fallback function color like Monaco
  },
  { tag: tags.keyword, color: whiskey },
  {
    tag: [
      tags.name,
      tags.deleted,
      tags.character,
      tags.propertyName,
      tags.macroName,
    ],
    color: coral,
  },
  {
    tag: [tags.function(tags.variableName), tags.labelName],
    color: malibu,
  },
  {
    tag: [
      tags.color,
      tags.constant(tags.name),
      tags.standard(tags.name),
    ],
    color: whiskey,
  },
  {
    tag: [tags.definition(tags.name), tags.separator],
    color: ivory,
  },
  {
    tag: [
      tags.typeName,
      tags.className,
      tags.number,
      tags.changed,
      tags.annotation,
      tags.modifier,
      tags.self,
      tags.namespace,
    ],
    color: chalky,
  },
  {
    tag: [
      tags.operator,
      tags.operatorKeyword,
      tags.url,
      tags.escape,
      tags.regexp,
      tags.link,
      tags.special(tags.string),
    ],
    color: cyan,
  },
  { tag: [tags.meta, tags.comment], color: stone },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "#4078f2", textDecoration: "underline" },
  { tag: tags.heading, fontWeight: "bold", color: coral },
  {
    tag: [tags.atom, tags.bool, tags.special(tags.variableName)],
    color: whiskey,
  },
  {
    tag: [tags.processingInstruction, tags.string, tags.inserted],
    color: sage,
  },
  { tag: tags.invalid, color: invalid },
]);

/** Export extension */
const o2QueryEditorLightTheme = [
  oneLightTheme,
  syntaxHighlighting(oneLightHighlightStyle),
];

export {
  color,
  o2QueryEditorLightTheme,
  oneLightHighlightStyle,
  oneLightTheme,
};
