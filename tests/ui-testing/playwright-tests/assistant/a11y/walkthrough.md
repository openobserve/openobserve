# O2 Assistant screen-reader and keyboard walkthroughs

Run these once per release with the flag on, on the mocked harness: a dev server with
`installMocks`, or the Playwright harness paused with `page.pause()`.

- W1–W5: NVDA with Firefox (Windows) and VoiceOver with Safari (macOS).
- W6: VoiceOver with iOS Safari on a phone. TalkBack with Chrome on Android repeats
  W6 once per release.

Each step lists the keys or gestures, then what the reader should say: the live-region
sentence in quotes, then the focused control. The sentences match
`status-announcements.json`, which `a11y.spec.js` checks on every PR. If a reader says
something else, or says it twice, record a finding.

Speech differs a little between readers. NVDA says "edit, multi line" where VoiceOver says
"edit text". Only the sentence and the control's name and role must match.

Record each run in the table at the end: date, build, reader and browser, and the step
of any failure.

## W1: one turn with an approval and a consent (keyboard only)

Mock scenarios: `confirmation`, then `consent`.

| # | Keys | Expected |
|---|---|---|
| 1 | Open Logs. Press `Ctrl+I` (`Cmd+I` on macOS). | "O2 Assistant opened." Focus: "Message O2 Assistant, edit, multi line". |
| 2 | Type `delete stale alerts [confirmation]`, then Enter. | "Sending…" then "Writing the answer". Step lines such as "Listing streams" may be spoken, at most one every 3 seconds. |
| 3 | Wait for the approval card. Do not move focus. | "Waiting for your approval: Delete 1 alert. Expires in 10 minutes. Press Control I to review it." Focus stays in the message box. |
| 4 | `Ctrl+I` | Focus: "Deny, button". |
| 5 | Tab to Approve, then Enter. | The step line for the delete, then "Done". |
| 5b | Shift+Tab to **Go to answer**, then Enter. | Focus moves to the latest answer article, named after the prompt. Read it with the virtual cursor. Then `Ctrl+I`: focus returns to the message box. |
| 6 | Type `why 5xx? [consent]`, then Enter. | "Sending…" then "Waiting for your decision on paid usage for default. Press Control I to review it." |
| 7 | `Ctrl+I` | Focus: the consent card heading, "Enable paid AI usage for default?". |
| 8 | Tab to the checkbox, Space, Tab to Enable, Enter. | "Paid AI usage enabled. Sending your message." Then the turn's sentences, ending "Done". |
| 9 | Escape, with nothing running and the message box empty. | "O2 Assistant closed." Focus returns to the control that opened it. |

## W2: locked role

Mock knobs: `role: "viewer"`, with the org-admin flag off.

| # | Keys | Expected |
|---|---|---|
| 1 | Open Home. Use the reader's heading navigation (H in NVDA browse mode). | "O2 Assistant isn't available to your role, heading level 2". |
| 2 | Tab | "Ask an admin, button". |
| 3 | Enter | A dialog named "Ask an admin". Tab reaches "Copy message, button". |
| 4 | Escape. On Logs, focus a result row and Tab into its toolbar. | The Explain door says it is locked and that you should ask an admin. It is dimmed, not hidden. |
| 5 | Enter on the door, then Escape. | The ask-an-admin popover opens. Escape closes it and focus returns to the door. |

## W3: refusal and recovery

Mock scenarios: `credits_exhausted` (Cloud build), then `offline`.

| # | Keys | Expected |
|---|---|---|
| 1 | Send `why 5xx? [credits_exhausted]`. | "Sending…" then "Not sent." with the reason and the available action. Focus stays in the message box, and the text is kept. |
| 2 | Tab | Focus: the refusal's action button, for example "Ask an admin, button". |
| 3 | Go offline (devtools, or `setOnline(page, false)`), then send. | "Not sent." with the offline reason and "Retry available." |
| 4 | Go back online. | "You're back online." |

## W4: Settings

| # | Keys | Expected |
|---|---|---|
| 1 | Open Settings, then the Assistant item. | Heading "O2 Assistant". Tab list: "Status, tab, selected". |
| 2 | Tab to Test, then Enter. | "Test passed in …" or "Test failed: …", spoken once. |
| 3 | Open the Access tab and reach the enable switch. | "Assistant enabled for this organization, switch, on", followed by its description. |

## W5: docked editor, approval, keys only

Mock scenarios: `permission_card` with `slow`. Page: Alerts, Add alert, SQL query editor.

| # | Keys | Expected |
|---|---|---|
| 1 | Open the query editor dialog, then the dock with its toggle. Type in the editor. | Focus is in the editor buffer. |
| 2 | In the docked message box, ask for a change that needs approval. Shift+Tab back into the editor and keep typing. Press `Ctrl+M` (`Ctrl+Shift+M` on macOS). | Monaco: "Pressing Tab will now move focus to the next focusable element". |
| 3 | Wait for the card while typing in the editor. | A sentence ending "Press Control I to review it." Focus stays in the editor. |
| 4 | `Ctrl+I` | Focus: "Deny, button". The inline helper does not open. |
| 5 | Escape | The card closes as declined. Focus moves to the docked message box. |
| 6 | Type the next message while a turn runs, then press Enter. | "Wait for this answer to finish, or stop it." The pending card stays. |

## W6: phone with VoiceOver (iOS Safari, 375 wide)

Mock scenario: `confirmation`. TalkBack with Chrome on Android repeats steps 1–5.

| # | Gestures | Expected |
|---|---|---|
| 1 | Open an incident. Double-tap its **Ask about this incident** door. | "O2 Assistant opened." Focus: "Message O2 Assistant, text field". |
| 2 | Type a question and send it. | "Sending…" then "Writing the answer". |
| 3 | Wait for the approval. | "Waiting for your approval: …" ending "Review request is above the message box." (the touch variant; no keyboard shortcut is named). |
| 4 | Swipe left from the message box to **Review request**, double-tap. Swipe right to the approve button and double-tap. | Focus: "Deny, button" after the first double-tap. Then the step line and "Done". |
| 5 | Swipe to **Close O2 Assistant** and double-tap. There is no hardware Escape. | "O2 Assistant closed." Focus returns to the incident door. |

## Manual keyboard check on iOS Safari (375 capture list)

On an iPhone with iOS Safari 17 or later:

1. Open Logs and open the assistant sheet.
2. Focus the message box. The on-screen keyboard opens.
3. The message box and the last message stay visible above the keyboard. Nothing is
   hidden behind it, and the page does not jump.

## Where the spoken sentences differ from the announcement catalogue

The product speaks the turn status labels. The catalogue in the design spec words some of
them differently. The golden file pins what the product speaks; each difference is a copy
finding for the assistant owners, not a walkthrough failure:

| Catalogue | Spoken today |
|---|---|
| "Sending." | "Sending…" |
| "Answering." | "Writing the answer" (the first responding state), after an optional "Connecting…" |
| "Done." | "Done" |
| "Failed: {title} {action} available." | "Failed. {title} {action} available." |
| "Not sent: {title} {action} available." | "Not sent. {title} {action} available." |
| "Stopped after {n} steps. Findings so far are kept." / "Stopped." | "Stopped" |

## Runs

| Date | Build | Reader and browser | Walkthroughs | Result |
|---|---|---|---|---|
| | | | | |
