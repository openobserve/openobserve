# Synthetics

Scheduled checks that run against a customer's own systems from OpenObserve probes and record whether each run passed. This glossary covers browser checks and their composition.

## Language

**Browser Test**:
A check whose run is a Journey played in a real browser. The same Browser Test runs on its own schedule and may also be embedded in other Browser Tests as a Subtest.
_Avoid_: Browser check, browser journey

**Journey**:
The ordered list of Steps a Browser Test plays in one run.
_Avoid_: Script, flow

**Step**:
One authored action in a Journey (navigate, click, fill, assert, ...). Steps are what results list and what billing counts.

**Starting URL**:
The page a Browser Test opens before its first Step when it runs on its own, unless that first Step is itself a navigate. It is not visited when the Browser Test runs as a Subtest; the Subtest continues from the page the parent is on.
_Avoid_: Target (kept only as the API/DB field name shared with other check types), start URL, first URL

**Subtest**:
A Browser Test referenced from a Step of another Browser Test; its Steps run in place of that Step, in the parent's browser session, continuing from the parent's current page.
_Avoid_: Child test, sub-journey, embedded test
