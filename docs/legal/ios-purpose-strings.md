# iOS permission purpose strings (Info.plist)

Written 2026-10-02 for fix group 3f (the Capacitor shell). Apple shows these verbatim in the
permission prompt and reads them against the privacy policy (guideline 5.1.1(ii)). Each says what
the data is for, not just "to work".

| Key | String |
|---|---|
| `NSCameraUsageDescription` | SlabSense uses the camera to photograph the front and back of your card. The photos are used to estimate the card's condition and are saved to your account only when you save the card. |
| `NSPhotoLibraryUsageDescription` | SlabSense can grade a card from a photo already in your library. Only the photos you pick are used. |
| `NSPhotoLibraryAddUsageDescription` | SlabSense saves the graded card image to your library when you tap Export. |
| `NSMotionUsageDescription` | SlabSense uses the motion sensor to show a level bubble while you frame the card, so the photo is taken flat. The reading is not stored. |

Not used, do not request: location, contacts, microphone, Bluetooth, tracking (no
`NSUserTrackingUsageDescription`; the app has no advertising identifier use).

Privacy nutrition label answers come from `docs/audits/parts/F-privacy-data.md` §3.
