# SlabSense Privacy Policy

*Effective October 2, 2026*

SlabSense ("we", "us") is an independent tool that estimates the condition of trading cards from photographs. This policy says what we collect, what we do with it, who else receives it, and how you delete it. It applies to the SlabSense website, the web app and the SlabSense iOS app.

---

## What we collect

### Things you give us
- **Account**: your email address, a display name and a password (the password is stored only as a hash by our authentication provider).
- **Card photos**: the front and back photos you take or upload, the cropped card image, and the card outline you draw in the centering tool.
- **Grade results**: the estimate for each card you save, with the detected defects and the centering numbers.
- **Slab orders**: if you order a physical slab, the shipping name and address you enter and a card image for the engraved label and the public cert page.
- **Training photos (opt-in)**: if you turn on "Keep Originals For Training" in Settings, the original front and back photos and your card outline are stored with the saved card and may be used to train our card-detection and grading models. This is off by default.

### Things collected automatically
- **Device and usage data** needed to run the service: browser or app version, operating system, the time of each request, and error logs. We do not run advertising or analytics trackers and we do not use an advertising identifier.
- **Local settings** stored on your device only (for example which grading models are on, the centering line style, whether you have seen the first-run notice).

We do not collect your location, contacts, or anything from your photo library other than the photos you pick.

---

## How we use it
- To produce the condition estimate for your card and to save it to your account if you choose to.
- To fulfil a slab order and show its public cert page.
- To run, secure and debug the service and to prevent abuse.
- To improve our grading models, using only the training photos you have opted in to share.
- To send you emails about your account (confirmation, password reset, order status). We do not send marketing email.

---

## Who else receives your data

We do not sell personal data. The following providers process it on our behalf, each under its own privacy terms:

| Provider | What they receive | Why |
|---|---|---|
| Supabase | account data, saved cards, photos, grade results | database, authentication and file storage |
| Vercel | request data, including photos submitted for a grade while the request is processed | hosting for the website and the API |
| Anthropic | the card photos and the measurements for a **paid AI Grade**, plus the card's name once identified | the AI inspection of the card's surface and the written summary |
| Stripe | payment details you enter on Stripe's pages, your email, and order amounts | payments on the website and physical slab orders. We never see your card number. |
| Apple | purchases made inside the iOS app | in-app purchases are handled by Apple's App Store |
| TCGdex | the name and set of the card being identified | reference images and card details |

The free software grade runs on your own device and on our servers without any AI provider. Only a paid AI Grade sends your photos to Anthropic. We do not use other AI providers for your photos.

We may also disclose data if the law requires it, or to a successor if SlabSense is sold, in which case this policy continues to apply.

---

## Where it is stored and for how long
- Data is stored in the United States with the providers above, encrypted in transit and at rest.
- **Saved cards and photos** stay until you delete the card or your account.
- **Photos submitted for a paid grade** are kept for up to 7 days so the result can be delivered and re-checked, then removed.
- **Training photos** stay until you delete the card or your account.
- **Slab orders**: the public cert page and the engraved-label record are kept as the permanent record of the physical slab. Your name and shipping address are removed from the order when you delete your account.
- **Payment records** are kept by Stripe and Apple for as long as their rules require.

---

## Your choices and rights
- **Delete a card**: removes the card, its grade and its stored photos.
- **Delete your account**: in Settings, type DELETE. This removes your account, every saved card and photo, your grade history, remaining credits and your billing record, cancels an active subscription, and detaches your name and address from any slab order. It happens immediately and cannot be undone.
- **Download your data**: Settings → "Download my data" gives you a file with your cards, grades, credits and links to your stored images.
- **Change your email or password**: in Settings.
- **Training photos**: turn the option off in Settings at any time; photos already stored are deleted when you delete those cards.
- **Email**: account and order emails are required to run the service; there is no marketing email to opt out of.

If you are in the EU, EEA, UK or California you also have rights of access, correction, deletion, portability and objection under GDPR and the CCPA. The controls above satisfy them; for anything else, write to the address below.

---

## Children
SlabSense is for people 13 and older. We do not knowingly collect data from children under 13; if we learn we have, we delete it.

## Security
Transport encryption everywhere, encrypted storage, access to production data limited to the operator, and no secrets in the client. No system is perfectly secure; if we learn of a breach affecting you we will tell you.

## Changes
We will post changes here with a new effective date and, for material changes, tell you in the app.

## Contact
SlabSense · support@slabsenseai.com
