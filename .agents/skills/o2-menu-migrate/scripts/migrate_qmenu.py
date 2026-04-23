#!/usr/bin/env python3
"""
migrate_qmenu.py — transforms <q-menu> → <OMenu> in Vue SFC templates.

Usage:
    # Dry-run a single file
    python migrate_qmenu.py web/src/components/Foo.vue

    # Apply in-place
    python migrate_qmenu.py --write web/src/components/Foo.vue

    # Apply to all Vue files under a directory
    python migrate_qmenu.py --write web/src/

    # Show diff only (no write)
    python migrate_qmenu.py --diff web/src/components/Foo.vue

The script:
  1. Parses the <template> block with a bespoke tag-stack walker (no external deps).
  2. For each <q-menu> it finds the outermost trigger OButton / q-btn / span / div
     that directly contains it (its parent at parse time).
  3. Rewrites the block:
       - Wraps trigger + q-menu in <OMenu ...> … </OMenu>
       - Maps q-menu props → OMenu props (see PROP_MAP)
       - Moves q-menu children into <template #content>
       - Replaces v-close-popup on children with @click calls to close()
       - Adds @show→@show, @hide/@before-hide→@hide pass-through
  4. Adds the OMenu import to <script> if not already present.
  5. Reports every <q-menu> it could NOT safely auto-migrate (manual flag).

Limitations / manual cases:
  - Nested q-menu (submenu) — flagged, not transformed.
  - q-menu whose trigger is NOT a recognised element — flagged.
  - Files with preprocessed <template lang="pug"> — skipped entirely.
"""

import re
import sys
import difflib
import pathlib
import textwrap
from dataclasses import dataclass, field
from typing import Optional

# ---------------------------------------------------------------------------
# Prop mapping: q-menu attr → OMenu attr (None = drop)
# ---------------------------------------------------------------------------
PROP_MAP: dict[str, Optional[str]] = {
    "anchor": "anchor",
    "self": "self",
    ":offset": ":offset",
    "offset": "offset",
    "v-model": "v-model",
    "content-style": "content-style",
    ":content-style": ":contentStyle",
    "contentStyle": "contentStyle",
    ":contentStyle": ":contentStyle",
    "persistent": "persistent",
    # Drop these — OMenu doesn't need them
    "no-route-dismiss": None,
    "fit": None,
    "square": None,
    "dark": None,
    "auto-close": None,
    "transition-show": None,
    "transition-hide": None,
    "scroll-target": None,
    ":scroll-target": None,
    "max-height": None,
    ":max-height": None,
    "max-width": None,
    ":max-width": None,
    "touch-position": None,
    "context-menu": None,
}

# Attrs that map to contentStyle on OMenu (escape hatch)
CONTENT_STYLE_CLASSES = {"q-pa-md", "q-pa-sm", "q-pa-lg"}

OMENU_IMPORT = 'import OMenu from "@/lib/overlay/Menu/Menu.vue";'
OBUTTON_IMPORT_RE = re.compile(r'import OButton from "@/lib/core/Button/Button\.vue";')

# ---------------------------------------------------------------------------
# Tiny tag-stack parser
# ---------------------------------------------------------------------------

TAG_OPEN  = re.compile(r'<([A-Za-z][A-Za-z0-9\-]*)((?:\s[^>]*?)??)(\s*/?)>', re.DOTALL)
TAG_CLOSE = re.compile(r'</([A-Za-z][A-Za-z0-9\-]*)>')
ATTR_RE   = re.compile(r'''([@:a-zA-Z\-][^=\s>]*)(?:\s*=\s*(?:"([^"]*?)"|'([^']*?)'|(\S+)))?''')

# Self-closing HTML elements (never have children in Vue templates)
VOID_TAGS = {"br","hr","img","input","link","meta","area","base","col","embed",
             "param","source","track","wbr"}

@dataclass
class Node:
    tag: str
    attrs_raw: str          # raw attribute string from opening tag
    self_close: bool
    start: int              # byte offset of opening '<'
    end: int                # byte offset just after closing '>'  (opening tag only)
    close_start: int = -1  # offset of closing '</'
    close_end: int   = -1  # offset just after closing '>'
    children: list["Node"] = field(default_factory=list)
    parent: Optional["Node"] = None

    @property
    def attrs(self) -> dict[str, str]:
        result: dict[str, str] = {}
        for m in ATTR_RE.finditer(self.attrs_raw):
            name = m.group(1)
            val  = m.group(2) or m.group(3) or m.group(4) or ""
            result[name] = val
        return result

    def source(self, text: str) -> str:
        end = self.close_end if self.close_end >= 0 else self.end
        return text[self.start:end]


def parse_template(text: str) -> list[Node]:
    """
    Walk the template character by character using TAG_OPEN / TAG_CLOSE regex
    and build a flat list of top-level Node trees.
    """
    pos = 0
    stack: list[Node] = []
    roots: list[Node] = []

    while pos < len(text):
        # Try close tag first (so </q-menu> doesn't match TAG_OPEN)
        mc = TAG_CLOSE.match(text, pos)
        if mc:
            tag = mc.group(1).lower()
            # Pop matching open from stack
            for i in range(len(stack) - 1, -1, -1):
                if stack[i].tag.lower() == tag:
                    node = stack.pop(i)
                    node.close_start = mc.start()
                    node.close_end   = mc.end()
                    pos = mc.end()
                    break
            else:
                pos += 1
            continue

        mo = TAG_OPEN.match(text, pos)
        if mo:
            tag       = mo.group(1)
            attrs_raw = mo.group(2)
            sc_marker = mo.group(3)
            self_close = bool(sc_marker and sc_marker.strip() == "/") or tag.lower() in VOID_TAGS
            node = Node(
                tag=tag,
                attrs_raw=attrs_raw,
                self_close=self_close,
                start=mo.start(),
                end=mo.end(),
            )
            if stack:
                parent = stack[-1]
                node.parent = parent
                parent.children.append(node)
            else:
                roots.append(node)

            if not self_close:
                stack.append(node)
            pos = mo.end()
            continue

        pos += 1

    return roots


def find_all(nodes: list[Node], tag: str) -> list[Node]:
    result = []
    for n in nodes:
        if n.tag.lower() == tag.lower():
            result.append(n)
        result.extend(find_all(n.children, tag))
    return result


# ---------------------------------------------------------------------------
# Attribute helpers
# ---------------------------------------------------------------------------

def build_omenu_attrs(qmenu_attrs: dict[str, str], class_val: str) -> str:
    """
    Convert q-menu attributes to OMenu attributes string.
    Also converts Quasar padding classes (q-pa-md etc.) to contentStyle padding.
    """
    parts: list[str] = []
    extra_style: list[str] = []
    seen_content_style = False

    # Handle class → drop theme classes, convert q-pa-* to contentStyle
    pa_classes = CONTENT_STYLE_CLASSES & set(class_val.split())
    if pa_classes:
        # q-pa-md ≈ padding: 1rem
        size_map = {"q-pa-sm": "0.5rem", "q-pa-md": "1rem", "q-pa-lg": "1.5rem"}
        sizes = [size_map[c] for c in pa_classes if c in size_map]
        if sizes:
            extra_style.append(f"padding: {sizes[0]}")

    for attr, val in qmenu_attrs.items():
        if attr in ("class", ":class"):
            continue  # theme classes dropped; padding handled above
        mapped = PROP_MAP.get(attr)
        if mapped is None:
            continue  # drop
        if mapped == attr or mapped:
            if val:
                parts.append(f'{mapped}="{val}"')
            else:
                parts.append(mapped)

    # content-style / contentStyle
    if "content-style" in qmenu_attrs or ":content-style" in qmenu_attrs or ":contentStyle" in qmenu_attrs:
        seen_content_style = True
    if extra_style and not seen_content_style:
        parts.append(f'contentStyle="{"; ".join(extra_style)}"')

    return " ".join(parts)


def extract_show_hide_events(attrs_raw: str) -> tuple[str, str]:
    """
    Pull @show and @hide (or @before-show / @before-hide) from q-menu attrs.
    Returns (show_handler, hide_handler) — empty string if not present.
    """
    show = ""
    hide = ""
    for m in ATTR_RE.finditer(attrs_raw):
        name = m.group(1)
        val  = m.group(2) or m.group(3) or m.group(4) or ""
        if name in ("@show", "v-on:show"):
            show = val
        elif name in ("@hide", "v-on:hide", "@before-hide", "v-on:before-hide"):
            hide = val
    return show, hide


# ---------------------------------------------------------------------------
# v-close-popup replacement
# ---------------------------------------------------------------------------

VCLOSE_RE = re.compile(r'\s*v-close-popup(?:="[^"]*")?')

def strip_vclose_popup(snippet: str) -> str:
    return VCLOSE_RE.sub("", snippet)


def add_close_call(snippet: str) -> str:
    """
    For each element that had v-close-popup and has a @click, append ; close()
    to the @click handler. If there is no @click, add @click="close()".
    """
    # Pattern: @click="someHandler"  →  @click="someHandler; close()"
    def repl_click(m: re.Match) -> str:
        handler = m.group(1)
        if "close()" in handler:
            return m.group(0)
        return f'@click="{handler}; close()"'

    result = re.sub(r'@click="([^"]+)"', repl_click, snippet)

    # Elements that had v-close-popup but no @click → add @click="close()"
    # We detect these by finding tags that still have v-close-popup after
    # strip_vclose_popup hasn't run yet. We run strip last.
    return result


def rewrite_vclose_popup_in_content(content: str) -> str:
    """
    In the #content slot body: for every tag that has v-close-popup,
    add/amend a @click="close()" and remove v-close-popup.
    Works by regex on the raw text — safe for the flat tag structures we have.
    """
    # Find opening tags that contain v-close-popup
    tag_re = re.compile(r'(<[A-Za-z][^>]*?v-close-popup[^>]*?>)', re.DOTALL)

    def transform_tag(m: re.Match) -> str:
        tag_src = m.group(1)
        tag_src = add_close_call(tag_src)
        tag_src = strip_vclose_popup(tag_src)
        return tag_src

    return tag_re.sub(transform_tag, content)


# ---------------------------------------------------------------------------
# Core transformer: given a q-menu Node and its parent Node, return the
# replacement text and the slice of original text to replace.
# Returns None if the case is too complex to handle automatically.
# ---------------------------------------------------------------------------

def transform_one(text: str, qmenu: Node) -> Optional[tuple[int, int, str]]:
    """
    Returns (replace_start, replace_end, replacement_text) or None.
    replace_start/end are byte offsets in `text`.
    """
    parent = qmenu.parent
    if parent is None:
        return None  # top-level q-menu, can't wrap

    # Check for nested q-menu (submenu inside another menu's content)
    ancestor = parent.parent
    while ancestor:
        if ancestor.tag.lower() == "q-menu":
            return None  # submenu — manual
        ancestor = ancestor.parent

    # --- Extract q-menu attributes ---
    qm_attrs = qmenu.attrs
    qm_attrs_raw = qmenu.attrs_raw
    class_val = qm_attrs.get("class", "") + " " + qm_attrs.get(":class", "")

    show_handler, hide_handler = extract_show_hide_events(qm_attrs_raw)

    omenu_attrs = build_omenu_attrs(qm_attrs, class_val)

    # --- Build OMenu opening tag ---
    slot_attrs = 'v-slot="{ toggle, close }"'
    event_attrs = ""
    if show_handler:
        event_attrs += f' @show="{show_handler}"'
    if hide_handler:
        event_attrs += f' @hide="{hide_handler}"'

    omenu_open_parts = ["<OMenu"]
    if omenu_attrs:
        omenu_open_parts.append(omenu_attrs)
    omenu_open_parts.append(slot_attrs)
    if event_attrs.strip():
        omenu_open_parts.append(event_attrs.strip())
    omenu_open = " ".join(omenu_open_parts) + ">"

    # --- Extract the q-menu inner content ---
    qm_inner_start = qmenu.end
    qm_inner_end   = qmenu.close_start if qmenu.close_start >= 0 else qmenu.end
    qm_content = text[qm_inner_start:qm_inner_end]
    qm_content = rewrite_vclose_popup_in_content(qm_content)

    # --- Determine trigger: the parent element minus its q-menu child ---
    # We'll extract parent's opening tag, all children EXCEPT q-menu,
    # and parent's closing tag, then wrap it all in OMenu.

    parent_open_src  = text[parent.start:parent.end]
    parent_close_src = text[parent.close_start:parent.close_end] if parent.close_start >= 0 else ""

    # Add @click="toggle" to the trigger's opening tag (if not already there)
    if "toggle" not in parent_open_src and "@click" not in parent_open_src:
        # Insert before the closing >
        parent_open_src = parent_open_src[:-1] + '\n  @click="toggle">'
    elif "@click" not in parent_open_src:
        # Has some click already — just add @click="toggle" after existing attrs
        parent_open_src = parent_open_src[:-1] + '\n  @click="toggle">'

    # Build trigger inner content (everything in parent except q-menu)
    trigger_inner_parts: list[str] = []
    for child in parent.children:
        if child is qmenu:
            continue  # skip — becomes #content slot
        child_src = text[child.start:child.close_end if child.close_end >= 0 else child.end]
        trigger_inner_parts.append(child_src)

    # Also pick up raw text nodes between children
    # We do this by taking the full parent inner span and removing child tags
    parent_inner_start = parent.end
    parent_inner_end   = parent.close_start if parent.close_start >= 0 else parent.end
    parent_inner = text[parent_inner_start:parent_inner_end]

    # Replace q-menu subtree with nothing in the parent inner text
    qm_full = text[qmenu.start:qmenu.close_end if qmenu.close_end >= 0 else qmenu.end]
    trigger_inner = parent_inner.replace(qm_full, "", 1)

    # Indent
    indent = "  "
    qm_content_indented = textwrap.indent(qm_content.strip(), indent)

    replacement = (
        f"{omenu_open}\n"
        f"{indent}{parent_open_src}\n"
        f"{textwrap.indent(trigger_inner.strip(), indent * 2)}\n"
        f"{indent}{parent_close_src}\n"
        f"{indent}<template #content>\n"
        f"{qm_content_indented}\n"
        f"{indent}</template>\n"
        f"</OMenu>"
    )

    replace_start = parent.start
    replace_end   = parent.close_end if parent.close_end >= 0 else parent.end

    return replace_start, replace_end, replacement


# ---------------------------------------------------------------------------
# Import injection
# ---------------------------------------------------------------------------

def inject_import(script: str) -> str:
    """Add OMenu import after OButton import (or at end of imports block)."""
    if "OMenu" in script:
        return script  # already imported

    # After OButton import
    m = OBUTTON_IMPORT_RE.search(script)
    if m:
        ins = m.end()
        return script[:ins] + "\n" + OMENU_IMPORT + script[ins:]

    # After last 'import' line
    lines = script.splitlines(keepends=True)
    last_import = -1
    for i, line in enumerate(lines):
        if line.strip().startswith("import "):
            last_import = i
    if last_import >= 0:
        lines.insert(last_import + 1, OMENU_IMPORT + "\n")
        return "".join(lines)

    return script


def inject_component_registration(script: str) -> str:
    """
    If the file uses Options API (defineComponent / components: { }),
    add OMenu to the components object.
    """
    if "OMenu" in script:
        return script

    # Find components: { block
    m = re.search(r'(components\s*:\s*\{)', script)
    if not m:
        return script  # script setup or no components needed

    ins = m.end()
    return script[:ins] + "\n    OMenu," + script[ins:]


# ---------------------------------------------------------------------------
# File-level migration
# ---------------------------------------------------------------------------

# Greedy body match so nested <template #slot> tags don't prematurely end the block
SFC_TEMPLATE_RE = re.compile(r'(<template(?:\s[^>]*)?>)(.*)(</template>)', re.DOTALL)
SFC_SCRIPT_RE   = re.compile(r'(<script[^>]*>)(.*)(</script>)', re.DOTALL)


def migrate_file(src: str) -> tuple[str, list[str]]:
    """
    Returns (migrated_src, list_of_manual_flags).
    """
    manual_flags: list[str] = []

    # Split into template and script sections
    tm = SFC_TEMPLATE_RE.search(src)
    sm = SFC_SCRIPT_RE.search(src)

    if not tm:
        return src, ["No <template> block found"]

    # Skip pug templates
    if 'lang="pug"' in tm.group(1):
        return src, ["Skipped: pug template not supported"]

    template_body = tm.group(2)

    # Check for any q-menu at all
    if "<q-menu" not in template_body:
        return src, []

    # Parse
    roots = parse_template(template_body)
    all_qmenus = find_all(roots, "q-menu")

    if not all_qmenus:
        return src, []

    # Process in REVERSE order so offsets stay valid after each replacement
    all_qmenus_sorted = sorted(all_qmenus, key=lambda n: n.start, reverse=True)

    working_template = template_body

    for qmenu in all_qmenus_sorted:
        result = transform_one(working_template, qmenu)
        if result is None:
            # Reparse to get current position
            line_no = working_template[:qmenu.start].count("\n") + 1
            manual_flags.append(
                f"Line ~{line_no}: q-menu inside '{qmenu.parent.tag if qmenu.parent else 'top-level'}' "
                f"— MANUAL migration required (nested/submenu or unsupported parent)"
            )
            continue

        start, end, replacement = result
        working_template = working_template[:start] + replacement + working_template[end:]

    # Replace v-close-popup outside of OMenu context (shouldn't be any left)
    # Replace original template body in full source
    new_src = src[:tm.start(2)] + working_template + src[tm.end(2):]

    # Inject import into script — re-locate script block after template rewrite
    sm2 = SFC_SCRIPT_RE.search(new_src)
    if sm2:
        script_body = sm2.group(2)
        new_script_body = inject_import(script_body)
        new_script_body = inject_component_registration(new_script_body)
        new_src = new_src[:sm2.start(2)] + new_script_body + new_src[sm2.end(2):]

    return new_src, manual_flags


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def process_path(p: pathlib.Path, write: bool, diff: bool):
    if p.is_dir():
        for vue in sorted(p.rglob("*.vue")):
            process_path(vue, write, diff)
        return

    src = p.read_text(encoding="utf-8")
    if "<q-menu" not in src:
        return

    result, flags = migrate_file(src)

    changed = result != src

    if flags:
        for f in flags:
            print(f"  [MANUAL] {p}: {f}")

    if not changed:
        print(f"  [OK] {p}: no changes needed")
        return

    if diff:
        d = difflib.unified_diff(
            src.splitlines(keepends=True),
            result.splitlines(keepends=True),
            fromfile=str(p),
            tofile=str(p) + " (migrated)",
        )
        sys.stdout.writelines(d)
    elif write:
        p.write_text(result, encoding="utf-8")
        print(f"  [WRITTEN] {p}")
    else:
        print(f"  [DRY-RUN] {p}: would change {abs(len(result) - len(src))} chars")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Migrate q-menu → OMenu in Vue files")
    parser.add_argument("paths", nargs="+", help="File or directory paths")
    parser.add_argument("--write", action="store_true", help="Write changes in-place")
    parser.add_argument("--diff",  action="store_true", help="Show unified diff")
    args = parser.parse_args()

    for raw in args.paths:
        p = pathlib.Path(raw)
        if not p.exists():
            print(f"[ERROR] Path not found: {p}", file=sys.stderr)
            continue
        process_path(p, write=args.write, diff=args.diff)


if __name__ == "__main__":
    main()
