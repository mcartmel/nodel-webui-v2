# Refine Action/Signal Header Feedback

## Context

The copy-name icon is implemented in `nodel-actsig`, but its ghost-button surface gives a secondary helper too much visual weight. Action and signal activity already sets each form's `pulse` state, but the current CSS glows the entire card for 1000 ms. Log icons instead use type/source colours, sit at faint opacity, and brighten with an accent drop-shadow for 700 ms.

## Decisions

- Keep all existing copy behavior, accessibility labels, tooltip, clipboard fallback, signal-read-only availability, and toast feedback unchanged.
- Make the copy control transparent, borderless, muted, and faint at rest. On hover or keyboard focus it becomes full-opacity accent colour while retaining the normal focus ring; its active state remains transparent.
- Match local log icon colours: action icons use the success colour and signal icons use the danger colour.
- Match the log activity pulse exactly: full opacity plus the existing accent drop-shadow for 700 ms.
- Remove the whole-card pulse shadow rather than showing card and icon feedback together.
- Keep the busy spinner neutral and retain only its existing spin animation; activity colour/glow applies to the action/signal type icon when that icon is displayed.
- No Shift+Click behavior, backend/API changes, persisted state, migration, or rollout work is required.

## Implementation

1. Refine the `nodel-actsig` template and pulse timing in `src/components/nodel-actsig.ts`.
   - Replace `.nodel-button-ghost` on the copy button with a component-specific `.nodel-actsig-copy` class while retaining `.nodel-button` and `.nodel-button-compact` for sizing, focus behavior, and semantics.
   - Bind the point type (`action` or `event`) as a data attribute on `.nodel-actsig-form-icon` so CSS can apply the same local type colours as the log.
   - Leave the existing `pulse` model/class and local activity filtering intact; they already identify the correct form for local action/event activity.
   - Change the pulse-clear timer from 1000 ms to the log's 700 ms.

2. Align styling in `src/styles.css`.
   - Add `.nodel-actsig-copy` resting, hover, focus-visible, and active rules after the shared button rules so generic button backgrounds/borders do not reappear in interaction states.
   - Resting state: transparent background/border, no shadow, muted text, and `opacity-faint`.
   - Hover/focus state: transparent background/border, no underline, accent text, and full opacity; preserve the shared focus ring.
   - Active state: remain transparent while preserving the shared pressed-position feedback unless it looks inconsistent during manual review.
   - Remove `transition-shadow` from `.nodel-actsig-form` and delete the `.nodel-actsig-form.is-pulsing` card box-shadow rule.
   - Apply success colour to action type icons and danger colour to signal type icons, excluding the rendered spinner (`[data-icon='spinner']`) so busy state remains neutral.
   - Share the log pulse declaration with `.nodel-actsig-form.is-pulsing .nodel-actsig-form-icon` (also excluding the spinner): opacity `1` and `drop-shadow(0 0 0.35rem rgb(var(--nodel-accent) / 0.45))`.
   - Include the action/signal and copy icons in forced-colours handling so reduced resting opacity does not impair visibility. Existing global reduced-motion handling is sufficient because the pulse uses transitions rather than a looping keyframe animation.

3. Extend `test/nodel-actsig.test.ts`.
   - Update the copy rendering assertion to require `.nodel-actsig-copy` and reject `.nodel-button-ghost`, while retaining existing `type`, icon, title, ARIA, clipboard, disabled-signal, fallback, and toast coverage.
   - Assert action and signal icon containers expose the correct point-type data attribute.
   - Add or extend activity coverage to verify local action/signal activity applies `is-pulsing` to the matching form and that the class clears after 700 ms.
   - Keep existing assertions that the type icon is replaced by the animated neutral spinner during submission and restored afterward.

4. Update `docs/web-components.md`.
   - Describe the copy control as a low-emphasis icon helper.
   - Document that action/signal type icons use the local log colours and pulse like log icons when matching local activity arrives.

## Validation

1. Run `npm test -- --run test/nodel-actsig.test.ts`.
2. Run `npm run typecheck` and `npm run check:jsviews`.
3. Run `npm run build` for the full test and production-build gate.
4. Run `git diff --check` and review the diff against this plan.
5. Manually inspect the core Actions & Signals page in light, dark, and forced-colours modes: confirm the copy helper is quiet at rest but obvious on hover/focus, action/signal colours match local log entries, activity pulses only the type icon for roughly 700 ms, the card no longer glows, and the busy spinner remains neutral.

## Risks

- Generic `.nodel-button` hover/active rules precede the component styles, so the new selector must explicitly override background, border, shadow/underline, colour, and opacity in every relevant state.
- The pulse class remains on the form as the state hook; removing its card shadow must not remove the class because the icon pulse depends on it.
- If activity arrives while submission is still showing the spinner, the spinner must not receive type colour/glow; the remaining pulse may become visible on the restored type icon until the 700 ms timer expires.
