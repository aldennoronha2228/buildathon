/** Localized labels for agreement rendering. */

const SCENARIOS = {
  kn: {
    code: 'kn',
    label: 'ಕನ್ನಡ',
    englishName: 'Kannada',
    labels: {
      service: 'ಸೇವೆಯ ವಿವರ',
      total: 'ಒಟ್ಟು ಮೊತ್ತ',
      advance: 'ಮುಂಗಡ',
      balance: 'ಬಾಕಿ ಮೊತ್ತ',
      condition: 'ಪಾವತಿ ಷರತ್ತುಗಳು',
      conditionText: (adv, bal) => `Cashfree ಮೂಲಕ ${adv} ಮುಂಗಡ ಪಾವತಿ, ಕೆಲಸ ಪೂರ್ಣಗೊಂಡ ನಂತರ ಉಳಿದ ${bal}.`,
    },
  },
  hi: {
    code: 'hi',
    label: 'हिंदी',
    englishName: 'Hindi',
    labels: {
      service: 'सेवा का विवरण',
      total: 'कुल राशि',
      advance: 'एडवांस',
      balance: 'बकाया राशि',
      condition: 'भुगतान की शर्तें',
      conditionText: (adv, bal) => `Cashfree के माध्यम से ${adv} एडवांस, कार्य पूरा होने पर शेष ${bal}।`,
    },
  },
  ta: {
    code: 'ta',
    label: 'தமிழ்',
    englishName: 'Tamil',
    labels: {
      service: 'சேவை விவரம்',
      total: 'மொத்த தொகை',
      advance: 'முன்பணம்',
      balance: 'மீதி தொகை',
      condition: 'கட்டண நிபந்தனைகள்',
      conditionText: (adv, bal) => `Cashfree மூலம் ${adv} முன்பணம், வேலை முடிந்த பிறகு மீதி ${bal}.`,
    },
  },
  en: {
    code: 'en',
    label: 'EN',
    englishName: 'English',
    labels: {
      service: 'Service Description',
      total: 'Total',
      advance: 'Advance',
      balance: 'Balance',
      condition: 'Payment Condition',
      conditionText: (adv, bal) => `${adv} upfront via Cashfree, ${bal} upon work completion.`,
    },
  },
};

export function scenarioFor(code) {
  return SCENARIOS[code] || SCENARIOS.en;
}
