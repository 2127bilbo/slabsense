/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * The words on the Help screen (src/components/Help/HelpScreen.jsx): photo tips, how each kind of
 * grade works, and the FAQ. Every answer must be true of the app as built; numbers come from the
 * product catalogue so they cannot drift from what the store sells.
 * Copy rules: no grade margins or promises (owner, 2026-10-03); no features we do not have.
 * Sources for the facts: api/credits (free grade spent only when the result is ready, failed AI Grades
 * refunded), App.jsx job resume (24 hours, same device), public/privacy.html (storage and deletion),
 * public/support.html (cancelling, slab status).
 */
import { FREE_TIER, PRODUCTS, FEEDBACK_EMAIL } from './products.js';

const PLUS = PRODUCTS.sub_monthly;
const COMPANIES = 'TAG, PSA, BGS, CGC or SGC';

export const TIPS = [
  { key: 'background', title: 'Plain background', body: 'Use a plain white, grey or black surface. Wood grain, patterns and other cards next to it make the edges harder to find.' },
  { key: 'light', title: 'Soft, even light', body: 'Daylight from a window or a ceiling light works best. A lamp right above the card causes glare; tilt the card or move the light until the glare is gone.' },
  { key: 'sleeve', title: 'Out of the sleeve', body: 'Take the card out of any penny sleeve, top loader or case. Plastic adds glare and hides the real edges.' },
  { key: 'lens', title: 'Clean the lens', body: 'Wipe the camera lens with a soft cloth. A smudge makes every photo hazy.' },
  { key: 'frame', title: 'Fill the frame', body: 'Get close enough that the card fills most of the photo, with all four corners in and a little space around them.' },
  { key: 'steady', title: 'Let the outline turn green', body: 'Hold the phone flat above the card. When the outline turns green, hold still; with Auto on, SlabSense takes the photo for you.' },
  { key: 'confidence', title: 'Check photo confidence', body: 'After each photo, the medallion shows how clear it is and what to fix. Retakes are free; a grade is only used when you ask for one.' },
  { key: 'notfound', title: 'Card not found?', body: 'Try a background that contrasts with the card border, step back a little, or turn Auto off and tap the shutter yourself. You can also upload a photo you already took.' },
];

export const GRADE_KINDS = [
  {
    key: 'centering', name: 'Centering Check', cost: 'Free for everyone',
    summary: 'Measures how evenly the artwork sits inside the card, front and back.',
    details: [
      'SlabSense places the card edge and the artwork border for you; drag them to adjust.',
      `Left-to-right and top-to-bottom ratios are checked against the centering rules of ${COMPANIES}.`,
      'Unlimited, and it never uses a grade.',
    ],
  },
  {
    key: 'grade', name: 'SlabSense Grade', cost: `${FREE_TIER.gradesPerMonth} a month free · unlimited on Plus`,
    summary: 'A full estimate from your two photos in seconds, with no AI service involved.',
    details: [
      'Trained models look for wear on all eight corners and every edge.',
      `The grading engine combines corner and edge wear, a basic check for visible surface wear, and your centering into an estimate on the scale of the company you pick (${COMPANIES}).`,
      'A grade is counted only when the result is ready. If it fails, it is not counted.',
    ],
  },
  {
    key: 'ai', name: 'AI Grade', cost: `Uses 1 AI Grade · ${PLUS.allowance} a month on Plus, or from packs`,
    summary: 'A closer inspection of the full-resolution photos, with a written report.',
    details: [
      'Looks for surface marks such as scratches, print lines and dents, as well as corner and edge wear.',
      'Compares what it finds with professionally graded reference cards before the grading engine sets the grade.',
      'Needs your centering set first. If an AI Grade fails, it goes back to your balance automatically.',
    ],
  },
];

/** Under the three kinds of grade: what the medallion on the photo and grade screens means. */
export const CONFIDENCE_NOTE = {
  title: 'Photo confidence',
  body: 'Every photo gets a score from 1 to 10 for how clearly it shows the card, with what to fix. It does not change the grade. It tells you how much the photos let SlabSense see.',
};

export const FAQ = [
  { key: 'official', q: 'Is this an official grade?', a: `No. Every SlabSense grade is an estimate made by software from your photos, using the published scales of ${COMPANIES}. SlabSense is not a grading company and is not affiliated with any of them. A professional grader may grade the same card differently.` },
  { key: 'accuracy', q: 'How reliable is the estimate?', a: 'It depends most on the photos, which is why each one gets a photo confidence score. Centering, corner wear and edge wear show up well in clear photos. Very fine surface marks can be hard to see in any photo, so the estimate may vary from an in-hand grade. Better photos make the estimate more reliable; they do not change the card itself.' },
  { key: 'difference', q: 'What is the difference between a SlabSense Grade and an AI Grade?', a: `A SlabSense Grade uses our own trained models for corners and edges, plus a basic surface check, and runs in seconds. Free accounts get ${FREE_TIER.gradesPerMonth} a month. An AI Grade adds a closer inspection of the full-resolution photos, compares the card with professionally graded reference cards and writes a report. It uses one AI Grade from your plan or a pack.` },
  { key: 'disagree', q: 'What if I disagree with my grade?', a: 'Check the photo confidence first. If it shows glare, blur or a dark photo, retake on a plain background in soft light. You can also adjust the centering lines in the Center tab and grade again.' },
  { key: 'failed', q: 'Does a failed grade use up my grades?', a: 'No. A free grade is counted only when the result is ready, and a failed AI Grade goes back to your balance automatically.' },
  { key: 'close', q: 'Can I close the app during an AI Grade?', a: 'Yes. The AI Grade keeps running. When you open SlabSense again on the same device within a day, it offers you the finished result.' },
  { key: 'expire', q: 'Do AI Grades expire?', a: `AI Grades that come with Plus last until the end of that month's billing period. AI Grades from packs never expire, and plan grades are used first.` },
  { key: 'trial', q: 'How does the free trial work?', a: `New Plus subscribers get a ${PLUS.trial.days}-day free trial with unlimited grades and ${PLUS.trial.grades} AI Grades. Cancel before the trial ends and you are not charged. On iPhone, cancel in Settings › Apple ID › Subscriptions; on the web, use Manage on the Plus page.` },
  { key: 'plus', q: 'What does Plus include?', a: `Unlimited SlabSense Grades, ${PLUS.allowance} AI Grades every month and unlimited saved cards. Free accounts get ${FREE_TIER.gradesPerMonth} grades a month and save up to ${FREE_TIER.collectionLimit} cards. Centering is free for everyone.` },
  { key: 'detect', q: 'Why is my card not detected?', a: 'The usual causes are a sleeve or top loader, a busy background, glare, or the card being too close or too far. Take the card out of its sleeve, use a plain background, and let the whole card show with a little space around it.' },
  { key: 'photos', q: 'Where are my photos kept, and how do I delete them?', a: 'Photos of saved cards are stored with your account until you delete the card or your account. Photos sent for an AI Grade are kept for up to 7 days, then removed. Delete a card from Cards, or delete everything in Settings › Delete Account. Settings › Download my data gives you a copy first.' },
  { key: 'slab', q: 'How do I get a physical slab?', a: 'Open a graded card in Cards and tap Get it slabbed. After you order, the cert page linked from the slab shows its status: paid, engraved and shipped.' },
  { key: 'contact', q: 'How do I contact SlabSense?', a: `Email ${FEEDBACK_EMAIL}. We answer within two business days. For an AI Grade or a slab order, include the date or the order number from your receipt.` },
];

/** Everything shown on the Help screen, for the copy tests. */
export function allHelpText() {
  return [
    ...TIPS.flatMap((t) => [t.title, t.body]),
    ...GRADE_KINDS.flatMap((g) => [g.name, g.cost, g.summary, ...g.details]),
    CONFIDENCE_NOTE.title, CONFIDENCE_NOTE.body,
    ...FAQ.flatMap((f) => [f.q, f.a]),
  ].join('\n');
}
