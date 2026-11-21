/**
 * Demo voice scenarios — the same scripted samples as the original prototype.
 * In production these would be replaced by a real Sarvam STT stream.
 */

export const AUTO_DETECT_ORDER = ['kn', 'hi', 'ta', 'en'];

export const SCENARIOS = {
  kn: {
    code: 'kn',
    label: 'ಕನ್ನಡ',
    englishName: 'Kannada',
    confidence: '98%',
    sample:
      'ನಾನು ಗ್ರಾಹಕರ ಅಡುಗೆಮನೆ ವೈರಿಂಗ್ ರಿಪೇರಿ ಕೆಲಸವನ್ನು ₹8,000 ಗೆ ಒಪ್ಪಿಕೊಂಡಿದ್ದೇನೆ. ಅವರು ₹2,000 ಮುಂಗಡವಾಗಿ ಮತ್ತು ಉಳಿದ ₹6,000 ಕೆಲಸ ಮುಗಿದ ನಂತರ ನೀಡುತ್ತಾರೆ.',
    serviceEn: 'Kitchen Wiring & Electrical Repair',
    serviceRegional: 'ಅಡುಗೆಮನೆ ವೈರಿಂಗ್ ಮತ್ತು ಎಲೆಕ್ಟ್ರಿಕಲ್ ರಿಪೇರಿ',
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
    confidence: '98%',
    sample:
      'मैंने ग्राहक के बाथरूम की प्लंबिंग और पाइपलाइन रिपेयर का काम ₹5,500 में तय किया है। वे ₹1,500 एडवांस देंगे और बाकी ₹4,000 काम पूरा होने के बाद देंगे।',
    serviceEn: 'Bathroom Plumbing & Pipeline Repair',
    serviceRegional: 'बाथरूम प्लंबिंग और पाइपलाइन रिपेयर',
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
    confidence: '97%',
    sample:
      'வாடிக்கையாளரின் ஏசி சர்வீஸ் மற்றும் கேஸ் ரீஃபில் வேலைக்கு ₹4,500 பேசினேன். ₹1,500 முன்பணமாகவும், மீதி ₹3,000 வேலை முடிந்த பிறகும் கொடுப்பார்கள்.',
    serviceEn: 'AC Servicing & Gas Refill',
    serviceRegional: 'ஏசி சர்வீஸ் மற்றும் கேஸ் ரீஃபில்',
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
    confidence: '99%',
    sample:
      'I agreed to install a new inverter and battery setup for ₹12,000. The customer will pay ₹4,000 upfront as advance and the remaining ₹8,000 after installation.',
    serviceEn: 'Inverter & Battery Setup Installation',
    serviceRegional: 'Inverter & Battery Setup Installation',
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
  return SCENARIOS[code] || SCENARIOS.kn;
}
