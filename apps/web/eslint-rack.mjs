/**
 * ESLint guard for the "Rack" design system (see DESIGN.md → Enforcement).
 *
 * Generated and template UIs fall back to the same defaults: big rounded
 * cards, soft shadows, gradients, ALL-CAPS eyebrow labels, the indigo/violet
 * palette, hover lifts and "A · B · C" meta strings. This rule reports those
 * class patterns wherever they appear in string literals, template literals
 * and JSX text, so they can't creep back in.
 *
 * Fix the code rather than disabling the rule. If a case is genuinely needed,
 * add `// eslint-disable-next-line rack/no-template-look -- <why>`.
 */

/** [pattern, message]. Patterns run against each string's text. */
const BANNED = [
  [/(?:^|[\s:"'`])rounded-(?:2xl|3xl)(?=$|[\s"'`])/, "Large radius. Rack uses rounded-md (controls), rounded-lg (panels) or rounded-xl (floating layers)."],
  [/(?:^|[\s:"'`])shadow-(?:sm|md|lg|xl|2xl)(?=$|[\s"'`/])/, "Decorative shadow. Only floating layers get one: shadow-[var(--shadow-float)]."],
  [/(?:^|[\s:"'`])bg-(?:gradient|linear|radial|conic)-/, "Gradient. Rack separates surfaces with seams and the well/chassis contrast, not gradients."],
  [/(?=.*(?:^|\s)uppercase(?:\s|$))(?=.*(?:^|\s)tracking-(?:wide|wider|widest|\[))/, "ALL-CAPS tracked label. Use sentence case: text-[12px]/text-[13px] text-muted-foreground."],
  [/(?:^|[\s:"'`])(?:bg|text|border|from|to|via|ring)-(?:indigo|violet|purple)-\d{2,3}/, "Default Tailwind palette. Use the Rack tokens (primary, status-*, muted, border)."],
  [/(?:^|[\s"'`])(?:group-)?hover:-?translate-y-/, "Hover lift. Rack motion answers actions only; change colour on hover instead."],
];

/** Middle-dot meta strings ("us-east · nyc"); checked separately so the message can be specific. */
const MIDDLE_DOT = /\S\s·\s\S/;

function check(context, node, text) {
  if (typeof text !== "string" || !text) return;
  for (const [pattern, message] of BANNED) {
    if (pattern.test(text)) context.report({ node, message });
  }
  if (MIDDLE_DOT.test(text)) {
    context.report({
      node,
      message: "Middle-dot meta string. Lay values out as separate fields, or use natural punctuation.",
    });
  }
}

const noTemplateLook = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow generic template styling banned by DESIGN.md" },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        check(context, node, node.value);
      },
      TemplateElement(node) {
        check(context, node, node.value.cooked);
      },
      JSXText(node) {
        // Only the middle-dot rule makes sense for visible text.
        if (MIDDLE_DOT.test(node.value)) {
          context.report({
            node,
            message: "Middle-dot meta string. Lay values out as separate fields, or use natural punctuation.",
          });
        }
      },
    };
  },
};

export const rackPlugin = { rules: { "no-template-look": noTemplateLook } };
