import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// Replaced One Dark colors with VSCode Dark colors
const chalky = "#4ec9b0",
  coral = "#d4d4d4",
  cyan = "#d4d4d4",
  invalid = "#ff0000",
  ivory = "#9cdcfe",
  stone = "#6a9955",
  malibu = "#dcdcaa",
  sage = "#ce9178",
  whiskey = "#569cd6",
  violet = "#c586c0",
  darkBackground = "#1e1e1e",
  highlightBackground = "#ffffff0f",
  background = "#1e1e1e",
  tooltipBackground = "#1e1e1e",
  selection = "#6199ff2f",
  cursor = "#c6c6c6";

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
  darkBackground,
  highlightBackground,
  background,
  tooltipBackground,
  selection,
  cursor,
};

/** The editor theme styles using VSCode Dark colors. */
const oneDarkTheme = EditorView.theme(
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
    ".cm-panels": { backgroundColor: darkBackground, color: ivory },
    ".cm-panels.cm-panels-top": { borderBottom: "2px solid black" },
    ".cm-panels.cm-panels-bottom": { borderTop: "2px solid black" },
    ".cm-searchMatch": {
        
      backgroundColor: "#72a1ff59",
      outline: "1px solid #457dff",
    },

    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "#6199ff2f",
    },
    ".cm-activeLine": { backgroundColor: "#ffffff0f" },
    ".cm-selectionMatch": { backgroundColor: "#6199ff2f" },
    "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: "#bad0f847",
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
      backgroundColor: "#252525",
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
        scrollbarColor: "#4D4D4D #252525", // thumb and track for Firefox
        borderRadius: "0px !important",

        "&::-webkit-scrollbar": {
          width: "8px",
        },
        "&::-webkit-scrollbar-track": {
          backgroundColor: "#252525 !important",
          borderRadius: "0px !important",
        },
        "&::-webkit-scrollbar-thumb": {
          backgroundColor: "#4D4D4D",
        },
        "&::-webkit-scrollbar-thumb:hover": {
          backgroundColor: "#4D4D4D",
        },

        "& > ul > li": {
        fontSize:"12px !important",
        },
        "& > ul > li[aria-selected]": {
            backgroundColor: "#03395E !important",
            color: ivory,
        },
    },
    ".cm-completionMatchedText": {
    textDecoration: "none",          // removes underline
    fontWeight: "bold",              // or use italic, or any other style
    color: "#2AAAFF"                 // optional: VSCode yellowish match color
    },
    ".cm-completionLabel": {
    color: "#e1e8ed"  // Set your unmatched text color here
    },
    ".cm-foldGutter .cm-gutterElement": {
      "& span": {
        fontSize: "18px !important",
        cursor: "pointer !important",
        display: "inline-block !important",
      }
    },
  },
  { dark: true }
);

/** The highlighting style using VSCode Dark colors. */
const oneDarkHighlightStyle = HighlightStyle.define([
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
  { tag: tags.link, color: stone, textDecoration: "underline" },
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
const o2QueryEditorDarkTheme = [
  oneDarkTheme,
  syntaxHighlighting(oneDarkHighlightStyle),
];

export { color, o2QueryEditorDarkTheme, oneDarkHighlightStyle, oneDarkTheme };
